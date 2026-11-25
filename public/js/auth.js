// 로그인 / 회원가입 폼
const form = document.getElementById("auth-form");
const btn = form.querySelector("button");
const err = document.getElementById("auth-error");
const label = btn.textContent;

function fail(msg) {
  err.innerHTML = `<svg class="i sm" aria-hidden="true"><use href="#i-alert"/></svg>`;
  err.append(msg);
  document.getElementById("password").setAttribute("aria-invalid", "true");
  form.classList.remove("shake");
  void form.offsetWidth; // 다시 흔들리게 애니메이션 초기화
  form.classList.add("shake");
}

form.addEventListener("input", () => {
  err.textContent = "";
  document.getElementById("password").removeAttribute("aria-invalid");
});

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  const body = Object.fromEntries(new FormData(form));
  if (!body.email || !body.password) return fail("이메일과 비밀번호를 입력해 주세요");
  btn.classList.add("loading");
  btn.textContent = form.dataset.mode === "signup" ? "가입하는 중…" : "로그인 중…";
  const r = await api(`/api/auth/${form.dataset.mode}`, { method: "POST", body, quiet: true });
  if (r.ok) return (location.href = "/");
  btn.classList.remove("loading");
  btn.textContent = label;
  fail(r.error);
});
