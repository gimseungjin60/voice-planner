// 구글 캘린더·Gmail 호출은 전부 여기서 (토큰 저장·갱신 포함). 토큰은 로그·응답에 절대 내보내지 않는다
const { google } = require("googleapis");
const pool = require("../db");

const SCOPES = ["https://www.googleapis.com/auth/calendar.events", "https://www.googleapis.com/auth/gmail.readonly"];
const TZ = "Asia/Seoul";

const configured = () => !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET && process.env.GOOGLE_REDIRECT_URI);

// 상태 코드가 붙은 에러 (라우터의 next(err)가 그대로 JSON으로 내보낸다)
function fail(status, message) {
  const err = new Error(message);
  err.status = status;
  return err;
}

function oauthClient() {
  if (!configured()) throw fail(503, "서버에 구글 연동 설정(.env)이 없어요");
  return new google.auth.OAuth2(process.env.GOOGLE_CLIENT_ID, process.env.GOOGLE_CLIENT_SECRET, process.env.GOOGLE_REDIRECT_URI);
}

// 동의 화면 주소. prompt=consent: 다시 연결할 때도 refresh token을 새로 받는다
function authUrl(state) {
  return oauthClient().generateAuthUrl({ access_type: "offline", prompt: "consent", scope: SCOPES, state, include_granted_scopes: true });
}

// 밀리초 → KST 'YYYY-MM-DD HH:mm:ss'
const kstFromMs = (ms) => (ms ? pool.kst(new Date(ms)) : null);

// callback의 code → 토큰 → integrations 저장 (refresh token이 안 오면 기존 값 유지)
async function saveTokens(userId, code) {
  const { tokens } = await oauthClient().getToken(code);
  await pool.query(
    `INSERT INTO integrations (user_id, provider, access_token, refresh_token, expires_at, scopes, connected_at)
     VALUES (?, 'google', ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE access_token = VALUES(access_token), refresh_token = COALESCE(VALUES(refresh_token), refresh_token),
       expires_at = VALUES(expires_at), scopes = VALUES(scopes), connected_at = VALUES(connected_at)`,
    [userId, tokens.access_token, tokens.refresh_token || null, kstFromMs(tokens.expiry_date), tokens.scope || SCOPES.join(" "), pool.kst()],
  );
  return (tokens.scope || "").split(" ");
}

// 갱신 토큰이 취소·만료됐을 때: refresh token을 지워 '만료' 상태로 만든다 (가져온 데이터는 유지)
async function markExpired(userId) {
  await pool.query("UPDATE integrations SET refresh_token = NULL, expires_at = ? WHERE user_id = ? AND provider = 'google'", [
    "2000-01-01 00:00:00",
    userId,
  ]);
}

// 로그인한 사용자의 인증 클라이언트. 연결이 없거나 만료면 상태 코드가 붙은 에러
async function authFor(userId) {
  const [[row]] = await pool.query("SELECT access_token, refresh_token, expires_at FROM integrations WHERE user_id = ? AND provider = 'google'", [userId]);
  if (!row) throw fail(400, "구글 계정을 먼저 연결하세요");
  if (!row.refresh_token && row.expires_at && row.expires_at < pool.kst()) throw fail(409, "구글 연결이 만료됐어요. 연동 설정에서 다시 연결해 주세요");
  const auth = oauthClient();
  auth.setCredentials({
    access_token: row.access_token,
    refresh_token: row.refresh_token || undefined,
    expiry_date: row.expires_at ? Date.parse(row.expires_at.replace(" ", "T") + "+09:00") : undefined,
  });
  // 라이브러리가 access token을 자동 갱신하면 DB에도 반영
  auth.on("tokens", (t) => {
    pool
      .query("UPDATE integrations SET access_token = ?, expires_at = ?, refresh_token = COALESCE(?, refresh_token) WHERE user_id = ? AND provider = 'google'", [
        t.access_token,
        kstFromMs(t.expiry_date),
        t.refresh_token || null,
        userId,
      ])
      .catch((e) => console.error("[google:tokens]", e.message));
  });
  return auth;
}

