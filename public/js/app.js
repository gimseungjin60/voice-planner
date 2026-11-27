// 모든 화면 공통: fetch 래퍼, 토스트, 확인 창, 로그아웃, 마감 D-day 표시, 과목 칩, 시간표 지금 선

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
    if (!json.ok && !quiet) toast(json.error || "요청에 실패했어요", { type: "fail" });
    return json;
  } catch {
    if (!quiet) toast("저장하지 못했어요 · 연결을 확인해 주세요", { type: "fail" });
    return { ok: false, error: "네트워크 오류" };
  }
}

// 토스트: 화면 아래 가운데. 성공 3초, 실행 취소가 붙으면 4초, 실패(fail)는 직접 닫을 때까지
// toast("옮겼어요", { action: { label: "실행 취소", onClick } }) / toast("…", { type: "fail" })
const TOAST_ICON = { ok: "check-circle", sync: "sync", fail: "alert" };
function toast(msg, { type = "ok", action } = {}) {
  const wrap = document.getElementById("toast-wrap") || document.body;
  wrap.querySelector(".toast")?.remove();
  const el = document.createElement("div");
  el.className = `toast ${type}`;
  el.setAttribute("role", type === "fail" ? "alert" : "status");
  el.innerHTML = `<svg class="i" aria-hidden="true"><use href="#i-${TOAST_ICON[type] || TOAST_ICON.ok}"/></svg><span class="msg"></span>`;
  el.querySelector(".msg").textContent = msg;
  if (action) {
    const b = document.createElement("button");
    b.className = "action";
    b.textContent = action.label;
    b.addEventListener("click", () => {
      el.remove();
      action.onClick();
    });
    el.append(b);
  }
  const x = document.createElement("button");
  x.className = "icon-btn";
  x.setAttribute("aria-label", "닫기");
  x.innerHTML = `<svg class="i sm"><use href="#i-x"/></svg>`;
  x.addEventListener("click", () => el.remove());
  el.append(x);
  wrap.append(el);
  if (type !== "fail") setTimeout(() => el.remove(), action ? 4000 : 3000);
}

// 확인 대화상자. 첫 줄은 질문(제목), 나머지는 설명. await ask("삭제할까요?\n되돌릴 수 없어요.", "삭제") → true/false
function ask(message, okLabel = "확인") {
  const dlg = document.getElementById("confirm-dialog");
  if (!dlg?.showModal) return Promise.resolve(confirm(message));
  const [title, ...rest] = message.split("\n");
  document.getElementById("confirm-msg").textContent = title;
  document.getElementById("confirm-desc").textContent = rest.join("\n");
  document.getElementById("confirm-ok").textContent = okLabel;
  dlg.returnValue = "";
  dlg.showModal();
  return new Promise((resolve) => dlg.addEventListener("close", () => resolve(dlg.returnValue === "ok"), { once: true }));
}

// 'YYYY-MM-DD HH:mm:ss'(한국 시간) → { label: "D-3 · 11/25 23:59", short: "D-3", cls }
// D-숫자는 달력 날짜 차이, 색은 남은 시간(24시간 미만 빨강, 72시간 미만 주황, 그 외 회색 — 명세 6번)
// 이미 지난 마감은 빨강 위에 due-over를 더해 진하게 채운다 (임박과 지남을 구분)
function dueInfo(due) {
  if (!due) return { label: "마감 없음", short: "-", cls: "" };
  const ms = Date.parse(due.replace(" ", "T").slice(0, 16) + ":00+09:00") - Date.now();
  const todayKst = new Date(Date.now() + 9 * 3600000).toISOString().slice(0, 10);
  const days = Math.round((Date.parse(due.slice(0, 10)) - Date.parse(todayKst)) / 86400000);
  const short = ms < 0 ? "지남" : days === 0 ? "D-day" : `D-${days}`;
  const cls = ms < 0 ? "due-red due-over" : ms < 86400000 ? "due-red" : ms < 3 * 86400000 ? "due-orange" : "";
  return { label: `${short} · ${md(due)} ${due.slice(11, 16)}`, short, cls };
}

function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}

// 'YYYY-MM-DD …' → "11/23"
function md(v) {
  return v ? `${Number(v.slice(5, 7))}/${Number(v.slice(8, 10))}` : "";
}

// 과목 칩 HTML (과목 없으면 회색). sm이면 목록 행용 작은 칩
function chip(name, color, sm = false) {
  const size = sm ? " sm" : "";
  if (!name) return `<span class="chip none${size}">과목 없음</span>`;
  return `<span class="chip${size}" style="--c:${esc(color || "#8e8e93")}">${esc(name)}</span>`;
}

