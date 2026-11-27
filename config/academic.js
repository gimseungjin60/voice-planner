// 학사일정 (인하공업전문대학 2026학년도, https://www.inhatc.ac.kr/kr/123/subview.do · 2026.07.14 수정본 기준)
// 시간표 수업은 학기 안이면서 공휴일이 아닌 날에만 보여준다. 학기가 바뀌면 이 파일만 고치면 된다
// 날짜는 모두 한국 시간 'YYYY-MM-DD'

// 수업이 있는 기간 (개강일 ~ 종강일)
const SEMESTERS = [
  { name: "2026-1학기", start: "2026-03-03", end: "2026-06-19" },
  { name: "2026-2학기", start: "2026-08-31", end: "2026-12-11" },
];

// 수업이 없는 날 (공휴일·대체휴일·명절 연휴)
const HOLIDAYS = {
  "2026-03-01": "삼일절",
  "2026-03-02": "삼일절 대체휴일",
  "2026-05-05": "어린이날",
  "2026-05-25": "부처님오신날 대체휴일",
  "2026-06-03": "전국동시지방선거",
  "2026-06-06": "현충일",
  "2026-08-15": "광복절",
  "2026-08-17": "광복절 대체휴일",
  "2026-09-24": "추석 연휴",
  "2026-09-25": "추석",
  "2026-09-26": "추석 연휴",
  "2026-10-03": "개천절",
  "2026-10-05": "개천절 대체휴일",
  "2026-10-09": "한글날",
  "2026-12-25": "성탄절",
  "2027-01-01": "새해 첫날",
  "2027-02-06": "설 연휴",
  "2027-02-07": "설 연휴",
  "2027-02-08": "설",
  "2027-02-09": "설 연휴",
};

// 달력에 이름만 표시하는 학사 기간 (수업은 그대로 있음)
const PERIODS = [
  { name: "중간종합평가", start: "2026-10-19", end: "2026-10-23" },
  { name: "기말종합평가", start: "2026-12-07", end: "2026-12-11" },
  { name: "기말종합평가", start: "2026-06-15", end: "2026-06-19" },
  { name: "보강주간", start: "2026-06-09", end: "2026-06-12" },
];
const MARKS = {
  "2026-03-03": "1학기 개강",
  "2026-06-19": "1학기 종강",
  "2026-08-31": "2학기 개강",
  "2026-12-11": "2학기 종강",
  "2027-02-12": "학위수여식",
};

const semesterOf = (ymd) => SEMESTERS.find((s) => ymd >= s.start && ymd <= s.end) || null;

// 그날 시간표 수업이 있나: 학기 안이고 공휴일이 아니어야 한다
const classOn = (ymd) => !!semesterOf(ymd) && !HOLIDAYS[ymd];

// 그날을 한 줄로: 공휴일 > 개강·종강 > 시험 기간 > 방학. 평범한 학기 날은 null
function dayNote(ymd) {
  if (HOLIDAYS[ymd]) return { kind: "holiday", label: HOLIDAYS[ymd] };
  if (MARKS[ymd]) return { kind: "mark", label: MARKS[ymd] };
  const p = PERIODS.find((x) => ymd >= x.start && ymd <= x.end);
  if (p) return { kind: "period", label: p.name };
  if (!semesterOf(ymd)) return { kind: "break", label: "방학" };
  return null;
}

// 수업이 없는 날의 이유 (브리핑·비서 안내용). 수업 있는 날은 null
function noClassReason(ymd) {
  if (HOLIDAYS[ymd]) return HOLIDAYS[ymd];
  if (!semesterOf(ymd)) return "방학";
  return null;
}

module.exports = { SEMESTERS, HOLIDAYS, classOn, dayNote, noClassReason, semesterOf };
