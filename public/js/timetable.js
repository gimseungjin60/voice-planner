// 시간표: 과목 추가·수정·삭제 시트 (저장 후 새로고침해서 표를 다시 그림). 지금 시각 선은 app.js
const subjects = JSON.parse(document.getElementById("subjects-data").textContent);
const dialog = document.getElementById("subject-dialog");
const form = document.getElementById("subject-form");
const rows = document.getElementById("schedule-rows");
const colorInput = document.getElementById("s-color");
const nameInput = document.getElementById("s-name");
const preview = document.getElementById("s-preview");
const errBox = document.getElementById("subject-error");
let editingId = null;

function pickColor(c) {
  colorInput.value = c;
  preview.style.setProperty("--c", c);
  document.querySelectorAll(".swatch").forEach((s) => {
    const on = s.dataset.color.toLowerCase() === c.toLowerCase();
    s.classList.toggle("on", on);
    s.setAttribute("aria-pressed", on);
  });
}
document.getElementById("swatches").addEventListener("click", (e) => e.target.dataset.color && pickColor(e.target.dataset.color));
colorInput.addEventListener("input", () => pickColor(colorInput.value));
nameInput.addEventListener("input", () => (preview.textContent = nameInput.value.trim() || "과목명"));

function addRow(s = {}) {
  const el = document.getElementById("row-tpl").content.firstElementChild.cloneNode(true);
  if (s.day_of_week !== undefined) el.querySelector(".r-day").value = s.day_of_week;
  if (s.start_time) el.querySelector(".r-start").value = s.start_time.slice(0, 5);
  if (s.end_time) el.querySelector(".r-end").value = s.end_time.slice(0, 5);
  el.querySelector(".r-room").value = s.room || "";
  el.querySelector(".r-del").addEventListener("click", () => el.remove());
  rows.append(el);
}

function clearErrors() {
  errBox.textContent = "";
  form.querySelectorAll("[aria-invalid]").forEach((el) => el.removeAttribute("aria-invalid"));
}

function openForm(s) {
  editingId = s?.subject_id || null;
  document.getElementById("form-title").textContent = s ? "과목 수정" : "과목 추가";
  nameInput.value = s?.name || "";
  preview.textContent = s?.name || "과목명";
  document.getElementById("s-prof").value = s?.professor || "";
  pickColor(s?.color || "#6C8EF5");
  clearErrors();
  rows.innerHTML = "";
  (s?.schedules.length ? s.schedules : [{}]).forEach(addRow);
  dialog.showModal();
  nameInput.focus();
}

// 화면에서 먼저 잡을 수 있는 오류: 과목명 비었음, 끝 시간이 시작보다 빠름
function validate() {
  clearErrors();
  const problems = [];
  if (!nameInput.value.trim()) {
    nameInput.setAttribute("aria-invalid", "true");
    problems.push("과목명을 입력해 주세요");
  }
  [...rows.children].forEach((el) => {
    const end = el.querySelector(".r-end");
    if (end.value <= el.querySelector(".r-start").value) {
      end.setAttribute("aria-invalid", "true");
      problems.push("끝 시간은 시작 시간보다 늦어야 해요");
    }
  });
  if (problems.length) errBox.textContent = problems.length > 1 ? `고칠 곳이 ${problems.length}군데 있어요 · ${problems[0]}` : problems[0];
  return !problems.length;
}

document.getElementById("new-subject").addEventListener("click", () => openForm(null));
document.getElementById("add-row").addEventListener("click", () => addRow());
["cancel-form", "cancel-x"].forEach((id) => document.getElementById(id).addEventListener("click", () => dialog.close()));
document.querySelectorAll("[data-edit]").forEach((b) =>
  b.addEventListener("click", () => openForm(subjects.find((s) => s.subject_id === Number(b.dataset.edit)))),
);
document.querySelectorAll("[data-delete]").forEach((b) =>
  b.addEventListener("click", async () => {
    if (!(await ask(`‘${b.dataset.name}’ 과목을 삭제할까요?\n시간표도 함께 지워지고, 할 일·메모는 ‘과목 없음’이 돼요.`, "삭제"))) return;
    const r = await api(`/api/subjects/${b.dataset.delete}`, { method: "DELETE" });
    if (r.ok) location.reload();
  }),
);

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  if (!validate()) return;
  const body = {
    name: nameInput.value,
    professor: document.getElementById("s-prof").value,
    color: colorInput.value,
    schedules: [...rows.children].map((el) => ({
      day_of_week: Number(el.querySelector(".r-day").value),
      start_time: el.querySelector(".r-start").value,
      end_time: el.querySelector(".r-end").value,
      room: el.querySelector(".r-room").value,
    })),
  };
  const r = await api(editingId ? `/api/subjects/${editingId}` : "/api/subjects", { method: editingId ? "PUT" : "POST", body, quiet: true });
  if (r.ok) return location.reload();
  errBox.textContent = r.error;
  if (/과목명|이름/.test(r.error)) nameInput.setAttribute("aria-invalid", "true");
});
