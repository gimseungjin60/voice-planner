// 노션 양방향 동기화 (2026-11-27 추가). 노션 API 호출은 services/notion.js, 여기서는 DB와 묶기만 한다
// - 보내기(앱 → 노션): 노션과 연결된 할 일(tasks.external_id = 노션 페이지 ID)을 고치거나 지우면 그 페이지도 바꾼다.
//   응답을 늦추지 않게 기다리지 않고, 실패해도 앱은 그대로 두고 로그만 남긴다 (다음 가져오기 때 노션 값으로 맞춰짐)
// - 가져오기(노션 → 앱): 마지막 동기화 이후 노션에서 고친 페이지를 할 일에 반영하고, 노션에서 새로 만든 페이지(오늘 이후 날짜)는 할 일로 추가.
//   노션 휴지통으로 간 페이지는 노션에서 온 할 일이면 지우고, 앱에서 내보낸 할 일이면 연결만 끊는다
const pool = require("../db");
const notion = require("./notion");

const norm = (id) => String(id || "").replace(/-/g, "").toLowerCase();
const addDays = (ymd, n) => new Date(Date.parse(ymd + "T00:00:00Z") + n * 86400000).toISOString().slice(0, 10);
const squash = (s) => String(s || "").replace(/\s/g, "").toLowerCase();

async function integration(userId) {
  const [[n]] = await pool.query("SELECT access_token, target_ref, last_synced_at FROM integrations WHERE user_id = ? AND provider = 'notion'", [userId]);
  return n && n.target_ref ? n : null;
}

const TASK_ROW = `SELECT t.task_id, t.title, t.due_at, t.priority, t.status, t.subject_id, t.source, t.external_id, s.name AS subject_name
  FROM tasks t LEFT JOIN subjects s ON s.subject_id = t.subject_id`;

// 앱 → 노션: 할 일들의 현재 값을 연결된 페이지에 덮어쓴다
async function pushNow(userId, taskIds) {
  const ids = [].concat(taskIds).map(Number).filter(Number.isInteger);
  if (!ids.length) return 0;
  const [tasks] = await pool.query(`${TASK_ROW} WHERE t.user_id = ? AND t.task_id IN (?) AND t.external_id IS NOT NULL`, [userId, ids]);
  if (!tasks.length) return 0;
  const n = await integration(userId);
  if (!n) return 0;
  for (const task of tasks) await notion.updatePage({ token: n.access_token, ref: n.target_ref, pageId: task.external_id, task });
  return tasks.length;
}

// 기다리지 않는 버전 (라우터에서 호출)
function push(userId, taskIds) {
  pushNow(userId, taskIds).catch((err) => console.error("[notion-sync] push", err.message));
}

// 앱에서 지운 할 일의 노션 페이지를 휴지통으로 (지우기 전에 external_id를 읽어 넘긴다)
function trash(userId, pageIds) {
  const ids = [].concat(pageIds).filter(Boolean);
  if (!ids.length) return;
  (async () => {
    const n = await integration(userId);
    if (!n) return;
    for (const pageId of ids) await notion.trashPage({ token: n.access_token, pageId });
  })().catch((err) => console.error("[notion-sync] trash", err.message));
}

// 노션 → 앱. 반환: { updated, added, removed } (노션 미연결이면 null)
async function pull(userId) {
  const n = await integration(userId);
  if (!n) return null;
  const now = pool.kst();
  const today = now.slice(0, 10);
  const windowStart = addDays(today, -7);
  // 노션 last_edited_time은 분 단위라 2분 겹쳐서 읽는다 (같은 값을 두 번 적용해도 결과는 같다)
  const since = n.last_synced_at ? new Date(Date.parse(n.last_synced_at.replace(" ", "T") + "+09:00") - 2 * 60000).toISOString() : null;
  const { pages, complete } = await notion.changedPages({ token: n.access_token, ref: n.target_ref, since, windowStart });

  const [subjects] = await pool.query("SELECT subject_id, name FROM subjects WHERE user_id = ?", [userId]);
  const subjectId = (name) => subjects.find((s) => squash(s.name) === squash(name))?.subject_id;
  const [linked] = await pool.query(`${TASK_ROW} WHERE t.user_id = ? AND t.external_id IS NOT NULL`, [userId]);
  const byPage = new Map(linked.map((t) => [norm(t.external_id), t]));

  let updated = 0;
  let added = 0;
  let removed = 0;
  const seen = new Set();
  for (const p of pages) {
    seen.add(norm(p.page_id));
    const t = byPage.get(norm(p.page_id));
    if (t) {
      // 날짜 범위로만 읽힌 페이지(노션에서 안 고친 것)는 건드리지 않는다. 앱에서 방금 고친 값을 옛 노션 값으로 덮지 않게
      if (since && p.last_edited < since) continue;
      const sets = [];
      const params = [];
      const set = (col, v) => sets.push(`${col} = ?`) && params.push(v);
      if (p.title && p.title !== t.title) set("title", p.title);
      if (p.due_at && p.due_at !== t.due_at) set("due_at", p.due_at);
      if (p.priority && p.priority !== t.priority) set("priority", p.priority);
      const sid = p.subject_name ? subjectId(p.subject_name) : undefined;
      if (sid && sid !== t.subject_id) set("subject_id", sid);
      // 체크박스는 완료/안 완료만 알 수 있어서, 안 완료면 '진행 중'은 그대로 둔다
      const status = p.status || (p.done === undefined ? undefined : p.done ? "done" : t.status === "done" ? "todo" : t.status);
      if (status && status !== t.status) {
        set("status", status);
        set("completed_at", status === "done" ? now : null);
      }
      if (!sets.length) continue;
      await pool.query(`UPDATE tasks SET ${sets.join(", ")} WHERE task_id = ? AND user_id = ?`, [...params, t.task_id, userId]);
      updated++;
    } else if (p.title && p.due_at && p.due_at.slice(0, 10) >= today && p.status !== "done" && p.done !== true) {
      // 노션에서 새로 만든 페이지 → 할 일 (이미 지난 날짜·완료된 페이지는 가져오지 않는다)
      await pool.query(
        "INSERT INTO tasks (user_id, subject_id, title, due_at, priority, status, source, external_id) VALUES (?, ?, ?, ?, ?, 'todo', 'notion', ?)",
        [userId, p.subject_name ? subjectId(p.subject_name) || null : null, p.title, p.due_at, p.priority || "mid", p.page_id],
      );
      added++;
    }
  }

  // 휴지통 확인: 날짜 범위 안인데 이번 목록에 안 나온 연결된 할 일만 하나씩 확인 (보통 0개)
  if (complete) {
    const missing = linked.filter((t) => t.status !== "done" && t.due_at && t.due_at.slice(0, 10) >= windowStart && !seen.has(norm(t.external_id))).slice(0, 20);
    const states = missing.length ? await notion.pageStates({ token: n.access_token, pageIds: missing.map((t) => t.external_id) }) : [];
    for (const st of states.filter((x) => x.gone)) {
      const t = missing.find((x) => x.external_id === st.page_id);
      if (t.source === "notion") await pool.query("DELETE FROM tasks WHERE task_id = ? AND user_id = ?", [t.task_id, userId]);
      else await pool.query("UPDATE tasks SET external_id = NULL WHERE task_id = ? AND user_id = ?", [t.task_id, userId]);
      removed++;
    }
  }

  await pool.query("UPDATE integrations SET last_synced_at = ? WHERE user_id = ? AND provider = 'notion'", [now, userId]);
  return { updated, added, removed };
}

module.exports = { push, pushNow, trash, pull };
