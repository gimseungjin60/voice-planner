# 목표
말하면 정리되는 대학생 플래너 "보이스 플래너"를 개발한다.
- nodejs application, express package, ejs view template, mysql2
- AWS EC2에 배포, 실제 MySQL DB 사용
- 음성(STT/TTS) + AI(Claude)로 할 일을 자동 정리
- 구글 캘린더·Gmail·노션을 서버(Express)에서 API로 불러와 MySQL에 저장하고 한 화면(통합 타임라인)에 보여준다
- 음성 비서: 말 한마디로 할 일·일정을 추가·조회·완료 (Claude tool use)

# 대상 사용자
할 일·과제 마감·수업이 여기저기 흩어져 있는 대학생.
"교수님이 다음 주 화요일까지 리포트 내래" 같은 말을 그냥 말로 남기고 싶은 사람.
수업은 시간표, 약속은 구글 캘린더, 과제 공지는 메일, 정리는 노션에 흩어져 있어 한 번에 보고 싶은 사람.

# database environment
database: voiceplanner (schema.sql 참고, 11개 테이블)
- users: 회원 (email unique, bcrypt 해시, role user/admin)
- subjects: 과목 (사용자별, 카드 색상)
- schedules: 시간표 (과목 1:N, 요일·시작·끝·강의실)
- voice_memos: 음성메모 (STT 원문, AI 요약, 메모/강의 구분)
- tasks: 할 일 (마감일, 우선순위, 상태, 출처 manual/ai/voice/gmail, 어떤 메모에서 나왔는지, 완료 시각)
- briefings: 아침 브리핑 (사용자·날짜당 1개)
- ai_logs: AI 호출 기록 (기능, 음성 비서가 실행한 도구, 입력, 출력, 토큰, 성공 여부)
- integrations: 외부 연동 (google = 캘린더+Gmail OAuth 토큰·권한, notion = integration 토큰·내보낼 DB ID, lms = 학교 LMS 달력 피드 주소·과목 코드 연결)
- events: 일정 (구글 캘린더에서 불러온 것 + 음성 비서로 만든 것, 구글 이벤트 ID로 중복 방지)
- inbox_items: 받은 편지함 (Gmail에서 AI가 과제·마감을 찾은 메일 = 할 일 후보, 수락하면 tasks로. 메일 본문은 저장 안 하고 AI 형식 요약만 저장)
- share_links: 일정 공유 링크 (사용자당 1개, 추측 불가 토큰, 공개 범위 busy/title/all, 열람 수). 끄면 행 삭제 (2026-11-27 추가)

