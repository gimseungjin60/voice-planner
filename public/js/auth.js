// 로그인 / 회원가입 폼
const form = document.getElementById("auth-form");
form.addEventListener("submit", async (e) => {
  e.preventDefault();
  const body = Object.fromEntries(new FormData(form));
  const btn = form.querySelector("button");
  btn.disabled = true;
  const r = await api(`/api/auth/${form.dataset.mode}`, { method: "POST", body });
  btn.disabled = false;
  if (r.ok) return (location.href = "/");
  document.getElementById("auth-error").textContent = r.error;
});
