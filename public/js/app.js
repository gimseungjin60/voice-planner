// 모든 화면 공통: fetch 래퍼, 토스트, 로그아웃, 마감 D-day 표시

// JSON API 호출. 실패하면 토스트로 알리고 { ok:false, error }를 돌려준다
async function api(url, { method = "GET", body } = {}) {
  try {
    const res = await fetch(url, {
      method,
      headers: body ? { "Content-Type": "application/json" } : {},
      body: body ? JSON.stringify(body) : undefined,
    });
    const json = await res.json().catch(() => ({ ok: false, error: "서버 응답을 읽을 수 없어요" }));
    if (res.status === 401 && !url.startsWith("/api/auth/login")) location.href = "/login";
    if (!json.ok) toast(json.error || "요청에 실패했어요");
    return json;
  } catch {
    toast("네트워크 오류가 발생했어요");
    return { ok: false, error: "네트워크 오류" };
  }
}

function toast(msg) {
  const el = document.createElement("div");
  el.className = "toast";
  el.setAttribute("role", "status");
  el.textContent = msg;
  document.body.append(el);
  setTimeout(() => el.remove(), 2500);
}

// 'YYYY-MM-DD HH:mm:ss'(한국 시간) → { label: "D-3 · 11/25 23:59", cls: 24시간 이내 빨강 / 3일 이내 주황 }
function dueInfo(due) {
  if (!due) return { label: "마감 없음", cls: "" };
  const ms = Date.parse(due.replace(" ", "T").slice(0, 16) + ":00+09:00") - Date.now();
  const todayKst = new Date(Date.now() + 9 * 3600000).toISOString().slice(0, 10);
  const days = Math.round((Date.parse(due.slice(0, 10)) - Date.parse(todayKst)) / 86400000);
  const d = days === 0 ? "D-day" : days > 0 ? `D-${days}` : `D+${-days}`;
  const cls = ms < 86400000 ? "due-red" : ms < 3 * 86400000 ? "due-orange" : "";
  return { label: `${d} · ${due.slice(5, 7)}/${due.slice(8, 10)} ${due.slice(11, 16)}`, cls };
}

function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}

document.addEventListener("DOMContentLoaded", () => {
  document.getElementById("logout-btn")?.addEventListener("click", async () => {
    await api("/api/auth/logout", { method: "POST" });
    location.href = "/login";
  });
  // 서버에서 그린 data-due 요소에 D-day·색상 붙이기
  document.querySelectorAll("[data-due]").forEach((el) => {
    const { label, cls } = dueInfo(el.dataset.due);
    el.textContent = label;
    if (cls) el.classList.add(cls);
  });
});