흐름: 외부(구글·Gmail) → events / inbox_items → (수락·음성) → tasks → (내보내기) → 노션

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
| PATCH | /api/tasks/:id | 상태·내용 수정 (status가 done이 되면 completed_at=현재 시각, done에서 벗어나면 NULL) | O |
| DELETE | /api/tasks/:id | 삭제 | O |
| GET | /api/tasks/summary | 총정리: 오늘·이번 주·지난 마감 개수 + AI 우선순위 Top3 | O |
| GET | /api/briefing/today | 오늘 브리핑 (없으면 생성 후 저장) | O |
| GET | /api/admin/users | 회원 목록 | admin |
| DELETE | /api/admin/users/:id | 회원 삭제 | admin |
| GET | /api/admin/stats | 가입자 수, 메모 수, AI 호출 수 | admin |
| GET | /auth/google | 구글 로그인 동의 화면으로 redirect (calendar.events, gmail.readonly). 랜덤 state를 세션에 저장하고 callback에서 일치 확인(CSRF 방지) | O |
| GET | /auth/google/callback | 토큰 받아 integrations 저장 → 연동 설정 화면으로 | O |
| GET | /api/integrations | 내 연동 상태 (provider, 연결 시각, 마지막 동기화, 만료 여부). 토큰은 응답에 넣지 않음 | O |
| PUT | /api/integrations/notion | 노션 토큰·데이터베이스 ID 저장 | O |
| PUT | /api/integrations/lms | 학교 LMS 달력 피드 주소 저장 (https + .ac.kr + /feeds/calendars/user_….ics만, 저장 전에 한 번 읽어 확인) | O |
| DELETE | /api/integrations/:provider | 연동 해제 (해당 provider 데이터는 유지) | O |
| POST | /api/sync/calendar | 구글 캘린더 이번 달 1일~60일 뒤 일정을 events에 upsert (할 일 월간 달력용, 2026-11-27 변경). 같은 범위에서 구글 응답에 없는 provider=google 일정은 삭제 | O |
| POST | /api/sync/gmail | 최근 7일 메일 중 새 메일만 AI 분석 → 과제·마감이 있으면 inbox_items 추가, 중요+마감 있으면 tasks 바로 추가 | O |
| GET | /api/inbox?status=pending | 받은 편지함 후보 목록 | O |
| POST | /api/inbox/:id/accept | 후보 → tasks 저장(source='gmail'), status=accepted | O |
| POST | /api/inbox/:id/ignore | 후보 무시 | O |
| GET | /api/events?from=&to= | 내 일정 목록 | O |
| POST | /api/events | 일정 직접 추가 (구글 연결 시 구글 캘린더에도 생성하고 provider=google + 구글 이벤트 ID로 저장 → 다음 동기화 때 중복 없음) | O |
| DELETE | /api/events/:id | 일정 삭제 (구글 일정이면 구글에서도 삭제) | O |
| GET | /api/timeline?from=&to= | 통합 타임라인: 수업(schedules)+일정(events)+할 일 마감(tasks)을 시간순 하나의 배열로 | O |
| POST | /api/assistant | 음성 비서. body { text } → Claude tool use로 도구 실행 → { reply(TTS용 문장), actions[], pending } | O |
| POST | /api/notion/export | 이번 주(또는 선택한) 할 일을 노션 DB에 행으로 추가, tasks.external_id 기록 | O |
| POST | /api/notion/sync | 노션에서 고친 페이지를 할 일에 반영, 새 페이지(오늘 이후)는 할 일로 추가, 휴지통 페이지 정리 | O |
| POST | /api/lms/sync | LMS 피드의 과제·시험 중 오늘 이후 마감만 tasks(source='lms', external_id=과제 주소)로 추가, 마감 변경 반영, LMS에서 없어진 미완료 과제 정리 | O |
| GET | /api/lms/courses | 피드에 나온 과목 코드 목록 + 예시 과제 + 지금 연결된 내 과목 | O |
| PUT | /api/lms/courses | 과목 코드 → 내 과목 연결 저장 { map }, 저장 후 바로 다시 가져와 과목 반영 | O |
| GET | /api/share | 내 공유 링크 상태 (꺼져 있으면 null). { url, visibility, view_count, last_viewed_at } | O |
| POST | /api/share | 공유 켜기 (랜덤 토큰 생성, 기본 visibility=busy) | O |
| PATCH | /api/share | 공개 범위 바꾸기 { visibility: busy·title·all } | O |
| POST | /api/share/regenerate | 새 링크로 바꾸기 (예전 주소는 바로 무효, 열람 수 초기화) | O |
| DELETE | /api/share | 공유 끄기 (행 삭제 → 링크 무효) | O |
| GET | /s/:token?w=YYYY-MM-DD | 친구가 보는 읽기 전용 주간 일정 화면 (EJS). 지난주~8주 뒤까지 이동. 없는 토큰은 404 안내 | X |

# 화면 (EJS)
1. 로그인 / 회원가입
2. 대시보드 (메인) = 통합 타임라인
   - 상단: 오늘 날짜 + "브리핑 듣기" 버튼 (TTS) + "동기화" 버튼 (캘린더·Gmail)
   - 오늘/이번 주 탭: 수업·일정·마감을 시간순 한 줄로, 출처 아이콘(시간표·구글·할 일)과 과목 색상
   - 카드: 오늘 마감, 이번 주 마감, D-day 가장 가까운 것, 받은 편지함 새 후보 수
   - AI 추천 "오늘 이것부터" Top3
   - 가운데 큰 마이크 버튼 → 음성 메모 화면으로
