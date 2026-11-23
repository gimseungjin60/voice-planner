// 받은 편지함: Gmail에서 AI가 찾은 과제 후보 → [할 일로] / [무시]
const list = document.getElementById("inbox-list");
const subjectOptions = document.getElementById("subject-options").innerHTML;
let status = "pending";

const initial = (s) => (s || "?").replace(/["<].*/, "").trim().charAt(0).toUpperCase();

function itemHtml(it) {
  const settled = it.status !== "pending";
  const { label, cls } = dueInfo(it.ai_due_at);
  const due = it.ai_due_at ? it.ai_due_at.replace(" ", "T").slice(0, 16) : "";
  const recv = it.received_at ? `${Number(it.received_at.slice(5, 7))}/${Number(it.received_at.slice(8, 10))} ${it.received_at.slice(11, 16)}` : "";
  const found = settled
    ? `<div class="found-label"><svg class="i"><use href="#i-sparkles"/></svg>AI가 찾은 할 일</div>
       <div class="row-title" style="font-weight: 600">${esc(it.ai_title)}</div>
       <div class="found-meta">${chip(it.subject_name, it.subject_color)}<span class="due">${esc(label)}</span></div>`
    : `<div class="found-label"><svg class="i"><use href="#i-sparkles"/></svg>AI가 찾은 할 일 · 고쳐서 추가할 수 있어요</div>
       <input class="f-title" value="${esc(it.ai_title)}" maxlength="200" aria-label="할 일 제목" />
       <div class="found-meta">
         <input class="f-due" type="datetime-local" value="${due}" aria-label="마감" />
         <select class="f-subject" aria-label="과목">${subjectOptions}</select>
         <span class="due ${cls}">${it.ai_due_at ? esc(dueInfo(it.ai_due_at).short) : ""}</span>
       </div>`;
  const actions =
    it.status === "pending"
      ? `<button class="btn gray sm" data-ignore="${it.item_id}">무시</button><button class="btn sm" data-accept="${it.item_id}"><svg class="i sm"><use href="#i-plus"/></svg>할 일로</button>`
      : it.status === "accepted"
        ? `<span class="grow"><span class="badge green"><svg class="i"><use href="#i-check"/></svg>할 일에 추가됨</span></span><a class="btn plain sm" href="/tasks">보드에서 보기</a>`
        : `<span class="grow"><span class="badge">무시함</span></span>`;
  return `<article class="mail-card${settled ? " settled" : ""}" data-id="${it.item_id}">
    <div class="mail-head"><span class="avatar">${esc(initial(it.sender))}</span><span class="mail-from">${esc(it.sender)}</span><span class="fine">${recv}</span></div>
    <div class="mail-subject">${esc(it.subject)}</div>
    <div class="found">${found}</div>
    <div class="mail-actions">${actions}</div></article>`;
}

const EMPTY = {
  pending: ["check", "새로 찾은 과제가 없어요", "메일 확인을 누르면 최근 7일 메일을 다시 살펴봐요"],
  accepted: ["checklist", "아직 추가한 후보가 없어요", ""],
  ignored: ["x", "무시한 후보가 없어요", ""],
};

async function load() {
  const r = await api(`/api/inbox?status=${status}`, { quiet: true });
  if (!r.ok || !r.data.connected) {
    list.innerHTML = `<div class="card empty"><div class="empty-icon"><svg class="i"><use href="#i-mail"/></svg></div>
      <strong>구글 계정을 연결해 주세요</strong>연결하면 학교 메일에서 과제·마감을 자동으로 찾아줘요
      <div><a class="btn" href="/settings"><svg class="i"><use href="#i-link"/></svg>연동 설정으로</a></div></div>`;
    document.getElementById("mail-sync").disabled = true;
    return;
  }
  const { items, counts, last_synced_at } = r.data;
  document.getElementById("last-sync").textContent = `마지막 확인 ${ago(last_synced_at)}`;
  document.querySelectorAll("[data-n]").forEach((el) => (el.textContent = counts[el.dataset.n] || ""));
  if (!items.length) {
    const [icon, title, text] = EMPTY[status];
    list.innerHTML = `<div class="card empty"><div class="empty-icon"><svg class="i"><use href="#i-${icon}"/></svg></div><strong>${title}</strong>${text}</div>`;
    return;
  }
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
  if (b.dataset.accept) {
    const body = {
      title: cardEl.querySelector(".f-title").value,
      due_at: cardEl.querySelector(".f-due").value || null,
      subject_id: cardEl.querySelector(".f-subject").value || null,
    };
    b.classList.add("loading");
    const r = await api(`/api/inbox/${b.dataset.accept}/accept`, { method: "POST", body });
    if (r.ok) toast("할 일에 추가했어요");
  } else if (b.dataset.ignore) {
    const r = await api(`/api/inbox/${b.dataset.ignore}/ignore`, { method: "POST" });
    if (r.ok) toast("무시했어요");
  } else return;
  cardEl.style.transition = "opacity .25s, transform .25s";
  cardEl.style.opacity = "0";
  cardEl.style.transform = "scale(.97)";
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

document.getElementById("mail-sync").addEventListener("click", async (e) => {
  const b = e.currentTarget;
  b.classList.add("loading");
  const r = await api("/api/sync/gmail", { method: "POST" });
  b.classList.remove("loading");
  if (r.ok) toast(r.data.found ? `새 과제 후보 ${r.data.found}개를 찾았어요` : "새로 찾은 과제가 없어요");
  load();
});

load();
