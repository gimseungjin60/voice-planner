# 목표
말하면 정리되는 대학생 플래너 "보이스 플래너"를 개발한다.
- nodejs application, express package, ejs view template, mysql2
- AWS EC2에 배포, 실제 MySQL DB 사용
- 음성(STT/TTS) + AI(Claude)로 할 일을 자동 정리

# 대상 사용자
할 일·과제 마감·수업이 여기저기 흩어져 있는 대학생.
"교수님이 다음 주 화요일까지 리포트 내래" 같은 말을 그냥 말로 남기고 싶은 사람.

# database environment
database: voiceplanner (schema.sql 참고, 8개 테이블)
- users: 회원 (email unique, bcrypt 해시, role user/admin)
- subjects: 과목 (사용자별, 카드 색상)
- schedules: 시간표 (과목 1:N, 요일·시작·끝·강의실)
- voice_memos: 음성메모 (STT 원문, AI 요약, 메모/강의 구분)
- tasks: 할 일 (마감일, 우선순위, 상태, 출처 manual/ai, 어떤 메모에서 나왔는지)
- briefings: 아침 브리핑 (사용자·날짜당 1개)
- ai_logs: AI 호출 기록 (기능, 입력, 출력, 토큰, 성공 여부)
- integrations: 외부 연동 토큰 (2차 목표용, 1차에서는 테이블만 생성)

# API
응답 형식: 성공 { ok: true, data } / 실패 { ok: false, error }

| Method | Endpoint | 설명 | 로그인 |
|---|---|---|---|
| POST | /api/auth/signup | 회원가입 (email 중복 409) | X |
| POST | /api/auth/login | 로그인, 세션 생성 | X |
| POST | /api/auth/logout | 로그아웃, 세션 삭제 | O |
| GET | /api/auth/me | 내 정보 | O |
| GET | /api/subjects | 내 과목 + 시간표 | O |
| POST | /api/subjects | 과목 추가 (시간표 배열 포함) | O |
| PUT / DELETE | /api/subjects/:id | 과목 수정 / 삭제 | O |
| POST | /api/memos | 음성 텍스트 저장 → AI 분석 → 할 일 후보 반환 | O |
| GET | /api/memos?page=1 | 내 메모 목록 (10개씩, 최신순) | O |
| GET / DELETE | /api/memos/:id | 메모 상세 / 삭제 | O |
| POST | /api/memos/:id/confirm | AI 후보 중 선택한 것만 tasks로 저장 | O |
| GET | /api/tasks?status=&subject= | 할 일 목록 (필터) | O |
| POST | /api/tasks | 할 일 직접 추가 | O |
| PATCH | /api/tasks/:id | 상태·내용 수정 | O |
| DELETE | /api/tasks/:id | 삭제 | O |
| GET | /api/tasks/summary | 총정리: 오늘·이번 주·지난 마감 개수 + AI 우선순위 Top3 | O |
| GET | /api/briefing/today | 오늘 브리핑 (없으면 생성 후 저장) | O |
| GET | /api/admin/users | 회원 목록 | admin |
| DELETE | /api/admin/users/:id | 회원 삭제 | admin |
| GET | /api/admin/stats | 가입자 수, 메모 수, AI 호출 수 | admin |

# 화면 (EJS)
1. 로그인 / 회원가입
2. 대시보드 (메인)
   - 상단: 오늘 날짜 + "브리핑 듣기" 버튼 (TTS)
   - 카드: 오늘 수업, 오늘 마감, 이번 주 마감, D-day 가장 가까운 것
   - AI 추천 "오늘 이것부터" Top3
   - 가운데 큰 마이크 버튼 → 음성 메모 화면으로
3. 음성 메모
   - 마이크 버튼 누르면 실시간으로 글자가 찍힘 (STT interim 결과)
   - 정지 → "AI 분석" → 요약 + 할 일 후보 카드 (과목·마감 자동 채움)
   - 후보 체크 후 "할 일로 저장"
   - 탭 전환: 짧은 메모 / 강의 녹음(긴 텍스트 요약)
4. 메모 목록 / 상세 (페이지네이션, 과목 필터)
5. 할 일 보드: 할 일 · 진행 중 · 완료 3열 카드, 과목 색상 표시, 마감 임박 빨간 표시
6. 시간표: 주간 표, 과목 추가/수정
7. 관리자: 회원 목록·삭제, 통계 카드 (email role이 admin일 때만 메뉴 노출)

# AI 기능 (services/ai.js)
모델: Claude Haiku 계열 (빠르고 저렴). 모든 호출은 ai_logs에 기록.
1. extractTasks(transcript, subjects, today)
   - 입력: STT 원문, 내 과목 이름 목록, 오늘 날짜
   - 출력 JSON: { summary, subject, tasks: [{ title, due_at, priority }] }
   - "다음 주 화요일" 같은 상대 날짜를 오늘 기준 실제 날짜로 변환
   - 과목은 내 과목 목록 중에서만 고르고 없으면 null
2. summarizeLecture(transcript) → 핵심 3~5줄 + 시험에 나올 것 같은 포인트
3. prioritize(tasks) → 마감·우선순위·상태 보고 오늘 할 Top3와 이유 한 줄
4. makeBriefing(todayClasses, dueTasks) → 30초 분량 한국어 문장 (TTS용)
- 실패하거나 JSON 파싱이 안 되면 앱은 계속 동작 (메모 원문만 저장, 에러 표시)

# logic
1. 비로그인 사용자는 로그인 화면으로 redirect
2. 비밀번호는 bcrypt(saltRounds 10)로 해시
3. 모든 데이터는 로그인한 사용자 것만 조회·수정 (user_id 조건)
4. 목록은 최신순, 10개씩 페이지네이션
5. 할 일 상태 변경은 카드 버튼 클릭 → PATCH → 화면 즉시 갱신 (새로고침 없이)
6. 마감 24시간 이내 = 빨강, 3일 이내 = 주황
7. 브라우저가 Web Speech API를 지원하지 않으면 텍스트 입력창으로 대체

# styles
- 모던 카드 UI, 둥근 모서리, 부드러운 그림자, 과목별 포인트 색상
- 모바일에서도 깨지지 않게 (반응형)
- 디자인 시안은 사용자가 따로 제공 예정 → 받으면 CSS 변수(:root)만 바꿔서 적용할 수 있게 색상·폰트를 변수로 관리

# 2차 목표 (나중에)
Spring Boot + Spring AI로 MCP 서버를 만들어 같은 DB에 연결.
도구: get_today_tasks, add_task, get_timetable, summarize_week + 구글 캘린더·노션 연동.
Claude Desktop에서 "이번 주 마감 노션에 정리해줘"가 되는 것이 목표.
