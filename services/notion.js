// 노션 호출은 전부 여기서 (internal integration 토큰). 토큰은 로그·응답에 절대 내보내지 않는다
// 노션 API 2025-09-03부터 데이터베이스 안에 데이터 소스가 있고, 페이지는 데이터 소스에 만든다
const { Client, APIErrorCode } = require("@notionhq/client");

function fail(status, message) {
  const err = new Error(message);
  err.status = status;
  err.expose = true; // 사용자에게 보여줄 안내 문구 (app.js 에러 처리기가 5xx여도 그대로 보낸다)
  return err;
}

// 노션 에러 → 사용자용 메시지
function friendly(err) {
  console.error("[notion]", err.code || "", err.message);
  if (err.code === APIErrorCode.Unauthorized) return fail(400, "노션 토큰이 올바르지 않아요. 연동 설정에서 다시 입력해 주세요");
  if (err.code === APIErrorCode.ObjectNotFound || err.code === APIErrorCode.RestrictedResource)
    return fail(404, "노션 데이터베이스를 찾을 수 없어요. 데이터베이스 페이지의 ⋯ → 연결에서 integration을 추가했는지 확인해 주세요");
  if (err.code === APIErrorCode.ValidationError) return fail(400, "노션 데이터베이스 속성과 맞지 않아요. 제목 속성이 있는 데이터베이스인지 확인해 주세요");
  if (err.code === APIErrorCode.RateLimited) return fail(429, "노션 요청이 많아요. 잠시 후 다시 시도해 주세요");
  return fail(502, "노션 서버와 통신하지 못했어요. 잠시 후 다시 시도해 주세요");
}

// 데이터베이스 ID(또는 데이터 소스 ID) → 데이터 소스와 속성 이름 매핑
async function resolveTarget(notion, ref) {
  let dataSourceId = ref;
  try {
    const db = await notion.databases.retrieve({ database_id: ref });
    if (db.data_sources?.length) dataSourceId = db.data_sources[0].id;
  } catch (err) {
    // 사용자가 데이터 소스 ID를 넣었을 수도 있어서, 못 찾으면 아래에서 데이터 소스로 한 번 더 확인
    if (err.code !== APIErrorCode.ObjectNotFound && err.code !== APIErrorCode.ValidationError) throw err;
  }
  const ds = await notion.dataSources.retrieve({ data_source_id: dataSourceId });
  const props = Object.entries(ds.properties || {}).map(([name, p]) => ({ name, type: p.type, raw: p }));
  const find = (types, pattern) => props.find((p) => types.includes(p.type) && pattern.test(p.name))?.name || null;
  // 완료 표시: 상태(status) 속성이 있으면 그것, 없으면 이름이 완료·done인 체크박스
  const statusProp = props.find((p) => p.type === "status") || props.find((p) => p.type === "checkbox" && /완료|done|체크|check|complete/i.test(p.name));
  let status = null;
  if (statusProp?.type === "checkbox") status = { name: statusProp.name, type: "checkbox" };
  if (statusProp?.type === "status") {
    // 노션 상태 그룹(할 일·진행 중·완료)마다 첫 선택지 이름 → 우리 todo·doing·done
    const { options = [], groups = [] } = statusProp.raw.status || {};
    const nameOf = (id) => options.find((o) => o.id === id)?.name;
    const group = (pattern) => groups.find((g) => pattern.test(g.name));
    const first = (g) => (g?.option_ids?.length ? nameOf(g.option_ids[0]) : null);
    const doneGroup = group(/complete|완료/i);
    status = {
      name: statusProp.name,
      type: "status",
      todo: first(group(/to-?do|not started|할 일|시작 전/i)) || options[0]?.name,
      doing: first(group(/progress|진행/i)),
      done: first(doneGroup),
      doneNames: new Set((doneGroup?.option_ids || []).map(nameOf).filter(Boolean)),
      doingNames: new Set((group(/progress|진행/i)?.option_ids || []).map(nameOf).filter(Boolean)),
    };
  }
  return {
    dataSourceId,
    title: props.find((p) => p.type === "title")?.name,
    date: find(["date"], /마감|due|deadline|날짜|date/i) || find(["date"], /./), // 이름이 안 맞으면 첫 날짜 속성
    subject: find(["select", "multi_select", "rich_text"], /과목|subject|course|class/i),
    priority: find(["select"], /우선|priority/i),
    status,
    types: Object.fromEntries(props.map((p) => [p.name, p.type])),
  };
}

