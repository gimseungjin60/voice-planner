// LMS 과제 → 할 일 (2026-11-27 추가). 피드 읽기는 services/lms.js, 여기서는 DB와 묶기만 한다
// - 오늘 이후 마감인 과제·시험만 가져온다 (지난 과제는 가져오지 않음)
// - 같은 과제는 tasks.external_id(과제 주소)로 알아보고 제목·마감이 바뀌면 고친다. 완료한 할 일은 건드리지 않는다
// - 사용자가 지운 과제는 다시 가져오지 않는다 (integrations.target_ref JSON의 hide)
// - LMS에서 없어진 과제(아직 안 한 것)는 할 일에서도 지운다
// - 과목은 '과목 코드 → 내 과목' 연결(설정 화면)을 먼저 보고, 없으면 과목 이름으로 찾는다
const pool = require("../db");
const lms = require("./lms");

const squash = (s) => String(s || "").replace(/[\s\-_·:()[\]]/g, "").toLowerCase();
const extOf = (item) => item.link || `lms:${item.uid}`;
const assignmentId = (ext) => ext.match(/assignments\/(\d+)$/)?.[1] || ext;
const addDays = (ymd, n) => new Date(Date.parse(ymd + "T00:00:00Z") + n * 86400000).toISOString().slice(0, 10);
const daysBetween = (a, b) => Math.round((Date.parse(b.slice(0, 10)) - Date.parse(a.slice(0, 10))) / 86400000);

async function integration(userId) {
  const [[row]] = await pool.query("SELECT access_token, target_ref, last_synced_at FROM integrations WHERE user_id = ? AND provider = 'lms'", [userId]);
  return row || null;
}

// target_ref JSON: { map: { 과목코드: subject_id }, hide: [과제 ID] }
function readConf(ref) {
  try {
    const c = JSON.parse(ref || "{}");
    return { map: c.map && typeof c.map === "object" ? c.map : {}, hide: Array.isArray(c.hide) ? c.hide.map(String) : [] };
  } catch {
    return { map: {}, hide: [] };
  }
}
async function saveConf(userId, conf) {
  let text = JSON.stringify(conf);
  while (text.length > 1000 && conf.hide.length) conf.hide.shift(), (text = JSON.stringify(conf)); // 오래된 숨김부터 버린다
  await pool.query("UPDATE integrations SET target_ref = ? WHERE user_id = ? AND provider = 'lms'", [text, userId]);
}

