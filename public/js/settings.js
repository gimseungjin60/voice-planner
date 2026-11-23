// 연동 설정: 구글(캘린더+Gmail) 상태·연결·해제, 노션 토큰 저장·내보내기, 음성 지원 상태
const $ = (id) => document.getElementById(id);
const SCOPE = { calendar: "캘린더", gmail: "메일 읽기" };

async function load() {
  const r = await api("/api/integrations", { quiet: true });
  const g = r.ok ? r.data.google : { connected: false };
  const n = r.ok ? r.data.notion : { connected: false };

  // 구글
  if (!g.connected) {
    $("g-status").innerHTML = `<span class="status-dot">연결 안 됨</span>`;
    $("g-actions").innerHTML = `<a class="btn sm" href="/auth/google">구글 계정 연결</a>`;
    $("g-detail").classList.add("hidden");
  } else {
    $("g-status").innerHTML = g.expired
      ? `<span class="status-dot warn">연결 만료</span><span>${esc(g.account_email || "")}</span>`
      : `<span class="status-dot ok">연결됨</span><span>${esc(g.account_email || "")}</span>`;
    $("g-actions").innerHTML = g.expired
      ? `<a class="btn sm" href="/auth/google">다시 연결</a>`
      : `<button class="btn plain danger sm" id="g-off">연결 해제</button>`;
    $("g-detail").classList.remove("hidden");
    $("g-scopes").innerHTML = (g.scopes || []).map((s) => `<span class="badge blue">${SCOPE[s] || esc(s)}</span>`).join("");
    $("g-sync").textContent = `연결 ${g.connected_at?.slice(5, 10).replace("-", "/") || ""} · 마지막 동기화 ${ago(g.last_synced_at)}`;
    $("g-sync-now").disabled = !!g.expired;
    $("g-off")?.addEventListener("click", async () => {
      if (!(await ask("구글 연동을 해제할까요?\n이미 가져온 일정과 후보는 남아요.", "해제"))) return;
      if ((await api("/api/integrations/google", { method: "DELETE" })).ok) load();
    });
  }

  // 노션
  $("n-status").innerHTML = n.connected
    ? `<span class="status-dot ok">연결됨</span><span>토큰 ${esc(n.token_hint || "")}</span>`
    : `<span class="status-dot">연결 안 됨</span>`;
  $("n-actions").innerHTML = n.connected ? `<button type="button" class="btn sm secondary" id="n-export"><svg class="i sm"><use href="#i-export"/></svg>이번 주 내보내기</button>` : "";
  $("n-token").placeholder = n.connected ? "새 토큰으로 바꿀 때만 입력" : "secret_… 또는 ntn_…";
  if (n.target_ref) $("n-db").value = n.target_ref;
  $("n-export")?.addEventListener("click", async (e) => {
    const b = e.currentTarget;
    b.classList.add("loading");
    const res = await api("/api/notion/export", { method: "POST" });
    b.classList.remove("loading");
    if (res.ok) toast(`노션에 할 일 ${res.data.exported}개를 내보냈어요`);
  });
}

$("g-sync-now").addEventListener("click", async (e) => {
  const b = e.currentTarget;
  b.classList.add("loading");
  const [cal, mail] = await Promise.all([api("/api/sync/calendar", { method: "POST" }), api("/api/sync/gmail", { method: "POST", quiet: true })]);
  b.classList.remove("loading");
  if (cal.ok) toast(`일정 ${cal.data.synced}개, 새 과제 후보 ${mail.data?.found ?? 0}개`);
  load();
});

$("notion-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const body = { token: $("n-token").value.trim(), target_ref: $("n-db").value.trim() };
  if (!body.target_ref) return toast("데이터베이스 ID를 입력하세요");
  const r = await api("/api/integrations/notion", { method: "PUT", body });
  if (!r.ok) return;
  $("n-token").value = "";
  toast("노션 설정을 저장했어요");
  load();
});

// 음성 지원 상태
$("stt-status").innerHTML = Voice.sttSupported
  ? `<span class="status-dot ok">사용 가능</span><span>한국어 (ko-KR)</span>`
  : `<span class="status-dot warn">이 브라우저는 지원 안 함</span><span>Chrome·Edge에서 사용하세요. 대신 직접 입력할 수 있어요</span>`;
$("tts-status").innerHTML = Voice.ttsSupported ? `<span class="status-dot ok">사용 가능</span>` : `<span class="status-dot warn">지원 안 함</span>`;
$("tts-test").addEventListener("click", () => Voice.speak("안녕하세요. 보이스 플래너가 오늘 브리핑을 이렇게 읽어드려요."));

load();
