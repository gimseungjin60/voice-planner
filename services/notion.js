// 노션 호출은 전부 여기서 (internal integration 토큰). 토큰은 로그·응답에 절대 내보내지 않는다
// 노션 API 2025-09-03부터 데이터베이스 안에 데이터 소스가 있고, 페이지는 데이터 소스에 만든다
const { Client, APIErrorCode } = require("@notionhq/client");

function fail(status, message) {
  const err = new Error(message);
  err.status = status;
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
  const props = Object.entries(ds.properties || {}).map(([name, p]) => ({ name, type: p.type }));
  const find = (types, pattern) => props.find((p) => types.includes(p.type) && pattern.test(p.name))?.name || null;
  return {
    dataSourceId,
    title: props.find((p) => p.type === "title")?.name,
    date: find(["date"], /마감|due|deadline|날짜|date/i) || find(["date"], /./), // 이름이 안 맞으면 첫 날짜 속성
    subject: find(["select", "rich_text"], /과목|subject|course|class/i),
    priority: find(["select"], /우선|priority/i),
    types: Object.fromEntries(props.map((p) => [p.name, p.type])),
  };
}

const PRIORITY = { high: "높음", mid: "보통", low: "낮음" };

// 할 일 하나 → 노션 페이지 속성
function pageProps(target, t) {
  const props = { [target.title]: { title: [{ text: { content: t.title } }] } };
  if (target.date && t.due_at) {
    const [d, time] = t.due_at.split(" ");
    // 23:59 마감은 '날짜만'으로 (노션에서 깔끔하게 보이게)
    props[target.date] = { date: { start: time?.startsWith("23:59") ? d : `${d}T${time.slice(0, 5)}:00+09:00` } };
  }
  if (target.subject && t.subject_name) {
    props[target.subject] =
      target.types[target.subject] === "select" ? { select: { name: t.subject_name } } : { rich_text: [{ text: { content: t.subject_name } }] };
  }
  if (target.priority) props[target.priority] = { select: { name: PRIORITY[t.priority] || "보통" } };
  return props;
}

// 할 일 목록을 노션 DB에 행으로 추가 → [{ task_id, page_id }]. 하나가 실패해도 나머지는 계속
async function exportTasks({ token, ref, tasks }) {
  const notion = new Client({ auth: token, timeoutMs: 15000 });
  let target;
  try {
    target = await resolveTarget(notion, ref);
  } catch (err) {
    throw friendly(err);
  }
  if (!target.title) throw fail(400, "노션 데이터베이스에 제목 속성이 없어요");
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

module.exports = { exportTasks };
