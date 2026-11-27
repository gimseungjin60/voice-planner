// 받은 편지함: Gmail에서 AI가 찾은 과제 후보 → [+ 할 일로] / [무시]
const list = document.getElementById("inbox-list");
const syncBtn = document.getElementById("mail-sync");
const subjectOptions = document.getElementById("subject-options").innerHTML;
let status = "pending";

// AI 요약 "항목: 내용" 줄들 → 라벨이 붙은 목록 (한 줄 요약은 굵게)
function summaryBlock(summary) {
  if (!summary) return "";
  const rows = summary
    .split("\n")
    .map((line) => line.match(/^([^:]{1,10}):\s*(.+)$/))
    .filter(Boolean);
  if (!rows.length) return "";
  return `<dl class="mail-summary" aria-label="AI 요약">${rows
    .map(([, k, v]) => `<div class="${k === "한 줄 요약" ? "headline" : ""}"><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`)
    .join("")}</dl>`;
}

// "박교수 <prof.park@…>" → 이름 / 주소 / 첫 글자
function parseSender(s = "") {
  const m = s.match(/^\s*"?([^"<]*)"?\s*<([^>]+)>/);
  const name = (m ? m[1] : s).trim() || s;
  return { name, addr: m ? m[2] : "", initial: name.charAt(0).toUpperCase() || "?" };
}


function itemHtml(it) {
  const { label, cls } = dueInfo(it.ai_due_at);
  const due = it.ai_due_at ? it.ai_due_at.replace(" ", "T").slice(0, 16) : "";
  const from = parseSender(it.sender);
  let body;
  if (it.status === "pending")
    body = `<div class="found">
        <div class="found-label"><svg class="i" aria-hidden="true"><use href="#i-sparkles"/></svg>AI가 정리한 할 일</div>
        <div class="found-read">
          <b class="grow">${esc(it.ai_title)}</b>
          ${it.ai_due_at ? `<span class="due ${cls}">${esc(label)}</span>` : `<span class="fine">마감 없음</span>`}
          ${chip(it.subject_name, it.subject_color, true)}
        </div>
        <div class="found-meta" hidden>
          <input class="f-title" value="${esc(it.ai_title)}" maxlength="200" aria-label="할 일 제목" />
          <input class="f-due pill" type="datetime-local" value="${due}" aria-label="마감" />
          <select class="f-subject pill" aria-label="과목">${subjectOptions}</select>
        </div>
        <div class="mail-actions">
          <button class="btn text" data-edit><svg class="i sm" aria-hidden="true"><use href="#i-pencil"/></svg>수정</button>
          <span class="grow"></span>
          <button class="btn line" data-ignore="${it.item_id}">무시</button>
          <button class="btn" data-accept="${it.item_id}"><svg class="i sm" aria-hidden="true"><use href="#i-plus"/></svg>할 일로</button>
        </div></div>`;
  else if (it.status === "accepted")
    body = `<div class="added-line"><svg class="i sm" aria-hidden="true"><use href="#i-check"/></svg>할 일에 추가됨
        <span class="grow">· ${esc(it.ai_title)}${it.ai_due_at ? ` · ${esc(label)}` : ""}</span><a class="link" href="/tasks">할 일 보기</a></div>`;
  else body = `<p class="fine" style="margin-top: 12px">무시한 후보예요. AI가 찾은 할 일: ${esc(it.ai_title)}</p>`;
  return `<article class="mail-card${it.status !== "pending" ? ` settled ${it.status}` : ""}" data-id="${it.item_id}">
    <div class="mail-head">
      <span class="avatar" style="${it.subject_color ? `--c:${esc(it.subject_color)}` : ""}" aria-hidden="true">${esc(from.initial)}</span>
      <div class="grow mail-from">${esc(from.name)}${from.addr ? `<small>${esc(from.addr)}</small>` : ""}</div>
      <div class="mail-time">${when(it.received_at)}</div>
    </div>
    <div class="mail-subject">${esc(it.subject)}</div>
    ${summaryBlock(it.summary)}
    ${body}</article>`;
}

const EMPTY = {
  pending: ["새 과제 후보가 없어요", "새 메일이 오면 AI가 과제·시험·마감을 찾아 여기에 모아 둘게요."],
  accepted: ["아직 추가한 후보가 없어요", "새 후보에서 [할 일로]를 누르면 여기에 모여요."],
  ignored: ["무시한 후보가 없어요", ""],
};

