// 연동 설정: 구글(캘린더+Gmail) 상태·연결·해제, 노션 토큰 저장·내보내기·양방향 동기화, 음성 지원 상태
const $ = (id) => document.getElementById(id);
const SCOPE = { calendar: ["calendar", "캘린더"], gmail: ["mail", "메일 읽기"] };

async function load() {
  const r = await api("/api/integrations", { quiet: true });
  const g = r.ok ? r.data.google : { connected: false };
  const n = r.ok ? r.data.notion : { connected: false };

  // 구글 (만료되면 위에 '다시 연결' 배너)
  $("g-expired").classList.toggle("hidden", !(g.connected && g.expired));
  if (!g.connected) {
    $("g-status").innerHTML = `<span class="status-dot">연결 안 됨</span><span>캘린더 일정과 학교 메일 과제를 가져와요</span>`;
    $("g-actions").innerHTML = `<a class="btn" href="/auth/google">구글 계정 연결</a>`;
    $("g-detail").classList.add("hidden");
  } else {
    $("g-status").innerHTML = `<span class="status-dot ${g.expired ? "warn" : "ok"}">${g.expired ? "연결 만료" : "연결됨"}</span><span>${esc(g.account_email || "")}</span>`;
    $("g-actions").innerHTML = g.expired
      ? `<a class="btn" href="/auth/google">다시 연결</a>`
      : `<button type="button" class="btn line" id="g-off">연결 해제</button>`;
    $("g-detail").classList.remove("hidden");
    $("g-scopes").innerHTML = (g.scopes || [])
      .map((s) => {
        const [icon, label] = SCOPE[s] || ["check", esc(s)];
        return `<span class="badge"><svg class="i" aria-hidden="true"><use href="#i-${icon}"/></svg>${label}</span>`;
      })
      .join("");
    $("g-sync").textContent = g.expired
      ? `연결이 만료돼서 ${md(g.last_synced_at || g.connected_at)} 이후 새 일정과 메일을 가져오지 못했어요.`
      : `연결 ${md(g.connected_at)} · 마지막 동기화 ${ago(g.last_synced_at)}`;
    $("g-sync-now").classList.toggle("hidden", !!g.expired);
    $("g-off")?.addEventListener("click", async () => {
      if (!(await ask("구글 연결을 해제할까요?\n이미 가져온 일정과 후보는 남아요.", "연결 해제"))) return;
      if ((await api("/api/integrations/google", { method: "DELETE" })).ok) load();
    });
  }

  // 노션
  $("n-status").innerHTML = n.connected
    ? `<span class="status-dot ok">연결됨</span><span class="num">토큰 ${esc(n.token_hint || "")}</span><span>마지막 동기화 ${n.last_synced_at ? ago(n.last_synced_at) : "아직 없음"}</span>`
    : `<span class="status-dot">연결 안 됨</span><span>앱과 노션의 할 일을 서로 맞춰요</span>`;
  // 연결돼 있으면 입력 폼은 접고 [설정 바꾸기]로 연다. 처음 연결할 때만 3단계 안내 + 폼을 펼쳐 둔다
  $("notion-form").classList.toggle("collapsed", !!n.connected);
  $("n-actions").innerHTML = n.connected
    ? `<button type="button" class="btn text sm" id="n-edit" aria-expanded="false">설정 바꾸기</button>
       <button type="button" class="btn line sm" id="n-sync"><svg class="i sm" aria-hidden="true"><use href="#i-sync"/></svg><span>노션에서 가져오기</span></button>
       <button type="button" class="btn line sm" id="n-export"><svg class="i sm" aria-hidden="true"><use href="#i-export"/></svg><span>이번 주 할 일 내보내기</span></button>`
    : "";
  $("n-edit")?.addEventListener("click", (e) => {
    const open = $("notion-form").classList.toggle("collapsed") === false;
    e.currentTarget.setAttribute("aria-expanded", String(open));
    e.currentTarget.textContent = open ? "접기" : "설정 바꾸기";
    if (open) $("n-db").focus();
  });
  $("n-token").placeholder = n.connected ? "새 토큰으로 바꿀 때만 입력" : "ntn_ 또는 secret_으로 시작하는 토큰";
  if (n.target_ref) $("n-db").value = n.target_ref;
  $("n-sync")?.addEventListener("click", async (e) => {
    const b = e.currentTarget;
    b.classList.add("loading");
    const res = await api("/api/notion/sync", { method: "POST" });
    b.classList.remove("loading");
    if (!res.ok) return;
    const { updated, added, removed } = res.data;
    toast(updated + added + removed ? `노션에서 고친 ${updated}개 · 새로 ${added}개 · 지운 ${removed}개를 반영했어요` : "노션에서 바뀐 할 일이 없어요", { type: "sync" });
    load();
  });
  $("n-export")?.addEventListener("click", async (e) => {
    const b = e.currentTarget;
    b.classList.add("loading");
    const res = await api("/api/notion/export", { method: "POST" });
    b.classList.remove("loading");
    if (!res.ok) return;
    if (!res.data.exported) return toast("이번 주에 새로 내보낼 할 일이 없어요");
    toast(`할 일 ${res.data.exported}개를 내보냈어요${res.data.failed ? ` · ${res.data.failed}개 실패` : ""}`);
  });
}