// '(강병희) 질문하기'처럼 학생마다 하나씩 열린 과제가 한꺼번에 보이면 내 이름 것만 남긴다
function onlyMine(items, userName) {
  const groups = new Map();
  for (const it of items) {
    const m = it.title.match(/^\(([^()]{2,10})\)\s*(.+)$/);
    if (!m) continue;
    const key = `${it.course_code}|${it.due_at}|${m[2]}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push({ it, who: m[1], rest: m[2] });
  }
  const drop = new Set();
  for (const list of groups.values()) {
    if (list.length < 3) continue;
    const mine = list.filter((x) => squash(x.who) === squash(userName));
    for (const x of list) if (!mine.includes(x)) drop.add(x.it);
    if (!mine.length) {
      // 내 이름이 없으면 하나만, 이름 없이 남긴다
      const keep = list[0];
      drop.delete(keep.it);
      keep.it.title = keep.rest;
    }
  }
  return items.filter((it) => !drop.has(it));
}

// 과목 찾기: 저장한 연결 → 시험 제목 속 과목 이름 → 과제 제목에 과목 이름이 들어 있으면
function subjectFinder(subjects, map) {
  const own = new Set(subjects.map((s) => s.subject_id));
  return (item) => {
    const mapped = map[item.course_code];
    if (mapped === 0) return null; // '연결 안 함'으로 고른 과목
    if (mapped && own.has(Number(mapped))) return Number(mapped);
    // 과목 이름은 양쪽 포함까지(예: '데이터베이스' ↔ '데이터베이스설계'), 과제 제목은 과목 이름이 들어 있을 때만
    const course = squash(item.course_name);
    const title = squash(item.title);
    const hit = subjects.find((s) => {
      const name = squash(s.name);
      return name.length >= 2 && ((course && (course.includes(name) || name.includes(course))) || title.includes(name));
    });
    return hit ? hit.subject_id : null;
  };
}

// 과목을 못 찾았으면 제목 뒤에 LMS 과목 이름을 붙여 어떤 과목인지 알 수 있게
const titleFor = (item, subjectId) => (subjectId || !item.course_name ? item.title : `${item.title} · ${item.course_name}`).slice(0, 200);

// 마감 3일 안이거나 시험이면 '높음' ('기말고사 과제'처럼 시험 기간 과제는 시험으로 보지 않는다)
const isExam = (title) => /시험|고사|퀴즈|quiz|exam/i.test(title) && !/과제|보고서|리포트|레포트|report|발표|제출/i.test(title);
const priorityFor = (item, today) => (isExam(item.title) || daysBetween(today, item.due_at) <= 3 ? "high" : "mid");

// LMS → 할 일. 반환 { added, updated, removed, skipped, unmapped: [과목 코드] } (LMS 미연결이면 null)
// remap: 설정에서 과목 연결을 저장한 직후. 연결을 정한 과목 코드의 할 일은 과목을 다시 맞춘다
async function pull(userId, { remap = false } = {}) {
  const n = await integration(userId);
  if (!n) return null;
  const now = pool.kst();
  const today = now.slice(0, 10);
  const conf = readConf(n.target_ref);
  const [[user]] = await pool.query("SELECT user_name FROM users WHERE user_id = ?", [userId]);
  const items = onlyMine(await lms.fetchAssignments(n.access_token), user?.user_name);

  const [subjects] = await pool.query("SELECT subject_id, name FROM subjects WHERE user_id = ?", [userId]);
  const findSubject = subjectFinder(subjects, conf.map);
  const mappedCodes = new Set(Object.keys(conf.map));
  // 겹침 확인용으로 최근 할 일도 같이 읽는다 (완료한 것도: 직접 적어 두고 끝낸 과제를 LMS에서 다시 가져오지 않게)
  const [mine] = await pool.query(
    "SELECT task_id, title, due_at, status, subject_id, source, external_id FROM tasks WHERE user_id = ? AND (source = 'lms' OR due_at IS NULL OR due_at >= ?)",
    [userId, `${addDays(today, -60)} 00:00:00`],
  );
  const byExt = new Map(mine.filter((t) => t.source === "lms").map((t) => [t.external_id, t]));
  const hidden = new Set(conf.hide);

  let added = 0;
  let updated = 0;
  let removed = 0;
  let skipped = 0;
  const seen = new Set();
  const unmapped = new Set();
  for (const item of items) {
    const ext = extOf(item);
    if (seen.has(ext)) continue;
    seen.add(ext);
    const upcoming = item.due_at.slice(0, 10) >= today;
    const sid = findSubject(item);
    if (upcoming && !sid && item.course_code && conf.map[item.course_code] !== 0) unmapped.add(item.course_code);
    const t = byExt.get(ext);
    if (t) {
      // 이미 가져온 과제: LMS에서 마감이 바뀌었으면 맞춘다. 제목은 사용자가 고쳤을 수 있어 그대로 둔다
      // 과목은 비어 있을 때만 채운다 (사용자가 고른 과목 존중). 설정에서 과목 연결을 바꿨을 때(remap)만 다시 맞춘다
      const sets = [];
      const params = [];
      const set = (col, v) => sets.push(`${col} = ?`) && params.push(v);
      const subjectId = (remap && mappedCodes.has(item.course_code)) || !t.subject_id ? sid : t.subject_id;
      if (subjectId !== t.subject_id) set("subject_id", subjectId);
      if (t.status !== "done") {
        if (item.due_at !== t.due_at) set("due_at", item.due_at);
        // 과목이 정해지면 붙여 두었던 ' · LMS 과목 이름'을 뗀다 (과목이 없어지면 다시 붙인다)
        const auto = [item.title, titleFor(item, null)];
        if (auto.includes(t.title) && titleFor(item, subjectId) !== t.title) set("title", titleFor(item, subjectId));
      }
      if (sets.length) {
        await pool.query(`UPDATE tasks SET ${sets.join(", ")} WHERE task_id = ? AND user_id = ?`, [...params, t.task_id, userId]);
        updated++;
      }
      continue;
    }
    if (!upcoming || hidden.has(assignmentId(ext))) continue;
    // 이미 직접(또는 메일·음성으로) 적어 둔 같은 할 일이 있으면 겹치지 않게 건너뛴다
    const key = squash(item.title);
    const dup = mine.find(
      (x) => x.source !== "lms" && (squash(x.title) === key || (x.due_at?.slice(0, 10) === item.due_at.slice(0, 10) && key.length >= 4 && (squash(x.title).includes(key) || key.includes(squash(x.title))))),
    );
    if (dup) {
      skipped++;
      continue;
    }
    await pool.query("INSERT INTO tasks (user_id, subject_id, title, due_at, priority, status, source, external_id) VALUES (?, ?, ?, ?, ?, 'todo', 'lms', ?)", [
      userId,
      sid,
      titleFor(item, sid),
      item.due_at,
      priorityFor(item, today),
      ext,
    ]);
    added++;
  }

  // LMS에서 없어진 과제: 아직 안 한, 마감 전 할 일만 지운다
  for (const t of byExt.values()) {
    if (seen.has(t.external_id) || t.status === "done" || !t.due_at || t.due_at.slice(0, 10) < today) continue;
    await pool.query("DELETE FROM tasks WHERE task_id = ? AND user_id = ? AND source = 'lms'", [t.task_id, userId]);
    removed++;
  }

  // 숨김 목록은 피드에 아직 있는 과제만 남긴다 (길이 제한)
  const live = new Set([...seen].map(assignmentId));
  const hide = conf.hide.filter((id) => live.has(id));
  if (hide.length !== conf.hide.length) await saveConf(userId, { ...conf, hide });
  await pool.query("UPDATE integrations SET last_synced_at = ? WHERE user_id = ? AND provider = 'lms'", [now, userId]);
  return { added, updated, removed, skipped, unmapped: [...unmapped] };
}

// 사용자가 LMS 할 일을 지우면 다음 동기화 때 다시 가져오지 않게 기억한다
async function hide(userId, externalId) {
  const n = await integration(userId);
  if (!n || !externalId) return;
  const conf = readConf(n.target_ref);
  const id = assignmentId(externalId);
  if (!conf.hide.includes(id)) conf.hide.push(id);
  await saveConf(userId, conf);
}

// 설정 화면용: 피드에 나온 과목 코드 목록 + 지금 연결된 과목
async function courses(userId) {
  const n = await integration(userId);
  if (!n) return null;
  const conf = readConf(n.target_ref);
  const items = await lms.fetchAssignments(n.access_token);
  const [subjects] = await pool.query("SELECT subject_id, name FROM subjects WHERE user_id = ?", [userId]);
  const findSubject = subjectFinder(subjects, conf.map);
  const today = pool.kst().slice(0, 10);
  const list = new Map();
  for (const it of items) {
    if (!it.course_code) continue;
    const c = list.get(it.course_code) || { code: it.course_code, label: it.course_label, name: it.course_name, samples: [], upcoming: 0, last_due: "" };
    if (!c.name && it.course_name) c.name = it.course_name;
    if (c.samples.length < 2 && !c.samples.includes(it.title)) c.samples.push(it.title);
    if (it.due_at.slice(0, 10) >= today) c.upcoming++;
    if (it.due_at > c.last_due) c.last_due = it.due_at;
    c.subject_id = conf.map[it.course_code] === 0 ? 0 : findSubject(it) || c.subject_id || null;
    c.auto = conf.map[it.course_code] === undefined;
    list.set(it.course_code, c);
  }
  return [...list.values()].sort((a, b) => b.upcoming - a.upcoming || b.last_due.localeCompare(a.last_due));
}

// 과목 연결 저장 { 코드: subject_id | 0(연결 안 함) | null(자동) }
async function saveMap(userId, map) {
  const n = await integration(userId);
  if (!n) return null;
  const [subjects] = await pool.query("SELECT subject_id FROM subjects WHERE user_id = ?", [userId]);
  const own = new Set(subjects.map((s) => s.subject_id));
  const conf = readConf(n.target_ref);
  const next = {};
  for (const [code, v] of Object.entries(map || {})) {
    if (!/^[A-Z0-9]{1,12}$/.test(code)) continue;
    if (Number(v) === 0 && v !== null && v !== "") next[code] = 0;
    else if (own.has(Number(v))) next[code] = Number(v);
  }
  conf.map = next;
  await saveConf(userId, conf);
  return next;
}

module.exports = { pull, hide, courses, saveMap };
