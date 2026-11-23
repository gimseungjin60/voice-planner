// 모든 화면 공통: fetch 래퍼, 토스트, 확인 창, 로그아웃, 마감 D-day 표시, 과목 칩

// JSON API 호출. 실패하면 토스트로 알리고 { ok:false, error }를 돌려준다 (quiet면 토스트 생략)
async function api(url, { method = "GET", body, quiet = false } = {}) {
  try {
    const res = await fetch(url, {
      method,
      headers: body ? { "Content-Type": "application/json" } : {},
      body: body ? JSON.stringify(body) : undefined,
    });
    const json = await res.json().catch(() => ({ ok: false, error: "서버 응답을 읽을 수 없어요" }));
    if (res.status === 401 && !url.startsWith("/api/auth/")) location.href = "/login";
    if (!json.ok && !quiet) toast(json.error || "요청에 실패했어요");
    return json;
  } catch {
    if (!quiet) toast("네트워크 연결을 확인해주세요");
    return { ok: false, error: "네트워크 오류" };
  }
}

function toast(msg) {
  document.querySelector(".toast")?.remove();
  const el = document.createElement("div");
  el.className = "toast";
  el.setAttribute("role", "status");
  el.textContent = msg;
  document.body.append(el);
  setTimeout(() => el.remove(), 2600);
}

// iOS 알림 스타일 확인 창. await ask("삭제할까요?", "삭제") → true/false
function ask(message, okLabel = "확인") {
  const dlg = document.getElementById("confirm-dialog");
  if (!dlg?.showModal) return Promise.resolve(confirm(message));
  document.getElementById("confirm-msg").textContent = message;
  document.getElementById("confirm-ok").textContent = okLabel;
  dlg.returnValue = "";
  dlg.showModal();
  return new Promise((resolve) => dlg.addEventListener("close", () => resolve(dlg.returnValue === "ok"), { once: true }));
}

// 'YYYY-MM-DD HH:mm:ss'(한국 시간) → { label: "D-3 · 11/25 23:59", short: "D-3", cls: 24시간 이내 빨강 / 3일 이내 주황 }
function dueInfo(due) {
  if (!due) return { label: "마감 없음", short: "-", cls: "" };
  const ms = Date.parse(due.replace(" ", "T").slice(0, 16) + ":00+09:00") - Date.now();
  const todayKst = new Date(Date.now() + 9 * 3600000).toISOString().slice(0, 10);
  const days = Math.round((Date.parse(due.slice(0, 10)) - Date.parse(todayKst)) / 86400000);
  const short = days === 0 ? "D-day" : days > 0 ? `D-${days}` : `D+${-days}`;
  const cls = ms < 86400000 ? "due-red" : ms < 3 * 86400000 ? "due-orange" : "";
  return { label: `${short} · ${Number(due.slice(5, 7))}/${Number(due.slice(8, 10))} ${due.slice(11, 16)}`, short, cls };
}

function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}

// 과목 칩 HTML (과목 없으면 회색)
function chip(name, color) {
  if (!name) return `<span class="chip none">과목 없음</span>`;
  return `<span class="chip" style="--c:${esc(color || "#8e8e93")}">${esc(name)}</span>`;
}

// "3분 전" 같은 상대 시각 (한국 시간 문자열 기준)
function ago(kst) {
  if (!kst) return "아직 안 함";
  const min = Math.round((Date.now() - Date.parse(kst.replace(" ", "T") + "+09:00")) / 60000);
  if (min < 1) return "방금";
  if (min < 60) return `${min}분 전`;
  if (min < 1440) return `${Math.floor(min / 60)}시간 전`;
  return `${Math.floor(min / 1440)}일 전`;
}

document.addEventListener("DOMContentLoaded", () => {
  document.querySelectorAll("#logout-btn").forEach((b) =>
    b.addEventListener("click", async () => {
      await api("/api/auth/logout", { method: "POST" });
      location.href = "/login";
    }),
  );
  // 서버에서 그린 data-due 요소에 D-day·색상 붙이기
  document.querySelectorAll("[data-due]").forEach((el) => {
    const { label, cls } = dueInfo(el.dataset.due);
    el.textContent = label;
    if (cls && !el.dataset.done) el.classList.add(cls);
  });
});