3. 음성 메모
   - 마이크 버튼 누르면 실시간으로 글자가 찍힘 (STT interim 결과)
   - 정지 → "AI 분석" → 요약 + 할 일 후보 카드 (과목·마감 자동 채움)
   - 후보 체크 후 "할 일로 저장"
   - 탭 전환: 짧은 메모 / 강의 녹음(긴 텍스트 요약)
   - 강의 녹음은 실시간 자막 대신 녹음 파일을 10분 단위로 서버에 올려 OpenAI gpt-4o-mini-transcribe로 받아쓴다 (크롬 STT는 긴 녹음에서 끊김). 짧은 메모·음성 비서는 Web Speech 그대로
4. 메모 목록 / 상세 (페이지네이션, 과목 필터)
5. 할 일 보드: 할 일 · 진행 중 · 완료 3열 카드, 과목 색상 표시, 마감 임박 빨간 표시
   - 월간 달력 보기 (2026-11-27 추가): 할 일 마감 + 수업(시간표) + 구글 캘린더 일정을 한 달 칸에 시간순으로. 할 일·수업·구글 일정 켜고 끄기. 수업·일정은 보기만 (/api/timeline)
6. 시간표: 주간 표, 과목 추가/수정
   - 학사일정 (2026-11-27 추가): 시간표 수업은 학기(개강~종강) 안이면서 공휴일이 아닌 날에만 펼친다. 기준은 인하공전 2026학년도 학사일정(`config/academic.js`). 달력·주 보드·대시보드에 공휴일·종강·종합평가 기간을 작게 표시하고, 브리핑은 공휴일·방학이면 그 이유를 말한다
7. 관리자: 회원 목록·삭제, 통계 카드 (email role이 admin일 때만 메뉴 노출)
8. 받은 편지함: Gmail 후보 카드 (보낸 사람, 제목, AI 요약(한 줄 요약/할 일/마감/제출·준비), AI가 찾은 할 일·마감, 과목) + [할 일로] [무시]
9. 연동 설정: 구글 연결/재연결/해제, 노션 토큰·DB ID 입력, 마지막 동기화 시각
   - 노션 양방향 동기화 (2026-11-27 추가, `services/notion-sync.js`): 노션과 연결된 할 일(external_id)을 앱에서 고치면(제목·마감·과목·우선순위·완료) 그 페이지도 바로 고치고, 지우면 노션 휴지통으로 보낸다. 노션에서 고친 것은 대시보드 자동 동기화·'지금 동기화'·'노션에서 가져오기' 때 가져온다. 완료는 노션 DB에 상태(status) 속성이나 이름이 '완료'인 체크박스가 있을 때만 주고받는다
10. 음성 비서 (모든 화면 공통): 오른쪽 아래 플로팅 마이크 → 말하면 자막 → 실행 결과 토스트 + TTS 답변
11. 일정 공유 (/share, 프로필 메뉴·시간표 화면에서 진입. 2026-11-27 추가)
   - 한 주(월~일) 보드 한 장: 수업(과목색)·일정(검정)·마감(깃발 칩, 맨 위 줄)·하루 종일 일정. 겹치면 옆으로 나눠 배치. 주 이동, 오늘 표시
   - [일정 추가] 대화상자 (POST /api/events 재사용)
   - 공유 패널: 링크 만들기 / 복사 / 열어 보기 / 새 링크로 바꾸기 / 끄기, 친구가 연 횟수
   - 공개 범위 3단계: 바쁜 시간만(제목 대신 '바쁨') · 수업·일정 제목(과목명·강의실, 일정 제목) · 마감까지 모두(+ 안 끝난 할 일 마감 제목·과목)
   - [내 화면 | 친구가 보는 화면] 전환으로 공유 범위를 미리 확인
   - 친구 화면 /s/:token: 로그인 없이 읽기 전용, 내 메뉴·비서 없음. 데스크톱은 시간 격자, 900px 이하는 날짜별 목록

