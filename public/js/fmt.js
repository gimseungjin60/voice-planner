// 지난 시각 표기 규칙 하나로 통일 (브라우저·EJS 공용). 에브리타임 게시판처럼 가까울수록 짧게:
// 방금 · 12분 전 · 오늘 14:05 · 어제 09:30 · 11/3 18:20 · (작년 이전) 25/11/3
// 입력은 DB에서 읽은 한국 시간 문자열 'YYYY-MM-DD HH:mm:ss'
function when(v) {
  if (!v) return "";
  const nowKst = new Date(Date.now() + 9 * 3600000).toISOString();
  const min = Math.floor((Date.now() - Date.parse(v.replace(" ", "T").slice(0, 19) + "+09:00")) / 60000);
  const day = v.slice(0, 10);
  const hm = v.slice(11, 16);
  if (min >= 0 && min < 1) return "방금";
  if (min >= 0 && min < 60) return `${min}분 전`;
  if (day === nowKst.slice(0, 10)) return `오늘 ${hm}`;
  if (day === new Date(Date.now() + 9 * 3600000 - 86400000).toISOString().slice(0, 10)) return `어제 ${hm}`;
  const m = Number(v.slice(5, 7));
  const d = Number(v.slice(8, 10));
  if (v.slice(0, 4) === nowKst.slice(0, 4)) return `${m}/${d} ${hm}`;
  return `${v.slice(2, 4)}/${m}/${d}`;
}

if (typeof module !== "undefined") module.exports = { when };
