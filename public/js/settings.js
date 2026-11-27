// 연동 설정: 구글(캘린더+Gmail) 상태·연결·해제, 노션 토큰 저장·내보내기·양방향 동기화, LMS 피드 저장·과제 가져오기·과목 연결, 음성 지원 상태
const $ = (id) => document.getElementById(id);
const SCOPE = { calendar: ["calendar", "캘린더"], gmail: ["mail", "메일 읽기"] };

async function load() {
  const r = await api("/api/integrations", { quiet: true });
  const g = r.ok ? r.data.google : { connected: false };
  const n = r.ok ? r.data.notion : { connected: false };
  loadLms(r.ok ? r.data.lms : { connected: false });

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
  const [cal, mail, notion, lms] = await Promise.all([
    api("/api/sync/calendar", { method: "POST", quiet: true }),
    api("/api/sync/gmail", { method: "POST", quiet: true }),
    api("/api/notion/sync", { method: "POST", quiet: true }),
    api("/api/lms/sync", { method: "POST", quiet: true }),
  ]);
  b.classList.remove("loading");
  b.querySelector("span").textContent = "지금 동기화";
  toast(syncMessage(cal, mail, notion, lms), { type: cal.ok && mail.ok && !mail.data.ai_failed ? "sync" : "fail" });
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

// LMS: 피드 주소 저장 → 과제 가져오기 → 과목 코드 ↔ 내 과목 연결
function lmsResult(d) {
  const parts = [];
  if (d.added) parts.push(`새 과제 ${d.added}개`);
  if (d.updated) parts.push(`바뀐 ${d.updated}개`);
  if (d.removed) parts.push(`LMS에서 없어진 ${d.removed}개 정리`);
  const msg = parts.length ? `LMS에서 ${parts.join(" · ")}를 반영했어요` : "LMS에 새로 가져올 과제가 없어요";
  return d.skipped ? `${msg} (이미 적어 둔 ${d.skipped}개는 건너뜀)` : msg;
}
async function lmsSyncNow(btn) {
  btn?.classList.add("loading");
  const res = await api("/api/lms/sync", { method: "POST" });
  btn?.classList.remove("loading");
  if (!res.ok) return;
  toast(lmsResult(res.data), { type: "sync" });
  load();
}

function loadLms(l) {
  $("l-status").innerHTML = l.connected
    ? `<span class="status-dot ok">연결됨</span><span>${esc(l.host || "")}</span><span>마지막 가져오기 ${l.last_synced_at ? ago(l.last_synced_at) : "아직 없음"}</span>`
    : `<span class="status-dot">연결 안 됨</span><span>LMS 과제·시험 마감을 할 일로 가져와요</span>`;
  $("lms-form").classList.toggle("collapsed", !!l.connected);
  $("l-actions").innerHTML = l.connected
    ? `<button type="button" class="btn text sm" id="l-edit" aria-expanded="false">주소 바꾸기</button>
       <button type="button" class="btn line sm" id="l-sync"><svg class="i sm" aria-hidden="true"><use href="#i-sync"/></svg><span>지금 가져오기</span></button>
       <button type="button" class="btn text sm" id="l-off">연결 해제</button>`
    : "";
  $("l-feed").placeholder = l.connected ? "새 피드 주소로 바꿀 때만 입력" : "https://lms-app.inhatc.ac.kr/feeds/calendars/user_….ics";
  $("l-edit")?.addEventListener("click", (e) => {
    const open = $("lms-form").classList.toggle("collapsed") === false;
    e.currentTarget.setAttribute("aria-expanded", String(open));
    e.currentTarget.textContent = open ? "접기" : "주소 바꾸기";
    if (open) $("l-feed").focus();
  });
  $("l-sync")?.addEventListener("click", (e) => lmsSyncNow(e.currentTarget));
  $("l-off")?.addEventListener("click", async () => {
    if (!(await ask("LMS 연결을 해제할까요?\n이미 가져온 과제는 할 일에 남아요.", "연결 해제"))) return;
    if ((await api("/api/integrations/lms", { method: "DELETE" })).ok) load();
  });
  $("l-detail").classList.toggle("hidden", !l.connected);
  if (l.connected) loadCourses();
}

// 과목 연결 목록: 피드에 나온 과목 코드마다 예시 과제 + 내 과목 고르기 (고르면 바로 저장하고 다시 가져온다)
async function loadCourses() {
  $("l-courses").innerHTML = `<li><span class="skel" style="width: 200px; margin: 6px 0"></span></li>`;
  const [cr, sr] = await Promise.all([api("/api/lms/courses", { quiet: true }), api("/api/subjects", { quiet: true })]);
  if (!cr.ok) {
    $("l-courses").innerHTML = `<li class="fine">${esc(cr.error || "과목 목록을 불러오지 못했어요")}</li>`;
    return;
  }
  const subjects = sr.ok ? sr.data : [];
  if (!cr.data.length) {
    $("l-courses").innerHTML = `<li class="fine">LMS 달력에 과제가 아직 없어요</li>`;
    return;
  }
  $("l-courses-help").textContent = subjects.length
    ? "LMS 과목 코드를 내 과목에 연결하면 가져온 과제에 과목이 붙어요. 이름이 같으면 자동으로 연결돼요."
    : "과목 메뉴에서 시간표 과목을 먼저 만들면 가져온 과제에 과목을 붙일 수 있어요.";
  $("l-courses").innerHTML = cr.data
    .map((c) => {
      // "" = 자동(과목 이름으로 찾기) · "0" = 과목 없이 · 숫자 = 그 과목
      const autoName = c.auto && c.subject_id ? subjects.find((s) => s.subject_id === c.subject_id)?.name : null;
      const picked = c.auto ? "" : String(c.subject_id ?? "");
      const opts = [`<option value="">${autoName ? `자동 · ${esc(autoName)}` : "자동 (같은 이름 과목 없음)"}</option>`, `<option value="0">과목 없이 가져오기</option>`]
        .concat(subjects.map((s) => `<option value="${s.subject_id}">${esc(s.name)}</option>`))
        .join("")
        .replace(`value="${picked}"`, `value="${picked}" selected`);
      return `<li class="lms-course"><div class="grow"><div class="code">${esc(c.name || c.label || c.code)}${c.name ? ` <span class="fine num">${esc(c.label || c.code)}</span>` : ""}</div>
        <div class="sample">${esc(c.samples.join(" · "))}${c.upcoming ? ` · 남은 마감 ${c.upcoming}개` : ""}</div></div>
        <select class="pill" data-code="${esc(c.code)}" aria-label="${esc(c.name || c.code)} 과목 연결">${opts}</select></li>`;
    })
    .join("");
  $("l-courses").querySelectorAll("select").forEach((sel) =>
    sel.addEventListener("change", async () => {
      const map = {};
      $("l-courses").querySelectorAll("select").forEach((x) => x.value !== "" && (map[x.dataset.code] = Number(x.value)));
      const res = await api("/api/lms/courses", { method: "PUT", body: { map } });
      if (!res.ok) return;
      toast("과목 연결을 저장하고 가져온 과제에 반영했어요");
      loadCourses();
    }),
  );
}

$("lms-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const feed = $("l-feed").value.trim();
  if (!feed) return $("l-feed").focus();
  const btn = e.submitter;
  btn?.classList.add("loading");
  const r = await api("/api/integrations/lms", { method: "PUT", body: { feed_url: feed } });
  btn?.classList.remove("loading");
  if (!r.ok) return;
  $("l-feed").value = "";
  await lmsSyncNow(); // 저장하자마자 한 번 가져온다
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