# AI 기능 (services/ai.js)
모델: Claude Haiku 계열 (빠르고 저렴). 모든 호출은 ai_logs에 기록.
1. extractTasks(transcript, subjects, today)
   - 입력: STT 원문, 내 과목 이름 목록, 오늘 날짜
   - 출력 JSON: { summary, subject, tasks: [{ title, due_at, priority }] }
   - "다음 주 화요일" 같은 상대 날짜를 오늘 기준 실제 날짜로 변환
   - 과목은 내 과목 목록 중에서만 고르고 없으면 null
2. summarizeLecture(transcript) → 핵심 3~5줄 + 시험에 나올 것 같은 포인트
3. prioritize(tasks) → 마감·우선순위·상태 보고 오늘 할 Top3와 이유 한 줄
4. makeBriefing(todayClasses, todayEvents, dueTasks, newInboxCount) → 30초 분량 한국어 문장 (TTS용)
5. runAssistant(text, context) → 음성 비서 (Claude tool use, 최대 3회 도구 호출 반복)
   - context: 오늘 날짜·요일, 14일 달력, 내 과목 목록
   - 도구: add_task, list_tasks, complete_task, add_event, list_schedule(수업+일정, 날짜 범위), find_free_slot(날짜, 길이), add_class(과목·요일·시작·끝·강의실: 시간표에 매주 수업 추가, 과목이 없으면 새로 만들고 같은 요일 수업과 겹치면 추가하지 않음. 2026-11-26 추가)
   - 일정이 수업·기존 일정과 겹치면 추가하지 않고 빈 시간을 제안 (사용자가 "좋아"라고 다시 말하면 추가)
   - 제안한 일정은 세션(req.session.pendingAction)에 보관하고 응답에 pending으로 알려준다. 다음 요청이 수락(좋아·응·그래)이면 그대로 실행, 다른 말이면 버린다
   - 출력: { reply, actions: [{ tool, input, result }] }, 도구 호출마다 ai_logs(feature='assistant', tool_name) 기록
6. extractFromMail(subject, sender, snippet, subjects, today) → { is_task, title, due_at, subject } (과제·시험·마감이 없으면 is_task=false)
7. transcribe(audio) → 강의 녹음 받아쓰기 (OpenAI gpt-4o-mini-transcribe, 분당 $0.003). ai_logs(feature='transcribe') 기록, 실패하면 null
8. speak(text) → 브리핑 음성 mp3 (OpenAI gpt-4o-mini-tts, 목소리 marin). 하루 1번 만들어 메모리에 캐시, 실패하면 브라우저 TTS로 대체. ai_logs(feature='tts')
- JSON이 필요한 함수(1·2·3·6)는 Claude 구조화 출력(JSON 스키마 지정)을 사용
- 실패하거나 JSON 파싱이 안 되면 앱은 계속 동작 (메모 원문만 저장, 에러 표시)

