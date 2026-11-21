// 시간표: 과목 추가·수정·삭제 (저장 후 새로고침해서 표를 다시 그림)
const subjects = JSON.parse(document.getElementById("subjects-data").textContent);
const form = document.getElementById("subject-form");
const rows = document.getElementById("schedule-rows");
let editingId = null;

function addRow(s = {}) {
  const el = document.getElementById("row-tpl").content.firstElementChild.cloneNode(true);
  if (s.day_of_week !== undefined) el.querySelector(".r-day").value = s.day_of_week;
  if (s.start_time) el.querySelector(".r-start").value = s.start_time.slice(0, 5);
  if (s.end_time) el.querySelector(".r-end").value = s.end_time.slice(0, 5);
  el.querySelector(".r-room").value = s.room || "";
  el.querySelector(".r-del").addEventListener("click", () => el.remove());
  rows.append(el);
}

function openForm(s) {
  editingId = s?.subject_id || null;
  document.getElementById("form-title").textContent = s ? "과목 수정" : "과목 추가";
  document.getElementById("s-name").value = s?.name || "";
  document.getElementById("s-prof").value = s?.professor || "";
  document.getElementById("s-color").value = s?.color || "#6C8EF5";
  document.getElementById("subject-error").textContent = "";
  rows.innerHTML = "";
  (s?.schedules.length ? s.schedules : [{}]).forEach(addRow);
  form.classList.remove("hidden");
  form.scrollIntoView({ behavior: "smooth" });
}

document.getElementById("new-subject").addEventListener("click", () => openForm(null));
document.getElementById("add-row").addEventListener("click", () => addRow());
document.getElementById("cancel-form").addEventListener("click", () => form.classList.add("hidden"));
document.querySelectorAll("[data-edit]").forEach((b) =>
  b.addEventListener("click", () => openForm(subjects.find((s) => s.subject_id === Number(b.dataset.edit)))),
);
document.querySelectorAll("[data-delete]").forEach((b) =>
  b.addEventListener("click", async () => {
    if (!confirm("과목을 삭제할까요? 시간표도 함께 지워지고, 할 일·메모는 '과목 없음'이 돼요.")) return;
    const r = await api(`/api/subjects/${b.dataset.delete}`, { method: "DELETE" });
    if (r.ok) location.reload();
  }),
);

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  const body = {
    name: document.getElementById("s-name").value,
    professor: document.getElementById("s-prof").value,
    color: document.getElementById("s-color").value,
    schedules: [...rows.children].map((el) => ({
      day_of_week: Number(el.querySelector(".r-day").value),
      start_time: el.querySelector(".r-start").value,
      end_time: el.querySelector(".r-end").value,
      room: el.querySelector(".r-room").value,
    })),
  };
  const r = await api(editingId ? `/api/subjects/${editingId}` : "/api/subjects", { method: editingId ? "PUT" : "POST", body });
  if (r.ok) return location.reload();
  document.getElementById("subject-error").textContent = r.error;
});
