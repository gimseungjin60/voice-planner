// 일정 공유 화면: 공유 켜기·끄기, 링크 복사·바꾸기, 공개 범위, 일정 추가
const $ = (id) => document.getElementById(id);

// 공유 켜기
$("share-on")?.addEventListener("click", async (e) => {
  e.currentTarget.classList.add("loading");
  const res = await api("/api/share", { method: "POST", body: { visibility: "busy" } });
  if (res.ok) location.reload();
  else e.currentTarget.classList.remove("loading");
});

// 링크 복사 (clipboard API가 막힌 환경이면 입력칸을 선택해 둔다)
$("share-copy")?.addEventListener("click", async () => {
  const input = $("share-url");
  try {
    await navigator.clipboard.writeText(input.value);
    toast("링크를 복사했어요. 친구에게 보내 보세요");
  } catch {
    input.select();
    toast("링크를 선택했어요. 복사해서 보내 주세요");
  }
});
$("share-url")?.addEventListener("focus", (e) => e.target.select());

// 공개 범위: 고르면 바로 저장하고 '친구가 보는 화면'이면 새로 그린다
document.querySelectorAll('input[name="visibility"]').forEach((radio) =>
  radio.addEventListener("change", async () => {
    const panel = $("share-panel");
    const prev = panel.dataset.visibility;
    document.querySelectorAll(".level").forEach((l) => l.classList.toggle("on", l.contains(radio)));
    const res = await api("/api/share", { method: "PATCH", body: { visibility: radio.value } });
    if (!res.ok) {
      document.querySelector(`input[name="visibility"][value="${prev}"]`).checked = true;
      document
        .querySelectorAll(".level")
        .forEach((l) => l.classList.toggle("on", l.querySelector("input").checked));
      return;
    }
    panel.dataset.visibility = radio.value;
    if (new URLSearchParams(location.search).get("view") === "friend") location.reload();
    else toast("공개 범위를 바꿨어요");
  }),
);

$("share-regen")?.addEventListener("click", async () => {
  if (
    !(await ask(
      "새 링크로 바꿀까요?\n지금 링크는 바로 열리지 않아요. 새 링크를 다시 보내 줘야 해요.",
      "새 링크로",
    ))
  )
    return;
  const res = await api("/api/share/regenerate", { method: "POST" });
  if (!res.ok) return;
  $("share-url").value = res.data.url;
  document.querySelector(".share-link a").href = res.data.url;
  toast("새 링크를 만들었어요");
});

$("share-off")?.addEventListener("click", async () => {
  if (!(await ask("공유를 끌까요?\n친구가 가진 링크는 더 이상 열리지 않아요.", "공유 끄기")))
    return;
  const res = await api("/api/share", { method: "DELETE" });
  if (res.ok) location.reload();
});

// ---------- 일정 추가 (POST /api/events 재사용) ----------
const dlg = $("event-dialog");
const today = new Date().toLocaleString("sv-SE", { timeZone: "Asia/Seoul" }).slice(0, 10);
$("add-event-btn")?.addEventListener("click", () => {
  $("event-form").reset();
  $("ev-date").value = today;
  $("ev-error").classList.add("hidden");
  dlg.showModal();
  $("ev-title").focus();
});
$("ev-cancel")?.addEventListener("click", () => dlg.close());
$("event-form")?.addEventListener("submit", async (e) => {
  e.preventDefault();
  const err = $("ev-error");
  const title = $("ev-title").value.trim();
  const date = $("ev-date").value;
  const start = $("ev-start").value;
  const end = $("ev-end").value;
  if (end <= start) {
    err.textContent = "끝 시각은 시작 시각보다 늦어야 해요";
    return err.classList.remove("hidden");
  }
  const btn = $("ev-save");
  btn.classList.add("loading");
  const res = await api("/api/events", {
    method: "POST",
    body: { title, start_at: `${date} ${start}`, end_at: `${date} ${end}` },
    quiet: true,
  });
  btn.classList.remove("loading");
  if (!res.ok) {
    err.textContent = res.error;
    return err.classList.remove("hidden");
  }
  // 추가한 날짜가 있는 주로 이동해 바로 보여 준다
  const p = new URLSearchParams(location.search);
  p.set("w", date);
  location.search = p.toString();
});