async function load() {
  const r = await api(`/api/inbox?status=${status}`, { quiet: true });
  if (!r.ok || !r.data.connected) {
    list.classList.remove("mail-list");
    list.innerHTML = `<div class="card empty"><div class="empty-icon blue"><svg class="i"><use href="#i-mail"/></svg></div>
      <p class="title">구글 계정을 연결해 주세요</p><p class="desc">연결하면 학교 메일에서 과제·마감을 자동으로 찾아줘요.</p>
      <a class="btn" href="/settings">연동 설정으로</a></div>`;
    syncBtn.disabled = true;
    return;
  }
  const { items, counts, last_synced_at } = r.data;
  document.getElementById("last-sync").textContent = `마지막 확인 ${ago(last_synced_at)}`;
  document.querySelectorAll("[data-n]").forEach((el) => (el.textContent = counts[el.dataset.n] ?? 0));
  document.getElementById("pending-count").textContent = counts.pending ? `새 후보 ${counts.pending}개` : "";
  list.classList.remove("mail-list");
  if (!items.length) {
    const [title, desc] = EMPTY[status];
    list.innerHTML = `<div class="empty-col" style="padding: 40px 24px"><p class="title" style="color: var(--ink); font-size: 15px; font-weight: 600">${title}</p>${desc ? `<p>${desc}</p>` : ""}</div>`;
    return;
  }
  list.classList.add("mail-list");
  list.innerHTML = items.map(itemHtml).join("");
  items.forEach((it) => {
    const sel = list.querySelector(`[data-id="${it.item_id}"] .f-subject`);
    if (sel) sel.value = it.subject_id || "";
  });
}

list.addEventListener("click", async (e) => {
  const b = e.target.closest("button");
  if (!b) return;
  const cardEl = b.closest(".mail-card");
  if (b.hasAttribute("data-edit")) {
    // 읽기 모드 → 고치기 모드. 고친 값은 [할 일로]에서 그대로 쓴다
    const meta = cardEl.querySelector(".found-meta");
    meta.hidden = false;
    cardEl.querySelector(".found-read").hidden = true;
    b.hidden = true;
    meta.querySelector(".f-title").focus();
    return;
  }
  if (b.dataset.accept) {
    const body = {
      title: cardEl.querySelector(".f-title").value,
      due_at: cardEl.querySelector(".f-due").value || null,
      subject_id: cardEl.querySelector(".f-subject").value || null,
    };
    b.classList.add("loading");
    const r = await api(`/api/inbox/${b.dataset.accept}/accept`, { method: "POST", body });
    b.classList.remove("loading");
    if (!r.ok) return;
    toast("할 일에 추가했어요", { action: { label: "할 일 보기", onClick: () => (location.href = "/tasks") } });
  } else if (b.dataset.ignore) {
    const r = await api(`/api/inbox/${b.dataset.ignore}/ignore`, { method: "POST" });
    if (!r.ok) return;
    toast("무시했어요");
  } else return;
  cardEl.style.opacity = "0";
  setTimeout(load, 220);
});

document.getElementById("inbox-filter").addEventListener("click", (e) => {
  const b = e.target.closest("button");
  if (!b) return;
  status = b.dataset.status;
  document.querySelectorAll("#inbox-filter button").forEach((x) => {
    x.classList.toggle("active", x === b);
    x.setAttribute("aria-selected", x === b);
  });
  load();
});

syncBtn.addEventListener("click", async () => {
  syncBtn.classList.add("loading");
  syncBtn.querySelector("span").textContent = "확인 중…";
  const r = await api("/api/sync/gmail", { method: "POST" });
  syncBtn.classList.remove("loading");
  syncBtn.querySelector("span").textContent = "메일 확인";
  if (r.ok && r.data.ai_failed) toast("메일을 AI로 분석하지 못했어요. 잠시 후 다시 시도해 주세요", { type: "fail" });
  else if (r.ok) {
    const parts = [];
    if (r.data.auto_added) parts.push(`중요 메일 ${r.data.auto_added}개는 할 일에 바로 추가했어요`);
    if (r.data.found) parts.push(`새 과제 후보 ${r.data.found}개를 찾았어요`);
    toast(parts.join(" · ") || "새로 찾은 과제가 없어요", { type: "sync" });
  }
  load();
});

load();
