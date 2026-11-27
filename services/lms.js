// 학교 LMS(인하공전 LearningX = Canvas) 달력 피드(iCal) 읽기. LMS 호출은 전부 여기서
// 피드 주소는 LMS 달력 → '달력 피드'에서 복사한 개인 주소 (주소 자체가 비밀번호 역할이라 토큰처럼 다룬다: 응답·로그에 내보내지 않음)
// 화면을 긁어오지 않는다. 학교가 다른 달력 앱에 연결하라고 열어 둔 공식 피드만 읽는다

function fail(status, message) {
  const err = new Error(message);
  err.status = status;
  err.expose = true;
  return err;
}

// 피드 주소 검사: https + 대학 도메인(.ac.kr) + Canvas 피드 경로만 (다른 서버로 요청을 보내는 데 쓰이지 않게)
const FEED_RE = /^https:\/\/[a-z0-9.-]+\.ac\.kr\/feeds\/calendars\/user_[A-Za-z0-9]+\.ics$/;
const validFeed = (url) => FEED_RE.test(String(url || "").trim());

// iCal 글자 되돌리기: \n \, \; \\
const unescape = (s) => s.replace(/\\n/gi, "\n").replace(/\\([,;\\])/g, "$1");

// iCal 시각 → KST 'YYYY-MM-DD HH:mm:ss'. 날짜만 있으면 그날 23:59 마감
function toKst(params, value) {
  const m = value.match(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})(Z?))?$/);
  if (!m) return null;
  const [, y, mo, d, h, mi, s, z] = m;
  if (!h || /VALUE=DATE(?!-)/.test(params)) return `${y}-${mo}-${d} 23:59:00`;
  if (z) return new Date(Date.UTC(+y, +mo - 1, +d, +h, +mi, +s) + 9 * 3600000).toISOString().replace("T", " ").slice(0, 19);
  return `${y}-${mo}-${d} ${h}:${mi}:${s}`; // TZID가 붙은 시각은 학교(한국) 시각으로 본다
}

// 피드 글 → 과제 목록 [{ uid, title, course_code, course_label, course_name, due_at, link }]
function parse(text, origin) {
  const lines = text.replace(/\r\n[ \t]/g, "").replace(/\n[ \t]/g, "").split(/\r?\n/);
  const items = [];
  let ev = null;
  for (const line of lines) {
    if (line === "BEGIN:VEVENT") ev = {};
    else if (line === "END:VEVENT") {
      if (ev) items.push(ev);
      ev = null;
    } else if (ev) {
      const m = line.match(/^([A-Z-]+)((?:;[^:]*)?):(.*)$/);
      if (m) ev[m[1]] = { params: m[2], value: m[3] };
    }
  }
  return items
    .filter((e) => e.UID && /^event-assignment/.test(e.UID.value) && e.SUMMARY && e.DTSTART)
    .map((e) => {
      const summary = unescape(e.SUMMARY.value).replace(/\s+/g, " ").trim();
      // 제목 끝의 [과목코드-분반-00-학과] → 과목 코드는 따로, 제목에서는 뺀다
      const code = summary.match(/\[([A-Z0-9]+)-[^\]]*\]\s*$/);
      let title = summary.replace(/\s*\[[^\]]*\]\s*$/, "").trim();
      // 시험은 제목에 '(과목명-분반-정규-학과)'가 붙어 온다 → 과목 이름으로 떼어 낸다
      const named = title.match(/\s*\(([^()]+?)-\d[A-Z]-[^()]*\)\s*$/);
      if (named) title = title.slice(0, named.index).trim();
      title = title.slice(0, 200);
      // 과제 바로가기: 달력 주소의 course_N + #assignment_M → /courses/N/assignments/M
      const url = e.URL?.value || "";
      const course = url.match(/course_(\d+)/)?.[1];
      const assignment = url.match(/assignment_(\d+)/)?.[1];
      return {
        uid: e.UID.value,
        title: title || summary.slice(0, 200),
        course_code: code ? code[1] : null,
        course_label: code ? code[0].replace(/^\[|\]$/g, "") : null,
        course_name: named ? named[1].trim() : null,
        due_at: toKst(e.DTSTART.params, e.DTSTART.value),
        link: course && assignment && origin ? `${origin}/courses/${course}/assignments/${assignment}` : null,
      };
    })
    .filter((x) => x.due_at);
}

// 피드 받아서 과제 목록으로. 실패하면 사용자용 메시지 에러
async function fetchAssignments(feedUrl) {
  if (!validFeed(feedUrl)) throw fail(400, "LMS 달력 피드 주소가 올바르지 않아요. LMS 달력 → '달력 피드'에서 복사한 주소를 넣어 주세요");
  let res;
  try {
    res = await fetch(feedUrl, { signal: AbortSignal.timeout(15000), redirect: "error" });
  } catch (err) {
    console.error("[lms]", err.name, err.message);
    throw fail(502, "LMS 서버에 연결하지 못했어요. 잠시 후 다시 시도해 주세요");
  }
  if (res.status === 401 || res.status === 403 || res.status === 404)
    throw fail(400, "LMS 피드 주소가 만료됐거나 바뀌었어요. LMS 달력에서 피드 주소를 다시 복사해 주세요");
  if (!res.ok) throw fail(502, "LMS 서버가 응답하지 않아요. 잠시 후 다시 시도해 주세요");
  const text = await res.text();
  if (text.length > 5 * 1024 * 1024 || !text.includes("BEGIN:VCALENDAR")) throw fail(502, "LMS 피드 형식을 읽지 못했어요");
  return parse(text, new URL(feedUrl).origin);
}

module.exports = { validFeed, parse, fetchAssignments };
