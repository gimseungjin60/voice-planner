// 로그인 / 회원가입 폼
const form = document.getElementById("auth-form");
form.addEventListener("submit", async (e) => {
  e.preventDefault();
  const body = Object.fromEntries(new FormData(form));
  const btn = form.querySelector("button");
  const err = document.getElementById("auth-error");
  if (!body.email || !body.password) return (err.textContent = "이메일과 비밀번호를 입력하세요");
  btn.classList.add("loading");
  const r = await api(`/api/auth/${form.dataset.mode}`, { method: "POST", body, quiet: true });
  btn.classList.remove("loading");
  if (r.ok) return (location.href = "/");
  err.textContent = r.error;
  form.animate([{ transform: "translateX(0)" }, { transform: "translateX(-8px)" }, { transform: "translateX(8px)" }, { transform: "translateX(0)" }], { duration: 300 });
});