# logic
1. 비로그인 사용자는 로그인 화면으로 redirect
2. 비밀번호는 bcrypt(saltRounds 10)로 해시
3. 모든 데이터는 로그인한 사용자 것만 조회·수정 (user_id 조건)
4. 목록은 최신순, 10개씩 페이지네이션
5. 할 일 상태 변경은 카드 버튼 클릭 → PATCH → 화면 즉시 갱신 (새로고침 없이)
6. 마감 24시간 이내 = 빨강, 3일 이내 = 주황
7. 브라우저가 Web Speech API를 지원하지 않으면 텍스트 입력창으로 대체
8. 외부 API 호출은 services/google.js, services/notion.js, services/lms.js에서만. 브라우저는 우리 /api만 부른다
9. 동기화는 수동(버튼) + 대시보드 진입 시 마지막 동기화가 10분 지났으면 자동 1회
10. 구글 토큰 만료·취소 시 앱은 계속 동작하고 연동 설정에 "다시 연결" 표시 (DB에 있는 일정은 그대로 보여줌)
11. Gmail은 먼저 제목·보낸 사람·snippet만 AI에 보내 할 일 후보를 고른다. 후보로 뽑힌 메일만 본문(최대 4000자)을 AI에 보내 정해진 형식(한 줄 요약/할 일/마감/제출·준비, 메일에 없는 항목은 생략)으로 요약하고 요약만 inbox_items.summary에 저장한다. 본문은 저장하지 않는다. 이미 본 메시지 ID는 다시 분석하지 않음 (2026-11-26 결정)
   - 중요 메일 자동 추가 (2026-11-27 결정): AI가 후보마다 important를 함께 판단. 중요 = ① 교수·조교·학과·행정실의 과제·시험·퀴즈·발표 제출/일정(변경) ② 수강신청·성적 이의·장학금·등록금·졸업·휴복학 등 놓치면 불이익인 학사 마감 ③ 기업·기관 담당자가 나에게 직접 보낸 서류·회신·면접 요청. 여러 명 대상 홍보·행사·설문·선택 참여 공지는 제외. 중요하고 마감일이 있으면 받은 편지함을 거치지 않고 바로 tasks(source='gmail', priority='high', 그 마감일)로 추가하고 후보는 accepted로 남긴다. 나머지는 지금처럼 후보
12. 외부 토큰(구글·노션·LMS 피드 주소)은 integrations에만 저장하고 API 응답·로그·화면에 내보내지 않는다 (과제 범위에서 DB 암호화는 생략, DB 계정 접근 제한으로 대체)
13. 일정 공유 (2026-11-27 추가)
   - 공유 토큰은 crypto.randomBytes(24) base64url 32자. 공유 링크 자체이므로 본인 화면·/api/share 응답에는 보여준다 (외부 연동 토큰과 다름)
   - 친구 화면은 DB만 읽는다. 메일 내용·음성 메모·할 일 상세(우선순위·출처·메모)·일정 장소는 어떤 범위에서도 보내지 않는다. 완료한 할 일은 공유하지 않는다
   - /s/:token 응답에 X-Robots-Tag noindex, Cache-Control no-store, Referrer-Policy no-referrer
   - 링크 주인이 로그인한 채로 열면 "내 공유 링크" 안내를 띄우고 열람 수에 세지 않는다

# 비기능 요구사항
- HTTPS 필수 (마이크 권한 + 구글 OAuth redirect). EC2에 무료 도메인(DuckDNS 등) + Let's Encrypt
- 지원 브라우저: Chrome·Edge 최신 (Web Speech API). Safari·Firefox는 텍스트 입력 대체
- 구글 OAuth 앱은 "테스트" 상태로 운영: 테스트 사용자 100명까지, 승인 7일 후 만료 → 발표 전날 재연결
- 음성 비서 응답 목표 3초 이내 (Haiku 계열)
- OpenAI 키는 OPENAI_API_KEY(서버 전용). 사용량 한도는 OpenAI 대시보드에서 월 $4로 제한
- 시간대: 모든 날짜 계산은 Asia/Seoul 기준 (EC2는 UTC)

# 시연 시나리오 (발표 5분 중 2분)
1. 대시보드에서 [동기화] → 구글 캘린더 일정과 받은 편지함 새 후보 1개가 나타남
2. 받은 편지함: "[데이터베이스] 기말 리포트 제출 안내" → [할 일로] → 타임라인에 마감 표시
3. 플로팅 마이크: "내일 오후 3시에 캡스톤 조 회의 잡아줘" → "그 시간엔 수업이 있어요. 4시 30분은 어때요?" → "좋아" → 구글 캘린더에도 생성
4. "이번 주 마감 노션에 정리해줘" → 노션 DB에 행 추가 (노션 연동 완료 시)
5. [브리핑 듣기] → 오늘 수업·일정·마감을 TTS로