$("g-sync-now").addEventListener("click", async (e) => {
  const b = e.currentTarget;
  b.classList.add("loading");
  b.querySelector("span").textContent = "동기화 중…";
  const [cal, mail, notion] = await Promise.all([
    api("/api/sync/calendar", { method: "POST", quiet: true }),
    api("/api/sync/gmail", { method: "POST", quiet: true }),
    api("/api/notion/sync", { method: "POST", quiet: true }),
  ]);
  b.classList.remove("loading");
  b.querySelector("span").textContent = "지금 동기화";
  toast(syncMessage(cal, mail, notion), { type: cal.ok && mail.ok && !mail.data.ai_failed ? "sync" : "fail" });
  load();
});

// 노션 주소·ID에서 32자리 데이터베이스 ID만 뽑는다 (하이픈 있는 형식도 허용). 못 찾으면 null
function notionId(v) {
  const m = v.replace(/-/g, "").match(/[0-9a-f]{32}/i);
  return m ? m[0].toLowerCase() : null;
}
$("n-db").addEventListener("input", () => {
  const v = $("n-db").value.trim();
  const id = notionId(v);
  $("n-db").removeAttribute("aria-invalid");
  $("n-db-help").textContent = !v ? "주소에서 32자리 ID를 찾아 저장해요." : id ? `찾은 ID: ${id}` : "주소에서 32자리 ID를 찾지 못했어요. 데이터베이스 페이지 주소인지 확인해 주세요.";
});

$("notion-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  $("n-db").removeAttribute("aria-invalid");
  const body = { token: $("n-token").value.trim(), target_ref: notionId($("n-db").value.trim()) };
  if (!body.target_ref) {
    $("n-db").setAttribute("aria-invalid", "true");
    $("n-db-help").textContent = "데이터베이스 주소나 32자리 ID를 넣어 주세요.";
    return $("n-db").focus();
  }
  const r = await api("/api/integrations/notion", { method: "PUT", body });
  if (!r.ok) return;
  $("n-token").value = "";
  toast("노션 설정을 저장했어요");
  load();
});

// 음성 지원 상태
$("stt-status").innerHTML = Voice.sttSupported
  ? `<span class="status-dot ok">사용 가능</span><span>한국어(ko-KR)</span>`
  : `<span class="status-dot warn">이 브라우저는 지원하지 않아요</span><span>Chrome·Edge에서 사용하세요</span>`;
$("tts-status").innerHTML = Voice.ttsSupported ? `<span class="status-dot ok">사용 가능</span>` : `<span class="status-dot warn">지원하지 않아요</span>`;
$("tts-test").addEventListener("click", () => Voice.speak("안녕하세요. 보이스 플래너가 오늘 브리핑을 이렇게 읽어드려요."));

// 구글 연결 화면에서 돌아왔을 때 결과 안내 (한 번만 보이고 주소에서 지운다)
const GOOGLE_RESULT = {
  connected: ["구글 계정을 연결했어요. 지금 동기화해 보세요"],
  partial: ["캘린더·메일 권한 중 일부만 허용됐어요. 다시 연결할 때 모두 체크해 주세요", "fail"],
  denied: ["구글 연결을 취소했어요", "fail"],
  error: ["구글 연결에 실패했어요. 다시 시도해 주세요", "fail"],
  unconfigured: ["서버에 구글 연동 설정이 아직 없어요", "fail"],
};
const googleResult = GOOGLE_RESULT[new URLSearchParams(location.search).get("google")];
if (googleResult) {
  toast(googleResult[0], googleResult[1] ? { type: googleResult[1] } : undefined);
  history.replaceState(null, "", location.pathname);
}

load();