// 속성 이름 찾기는 노션 호출 2번이라 10분 동안 기억한다 (설정을 바꾸면 forget)
const targetCache = new Map(); // ref → { at, target }
async function targetFor(notion, ref) {
  const hit = targetCache.get(ref);
  if (hit && Date.now() - hit.at < 10 * 60 * 1000) return hit.target;
  const target = await resolveTarget(notion, ref);
  targetCache.set(ref, { at: Date.now(), target });
  return target;
}
const forget = (ref) => targetCache.delete(ref);

const PRIORITY = { high: "높음", mid: "보통", low: "낮음" };
const PRIORITY_IN = { 높음: "high", 상: "high", high: "high", 보통: "mid", 중: "mid", medium: "mid", mid: "mid", 낮음: "low", 하: "low", low: "low" };

// 할 일 하나 → 노션 페이지 속성
function pageProps(target, t) {
  const props = { [target.title]: { title: [{ text: { content: t.title } }] } };
  // 마감·과목이 비어 있으면 노션 값을 지우지 않고 그대로 둔다 (노션에만 적어 둔 값 보호)
  if (target.date && t.due_at) {
    const [d, time] = t.due_at.split(" ");
    // 23:59 마감은 '날짜만'으로 (노션에서 깔끔하게 보이게)
    props[target.date] = { date: { start: time?.startsWith("23:59") ? d : `${d}T${time.slice(0, 5)}:00+09:00` } };
  }
  if (target.subject && t.subject_name) {
    const name = t.subject_name.replace(/,/g, " ").slice(0, 100); // 노션 선택지 이름에는 쉼표를 못 쓴다
    const type = target.types[target.subject];
    props[target.subject] =
      type === "select" ? { select: { name } } : type === "multi_select" ? { multi_select: [{ name }] } : { rich_text: [{ text: { content: t.subject_name } }] };
  }
  if (target.priority) props[target.priority] = { select: { name: PRIORITY[t.priority] || "보통" } };
  const st = target.status;
  if (st?.type === "checkbox") props[st.name] = { checkbox: t.status === "done" };
  if (st?.type === "status") {
    const name = t.status === "done" ? st.done : t.status === "doing" ? st.doing || st.todo : st.todo;
    if (name) props[st.name] = { status: { name } };
  }
  return props;
}

// 노션 페이지 → 우리 할 일 값 (없는 속성은 undefined로 남겨 덮어쓰지 않는다)
const plain = (rich) => (rich || []).map((r) => r.plain_text).join("").trim();
function kstDatetime(start) {
  if (!start) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(start)) return `${start} 23:59:00`; // 날짜만 = 그날 23:59 마감
  const t = Date.parse(start);
  if (Number.isNaN(t)) return null;
  return new Date(t + 9 * 3600000).toISOString().replace("T", " ").slice(0, 16) + ":00";
}
function readPage(target, page) {
  const p = page.properties || {};
  const out = { page_id: page.id, last_edited: page.last_edited_time, in_trash: !!(page.in_trash || page.archived) };
  if (target.title && p[target.title]) out.title = plain(p[target.title].title).slice(0, 200);
  if (target.date && p[target.date]) out.due_at = kstDatetime(p[target.date].date?.start);
  if (target.subject && p[target.subject]) {
    const v = p[target.subject];
    out.subject_name = v.select?.name || v.multi_select?.[0]?.name || plain(v.rich_text) || null;
  }
  if (target.priority && p[target.priority]) {
    const name = p[target.priority].select?.name;
    if (name && PRIORITY_IN[name.toLowerCase()]) out.priority = PRIORITY_IN[name.toLowerCase()];
  }
  const st = target.status;
  if (st && p[st.name]) {
    if (st.type === "checkbox") out.done = !!p[st.name].checkbox;
    else {
      const name = p[st.name].status?.name;
      out.status = st.doneNames.has(name) ? "done" : st.doingNames.has(name) ? "doing" : "todo";
    }
  }
  return out;
}