// 우선순위 막대: 높음 3칸 · 보통 2칸 · 낮음 1칸
const PRIORITY_LABEL = { high: "높음", mid: "보통", low: "낮음" };
function prio(p) {
  return `<span class="prio ${p}" role="img" aria-label="우선순위 ${PRIORITY_LABEL[p]}"><span class="bars" aria-hidden="true"><i></i><i></i><i></i></span>${PRIORITY_LABEL[p]}</span>`;
}

// 마지막 동기화 같은 지난 시각. 표기 규칙은 fmt.js의 when() 하나로 통일 (방금 · 12분 전 · 오늘 14:05 …)
function ago(kst) {
  return kst ? when(kst) : "아직 안 함";
}

// 주간 시간표(#tt) 오늘 열에 지금 시각 빨간 선 + 왼쪽 눈금에 시각 (한국 시간)
function ttNowLine() {
  const tt = document.getElementById("tt");
  const col = Number(tt?.dataset.todayCol ?? -1);
  if (col < 0) return;
  const kst = new Date(Date.now() + 9 * 3600000);
  const min = kst.getUTCHours() * 60 + kst.getUTCMinutes() - Number(tt.dataset.from) * 60;
  if (min < 0 || min > tt.style.getPropertyValue("--slots") * 30) return;
  const top = `calc(${min / 30} * var(--slot))`;
  const line = document.createElement("div");
  line.className = "tt-now";
  line.style.gridColumn = col + 2;
  line.style.marginTop = top;
  const label = document.createElement("div");
  label.className = "tt-now-label";
  label.style.marginTop = top;
  label.textContent = kst.toISOString().slice(11, 16);
  tt.append(line, label);
}

document.addEventListener("DOMContentLoaded", () => {
  document.getElementById("logout-btn")?.addEventListener("click", async () => {
    await api("/api/auth/logout", { method: "POST" });
    location.href = "/login";
  });
  ttNowLine();
  // 펼침 메뉴(프로필 · 할 일 '…'): 바깥을 누르거나 Esc를 누르면 닫는다. 화면이 다시 그려져도 동작하도록 그때그때 찾는다
  document.addEventListener("click", (e) =>
    document.querySelectorAll("details.user-menu[open], details.pop[open]").forEach((m) => !m.contains(e.target) && (m.open = false)),
  );
  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    document.querySelectorAll("details.user-menu[open], details.pop[open]").forEach((m) => {
      m.open = false;
      m.querySelector("summary").focus();
    });
  });
  // 내비 받은 편지함 배지 = 새 후보 개수 (0이거나 연동 전이면 숨김)
  const badge = document.getElementById("nav-inbox-badge");
  if (badge)
    api("/api/inbox?status=pending", { quiet: true }).then((r) => {
      const n = (r.ok && r.data.counts?.pending) || 0;
      badge.textContent = n || "";
      badge.setAttribute("aria-label", `새 후보 ${n}개`);
    });
  // 서버에서 그린 data-due 요소에 D-day·색상 붙이기
  document.querySelectorAll("[data-due]").forEach((el) => {
    const { label, cls } = dueInfo(el.dataset.due);
    el.textContent = label;
    // cls가 "due-red due-over"처럼 두 개일 수 있어 나눠서 붙인다 (공백 든 문자열은 classList.add가 예외를 던져 뒤 항목이 전부 비었음)
    if (cls && !el.dataset.done) el.classList.add(...cls.split(" "));
  });
});

// 동기화 결과 안내 문구 (대시보드·연동 설정 공통). 캘린더·메일 중 하나만 실패해도 이유를 같이 보여준다
function syncMessage(cal, mail) {
  if (!cal.ok && !mail.ok) return cal.error || mail.error || "동기화하지 못했어요";
  const parts = [cal.ok ? `일정 ${cal.data.synced}개` : `일정 실패: ${cal.error}`];
  if (!mail.ok) parts.push(`메일 실패: ${mail.error}`);
  else if (mail.data.ai_failed) parts.push("메일 분석은 다음 동기화 때 다시 시도해요");
  else {
    if (mail.data.auto_added) parts.push(`중요 메일 ${mail.data.auto_added}개는 할 일에 바로 추가`);
    parts.push(`새 과제 후보 ${mail.data.found}개`);
  }
  return `동기화했어요 · ${parts.join(", ")}`;
}