// 구글 API 호출 래퍼: 토큰 문제(invalid_grant·401)는 '만료'로 기록하고 사용자용 메시지로 바꾼다
async function run(userId, fn) {
  const auth = await authFor(userId);
  try {
    return await fn(auth);
  } catch (err) {
    const code = err.response?.status || err.code;
    const reason = err.response?.data?.error || err.message;
    console.error("[google]", code, typeof reason === "string" ? reason : reason?.message || "");
    if (reason === "invalid_client") throw fail(503, "서버의 구글 클라이언트 설정(.env)이 올바르지 않아요");
    if (reason === "invalid_grant" || code === 401) {
      await markExpired(userId);
      throw fail(409, "구글 연결이 만료됐어요. 연동 설정에서 다시 연결해 주세요");
    }
    if (code === 403) throw fail(403, "구글 권한이 부족해요. 다시 연결할 때 캘린더·메일 권한을 모두 허용해 주세요");
    throw fail(502, "구글 서버와 통신하지 못했어요. 잠시 후 다시 시도해 주세요");
  }
}

// 구글 시각 → KST DATETIME 문자열. 종일 일정(date)은 끝 날짜가 '다음 날'이라 하루 빼서 23:59:59
function toKst(t, isEnd) {
  if (t?.dateTime) return pool.kst(new Date(t.dateTime));
  if (t?.date) {
    if (!isEnd) return `${t.date} 00:00:00`;
    const d = new Date(Date.parse(t.date + "T00:00:00Z") - 86400000).toISOString().slice(0, 10);
    return `${d} 23:59:59`;
  }
  return null;
}

// 기본 캘린더에서 [from, to] (KST 'YYYY-MM-DD') 일정 목록. 취소된 일정은 빼고 반복 일정은 펼친다
function listEvents(userId, from, to) {
  return run(userId, async (auth) => {
    const calendar = google.calendar({ version: "v3", auth });
    const items = [];
    let pageToken;
    do {
      const { data } = await calendar.events.list({
        calendarId: "primary",
        timeMin: `${from}T00:00:00+09:00`,
        timeMax: `${to}T23:59:59+09:00`,
        singleEvents: true,
        orderBy: "startTime",
        maxResults: 250,
        pageToken,
      });
      items.push(...(data.items || []));
      pageToken = data.nextPageToken;
    } while (pageToken && items.length < 1000);
    return items
      .filter((e) => e.status !== "cancelled" && e.start)
      .map((e) => ({
        external_id: e.id,
        title: String(e.summary || "(제목 없음)").slice(0, 200),
        start_at: toKst(e.start, false),
        end_at: toKst(e.end, true) || toKst(e.start, false),
        location: e.location ? String(e.location).slice(0, 200) : null,
      }))
      .filter((e) => e.start_at && e.end_at >= e.start_at);
  });
}

// 구글 캘린더에 일정 만들기 → 구글 이벤트 ID
function insertEvent(userId, { title, start_at, end_at, location }) {
  return run(userId, async (auth) => {
    const calendar = google.calendar({ version: "v3", auth });
    const iso = (s) => s.replace(" ", "T").slice(0, 19);
    const { data } = await calendar.events.insert({
      calendarId: "primary",
      requestBody: {
        summary: title,
        location: location || undefined,
        start: { dateTime: iso(start_at), timeZone: TZ },
        end: { dateTime: iso(end_at), timeZone: TZ },
      },
    });
    return data.id;
  });
}

// 구글 캘린더에서 일정 지우기. 이미 지워졌으면(404·410) 성공으로 본다
function deleteEvent(userId, externalId) {
  return run(userId, async (auth) => {
    const calendar = google.calendar({ version: "v3", auth });
    try {
      await calendar.events.delete({ calendarId: "primary", eventId: externalId });
    } catch (err) {
      if (![404, 410].includes(err.response?.status)) throw err;
    }
  });
}

// 최근 7일 받은 메일 중 skipIds에 없는 것: 보낸 사람·제목·snippet만 (본문은 받지 않는다)
function recentMails(userId, skipIds, limit = 20) {
  return run(userId, async (auth) => {
    const gmail = google.gmail({ version: "v1", auth });
    const { data } = await gmail.users.messages.list({ userId: "me", q: "newer_than:7d -in:sent -in:chats -category:promotions -category:social", maxResults: 50 });
    const ids = (data.messages || []).map((m) => m.id).filter((id) => !skipIds.has(id)).slice(0, limit);
    const mails = [];
    for (const id of ids) {
      const { data: m } = await gmail.users.messages.get({ userId: "me", id, format: "metadata", metadataHeaders: ["From", "Subject"] });
      const header = (name) => m.payload?.headers?.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value || "";
      mails.push({
        id: m.id,
        sender: header("From").slice(0, 255),
        subject: header("Subject").slice(0, 500),
        snippet: String(m.snippet || "").slice(0, 300),
        received_at: kstFromMs(Number(m.internalDate)),
      });
    }
    return mails;
  });
}

module.exports = { configured, authUrl, saveTokens, listEvents, insertEvent, deleteEvent, recentMails };