async function open(token, ref) {
  const notion = new Client({ auth: token, timeoutMs: 15000 });
  try {
    const target = await targetFor(notion, ref);
    if (!target.title) throw fail(400, "노션 데이터베이스에 제목 속성이 없어요");
    return { notion, target };
  } catch (err) {
    throw err.expose ? err : friendly(err);
  }
}

// 할 일 목록을 노션 DB에 행으로 추가 → [{ task_id, page_id }]. 하나가 실패해도 나머지는 계속
async function exportTasks({ token, ref, tasks }) {
  const { notion, target } = await open(token, ref);
  const done = [];
  let lastError = null;
  for (const t of tasks) {
    try {
      const page = await notion.pages.create({ parent: { type: "data_source_id", data_source_id: target.dataSourceId }, properties: pageProps(target, t) });
      done.push({ task_id: t.task_id, page_id: page.id });
    } catch (err) {
      lastError = friendly(err);
      if (lastError.message.startsWith("노션 토큰")) throw lastError;
    }
  }
  if (!done.length && lastError) throw lastError;
  return done;
}

// 앱에서 바꾼 할 일을 연결된 노션 페이지에 반영 (제목·마감·과목·우선순위·완료)
async function updatePage({ token, ref, pageId, task }) {
  const { notion, target } = await open(token, ref);
  try {
    await notion.pages.update({ page_id: pageId, properties: pageProps(target, task) });
  } catch (err) {
    throw friendly(err);
  }
}

// 앱에서 지운 할 일 → 노션 페이지를 휴지통으로 (노션에서 30일 동안 되살릴 수 있다)
async function trashPage({ token, pageId }) {
  const notion = new Client({ auth: token, timeoutMs: 15000 });
  try {
    await notion.pages.update({ page_id: pageId, in_trash: true });
  } catch (err) {
    if (err.code === APIErrorCode.ObjectNotFound) return; // 이미 없는 페이지
    throw friendly(err);
  }
}

// 노션에서 읽을 페이지: since 이후에 고친 페이지 + 날짜가 windowStart 이후인 페이지. 최대 500개
// complete = 잘리지 않고 다 읽었나 (다 읽었을 때만 '안 보이는 페이지 = 휴지통 후보'로 본다)
async function changedPages({ token, ref, since, windowStart }) {
  const { notion, target } = await open(token, ref);
  const byDate = target.date ? { property: target.date, date: { on_or_after: windowStart } } : null;
  const byEdit = since ? { timestamp: "last_edited_time", last_edited_time: { on_or_after: since } } : null;
  const filter = byDate && byEdit ? { or: [byDate, byEdit] } : byDate || byEdit || undefined;
  const pages = [];
  let cursor;
  try {
    do {
      const q = await notion.dataSources.query({ data_source_id: target.dataSourceId, filter, start_cursor: cursor, page_size: 100 });
      pages.push(...q.results.filter((x) => x.object === "page").map((x) => readPage(target, x)));
      cursor = q.has_more ? q.next_cursor : undefined;
    } while (cursor && pages.length < 500);
  } catch (err) {
    throw friendly(err);
  }
  return { pages, complete: !cursor && !!byDate, hasStatus: !!target.status };
}

// 연결된 페이지가 아직 있는지 (휴지통으로 갔는지) 하나씩 확인 → [{ page_id, gone }]
async function pageStates({ token, pageIds }) {
  const notion = new Client({ auth: token, timeoutMs: 15000 });
  const out = [];
  for (const id of pageIds) {
    try {
      const page = await notion.pages.retrieve({ page_id: id });
      out.push({ page_id: id, gone: !!(page.in_trash || page.archived) });
    } catch (err) {
      if (err.code === APIErrorCode.ObjectNotFound) out.push({ page_id: id, gone: true });
      else if (err.code === APIErrorCode.Unauthorized) throw friendly(err);
    }
  }
  return out;
}

module.exports = { exportTasks, updatePage, trashPage, changedPages, pageStates, forget, readPage, pageProps };