# LMS 과제 가져오기 (2026-11-27 결정)
인하공전 LMS(lms.inhatc.ac.kr)의 과목 강의실은 Canvas 기반 LearningX(lms-app.inhatc.ac.kr)이고, 달력 → '달력 피드'에서 개인 iCal 주소를 준다. 이 공식 피드만 읽는다 (services/lms.js 피드 읽기, services/lms-sync.js DB 반영)
1. 피드 주소는 주소 자체가 비밀번호라 integrations(provider='lms').access_token에 저장하고 응답·로그·화면에 내보내지 않는다 (화면에는 학교 호스트만). 다른 서버로 요청이 가지 않게 https + .ac.kr + /feeds/calendars/user_….ics 모양만 받는다
2. 과제(UID event-assignment-*)만 가져오고, 오늘 이후 마감만 할 일로 만든다. 날짜만 있는 마감은 그날 23:59, UTC 시각은 한국 시각으로
3. 제목 끝 [과목코드-분반-…]은 떼고, 시험 제목의 (과목명-분반-정규-학과)는 과목 이름으로 쓴다. 과목은 설정에서 고른 '과목 코드 → 내 과목' 연결 → 과목 이름 일치 순으로 찾고, 못 찾으면 제목 뒤에 LMS 과목 이름을 붙인다
4. 학생마다 하나씩 열린 과제('(이름) 질문하기'가 3개 이상)는 내 이름 것만, 없으면 이름 뺀 1개만
5. 겹침 방지: 같은 과제는 external_id(과제 주소)로 알아본다. 이미 직접·메일·음성·노션으로 적어 둔 같은 할 일(제목 같음, 또는 같은 날 마감이면서 제목 포함·같은 과목·'과제·기말' 같은 흔한 말을 뺀 3글자 이상 낱말 겹침)이 있으면 가져오지 않는다. 그 할 일에 과목이 있으면 그 과목 코드 연결을 배워 둔다
6. 다시 가져올 때: 마감 변경만 반영하고 사용자가 고친 제목·과목·완료는 건드리지 않는다. 사용자가 지운 과제는 다시 가져오지 않는다(target_ref JSON의 hide). LMS에서 없어진 미완료·마감 전 과제는 지운다
7. 우선순위: 시험이거나 마감 3일 안이면 high, 아니면 mid. 제출 여부는 피드에 없으므로 완료는 사용자가 직접
8. 노션 동기화와 분리: source='lms' 할 일은 노션으로 보내거나 지우지 않는다
9. 대시보드 자동 동기화(10분)·[동기화]·연동 설정 [지금 동기화]에 함께 들어간다

# 범위에서 뺀 것
- 학교 LMS 화면 긁어오기·로그인 대행: 하지 않는다. LMS 과제는 공식 달력 피드(iCal)로만 가져온다(아래 'LMS 과제 가져오기'). 시간표는 포털에서 가져오는 대신 음성 비서 add_class로 말해서 넣는다 (2026-11-26 결정, 2026-11-27 LMS 피드 연동으로 변경)

# styles
- 모던 카드 UI, 둥근 모서리, 부드러운 그림자, 과목별 포인트 색상
- 모바일에서도 깨지지 않게 (반응형)
- 디자인 시안은 사용자가 따로 제공 예정 → 받으면 CSS 변수(:root)만 바꿔서 적용할 수 있게 색상·폰트를 변수로 관리

# 2차 목표 (나중에)
Spring Boot + Spring AI로 MCP 서버를 만들어 같은 DB에 연결.
도구: get_today_tasks, add_task, get_timetable, summarize_week (1차 음성 비서 도구와 같은 이름·입출력으로 맞춤).
Claude Desktop에서 "이번 주 마감 정리해줘"가 되는 것이 목표. 다국어 강의 노트도 2차 후보. (노션 양방향 동기화는 1차로 옮김. 2026-11-27 결정)

## 비전 후보 (2026-11-26 결정, 지금은 구현하지 않음)
- **메일 근거 문장**: 받은 편지함 할 일 후보 아래에 AI가 근거로 삼은 메일 원문 한 줄(예: "리포트는 12월 3일 23:59까지 LMS에 올려 주세요")을 함께 보여줘, 메일을 열지 않고 마감을 확인. `inbox_items.snippet` 컬럼 추가가 필요하므로 스키마 변경과 함께 진행.
