# 보이스 플래너 고도화 핸드오프 (2026-11-22)

VS Code(로컬 Claude Code)에서 이 파일 하나로 설계 변경을 적용하고 다음 구현을 시작하기 위한 정리입니다.
보고서 원문: https://claude.ai/artifact/PdHRb2hr5QR5XomC1d4pMY

## 1. 결론

- **고도화 방향 확정**: "구글 캘린더·Gmail·노션을 한 화면에 모아 보여주고, 말 한마디로 일정·할 일을 넣는 대학생 허브".
- **설계(아이디어 + 명세 + 스키마)는 완료**로 판단합니다. 남은 것은 구현·디자인 적용·배포입니다.
- 설계 변경은 GitHub 브랜치 `claude/project-thread-5ttm8t`(main + 커밋 1개 `d7a43ac`)에 올라가 있습니다.
- 교수님 가이드 준수: 외부 API는 Express 서버에서만 호출 → MySQL에 저장 → EJS로 표시. EC2 + Node·Express·EJS·MySQL2 그대로이고, DB가 기능의 중심이라 ERD 발표 거리가 늘었습니다.

## 2. 전체 기능·완성도 평가

전체 진행률은 **약 38%** 입니다. 범위가 넓어져서 아까의 40%보다 살짝 낮아졌고, 대신 DB 연결 검증이 끝났습니다.

| 영역 | 비중 | 상태 | 반영 |
| --- | --- | --- | --- |
| 기획·명세·스키마·ERD·하네스 | 10% | 완료 (연동형으로 갱신) | 10% |
| 기본 API (인증·과목·메모·할 일·브리핑·관리자) | 20% | 작성 완료, 실제 MySQL 8에서 로그인·목록 API 정상 응답 확인 | 18% |
| 기본 화면 9개 + STT/TTS | 10% | 골격만 (CSS 113줄) | 6% |
| DB 연결·통합 테스트 | 5% | DB 확인 완료, Claude 실호출만 남음 | 4% |
| 연동·음성 비서 (OAuth, 캘린더, Gmail, 타임라인, 음성 비서, 노션) | 25% | 설계 완료, 구현 전 | 0% |
| UI/UX 디자인 적용 | 15% | 시안 대기 | 0% |
| EC2 배포 (도메인·HTTPS 포함) | 8% | 시작 전 | 0% |
| 제출물 PDF·zip·발표 | 7% | 시작 전 | 0% |

**설계 품질 평가**

| 항목 | 평가 |
| --- | --- |
| 과제 적합성 | 높음. 필수 스택·DB 필수·ERD 발표 조건을 모두 충족 |
| 실용성 | 높음. 시간표·구글 캘린더·학교 메일·노션을 한 화면에서 보고 말로 조작 |
| 독창성 | 중상. "말→할 일"(Todoist Ramble)만으론 약했지만, 시간표 충돌을 피해 일정을 제안하는 음성 비서 + 메일 과제 감지 조합은 조사한 9개 서비스에 없음 |
| 타당성(11/27) | 중. 필수 3개(음성 비서·캘린더·타임라인)는 가능, Gmail은 권장, 노션은 여유 시 |
| 남은 위험 | 구글 OAuth는 도메인+HTTPS가 필요, 테스트 모드 7일 만료, Web Speech API는 Chrome·Edge만 |

## 3. 인하공전 이러닝시스템 연동 가능 여부

**결론: 자동 연동은 안 되는 것으로 봅니다. 1차 범위에서 제외했습니다.**

- 이러닝시스템(cyber.inhatc.ac.kr)은 메디오피아가 만든 자체 LMS입니다(공개강좌 페이지 상단에 "메디오피아" 표시, 대학저널 2021 기사 "지난 2011년부터 자체 개발한 e-러닝시스템"). Canvas·Moodle(코스모스) 계열이 아니라서 표준 iCal 내보내기가 없을 가능성이 큽니다.
- 학교 LMS 매뉴얼(2022 수정)은 동영상·과제·Webex·파일 첨부만 다루고 일정·캘린더·알림 내용이 없습니다.
- 전산정보원 모바일앱 목록(대표 앱·신분증·도서관·전자출결·생활관)에 LMS 앱이 없습니다. 대표 앱 알림은 종합정보 알림입니다.
- 비로그인 페이지에 "오늘의 할 일 보기" 칸이 있어서, 로그인 후 할 일 목록 화면이 있을 수는 있습니다.
- 통합로그인 아이디·비밀번호를 받아 화면을 긁어오는 방식(스크래핑)은 학교 계정 보안과 이용 규정 문제로 하지 않습니다.

**직접 확인해 볼 것 (5분)**

1. 이러닝 로그인 → "오늘의 할 일", "일정", "캘린더", "학습 현황" 메뉴가 있는지 확인
2. 있다면 그 화면에 "내보내기", "iCal", "구독", "구글 캘린더 연동", ".ics" 버튼·링크가 있는지 확인
3. 과제 등록 시 학교 메일(Gmail)이나 카카오톡으로 알림이 오는지 확인. 메일로 오면 **Gmail 과제 감지 기능이 그대로 LMS 연동 역할**을 합니다
4. 1~2에서 .ics 주소가 보이면 알려주세요. 그러면 "iCal URL 구독" 기능을 명세에 추가할 수 있습니다(난이도 하)

**안 될 때의 대안 (제안, 명세에는 아직 없음)**

- **붙여넣기 가져오기**: LMS 과제 목록 화면을 드래그해 복사 → 보이스 플래너에 붙여넣기 → 기존 extractTasks가 과제·마감을 뽑아 후보로 보여줌. 이미 있는 "텍스트 입력 대체" 경로를 재사용하므로 하루 이하 작업입니다.
- **스크린샷 가져오기**: LMS 화면 캡처를 올리면 Claude가 이미지에서 과제·마감을 읽음. 발표 임팩트는 크지만 업로드 처리가 추가됩니다.

둘 중 하나를 넣고 싶으면 말씀해 주세요. CLAUDE.md 규칙상 명세에 먼저 추가한 뒤 구현합니다.

## 4. 이번 설계 변경 요약

| 파일 | 변경 |
| --- | --- |
| schema.sql | `events`(구글 캘린더·음성 일정), `inbox_items`(Gmail 과제 후보) 신규 → 테이블 10개. integrations에 scopes·target_ref, tasks에 completed_at과 source `voice`·`gmail`, ai_logs.feature에 `assistant`·`mail` 추가. 샘플 데이터 추가 |
| @Dev.md | 연동·통합 타임라인·음성 비서 API 17개, 화면 3개(받은 편지함, 연동 설정, 플로팅 마이크), AI 함수 2개(runAssistant, extractFromMail), 로직 4개, 비기능 요구사항, 시연 시나리오, 범위 제외(학교 LMS), 2차 목표 조정 |
| CLAUDE.md | 연동 스택(googleapis, @notionhq/client), 폴더 구조(라우터 8개·서비스 2개), 외부 API 규칙 3개, 2차 목표 조정 |
| ERD.md, docs/ERD.md | 실제 MySQL에서 재생성 (테이블 10개) |
| .env.example | GOOGLE_CLIENT_ID·SECRET·REDIRECT_URI 자리 |

검증: MySQL 8.0.46에 schema.sql 적용 성공(테이블 10개), `npm run check` 문법 25/25 + 스모크 GET /login 200, 샘플 계정 로그인과 /api/tasks·/api/subjects·/api/tasks/summary·/api/memos 정상 응답.

## 5. VS Code에서 적용하는 방법

### 방법 A: git으로 받기 (추천)

VS Code 터미널에서:

```bash
git status                     # 커밋 안 된 변경이 있으면 먼저 커밋하거나 stash
git fetch origin
git merge origin/claude/project-thread-5ttm8t   # main 기준이면 fast-forward로 깔끔하게 들어옴
npm run db:init                # 로컬 DB를 새 스키마로 초기화 (기존 데이터 삭제됨)
npm run erd && npm run check
```

### 방법 B: Claude Code에 붙여넣기

이 파일을 저장소 루트에 `HANDOFF.md`로 저장하고, VS Code의 Claude Code에 아래 프롬프트를 붙여넣으세요.

```
HANDOFF.md의 "부록" 절에 있는 CLAUDE.md, @Dev.md, schema.sql 전체 내용으로
저장소의 같은 이름 파일을 교체해줘. .env.example 끝에는 부록의 구글 OAuth 세 줄을 추가해줘.
교체 전에 지금 파일과 git diff로 비교해서, 내가 로컬에서 따로 바꾼 부분이 부록에 없으면
덮어쓰지 말고 먼저 목록으로 보여줘.
교체 후 npm run db:init → npm run erd → npm run check 순서로 실행하고 결과를 알려줘.
마지막으로 "docs: 구글 캘린더·Gmail·노션 연동과 음성 비서 설계 반영"으로 커밋해줘.
```

## 6. 다음 구현용 프롬프트 (순서대로 하나씩)

각 단계가 끝나면 `npm run check`가 통과해야 다음으로 넘어갑니다. 커밋은 단계마다 하나.

1. **AI 구조화 출력 + 실호출 확인**
   ```
   @Dev.md "AI 기능"을 읽고 services/ai.js의 extractTasks·summarizeLecture·prioritize를
   Claude 구조화 출력(JSON 스키마 지정)으로 바꿔줘. 정규식 parseJson은 실패 시 대비로만 남겨.
   SDK 사용법은 Context7로 최신 문서를 확인해. 샘플 메모로 실제 호출해서 ai_logs에 기록되는지 확인해줘.
   ```
2. **구글 OAuth + 캘린더 동기화**
   ```
   @Dev.md의 /auth/google, /auth/google/callback, /api/integrations, /api/sync/calendar, /api/events를
   CLAUDE.md 폴더 구조대로 구현해줘. 구글 호출은 services/google.js에만 두고 googleapis를 써.
   토큰은 integrations에 저장하고 응답·로그에 내보내지 마. 토큰 만료 시 앱은 계속 동작하고
   연동 설정 화면에 "다시 연결"을 보여줘.
   ```
3. **통합 타임라인 + 대시보드**
   ```
   /api/timeline을 구현해서 schedules(요일 반복 → 날짜로 펼침)·events·tasks 마감을 시간순 한 배열로
   돌려줘. 대시보드를 @Dev.md "화면 2"대로 통합 타임라인으로 바꿔줘. 날짜는 Asia/Seoul 기준.
   ```
4. **음성 비서**
   ```
   @Dev.md AI 기능 5번 runAssistant와 POST /api/assistant를 구현해줘. Claude tool use로
   add_task, list_tasks, complete_task, add_event, list_schedule, find_free_slot 도구를 만들고
   도구 호출마다 ai_logs(feature='assistant', tool_name)에 기록해. 모든 화면 오른쪽 아래에
   플로팅 마이크를 두고 결과는 토스트 + speechSynthesis로 읽어줘.
   ```
5. **Gmail 과제 감지 (권장)**: `/api/sync/gmail`, `/api/inbox`, 받은 편지함 화면. 메일 본문은 저장하지 않음.
6. **노션 내보내기 (여유 시)**: `/api/notion/export`, 연동 설정에 토큰·DB ID 입력.

**사용자가 먼저 해 둘 것**: Google Cloud Console에서 프로젝트 생성 → Calendar API·Gmail API 사용 설정 → OAuth 동의 화면(외부, 테스트 상태, 테스트 사용자에 본인 Gmail 추가) → OAuth 클라이언트 ID(웹 애플리케이션, 리디렉션 URI `http://localhost:3000/auth/google/callback`) → `.env`에 세 값 입력.

## 7. 디자인 시안 적용 준비

시안 생성(Google Stitch 등)에 넣을 프롬프트:

```
대학생용 음성 플래너 웹앱 "보이스 플래너". 한국어 UI, 모바일 우선 반응형.
화면 5개: (1) 대시보드 = 통합 타임라인: 오늘 날짜, '브리핑 듣기'·'동기화' 버튼, 오늘/이번 주 탭,
수업·구글 일정·마감을 시간순 한 줄로(출처 아이콘, 과목 색), 마감 카드, AI 추천 Top3
(2) 음성 메모: 녹음 중 실시간 자막, AI 분석 후 할 일 후보 카드
(3) 받은 편지함: 메일에서 찾은 과제 후보 카드(보낸 사람, 제목, 마감) + '할 일로'·'무시'
(4) 할 일 보드: 할 일·진행 중·완료 3열, 마감 24시간 이내 빨강·3일 이내 주황
(5) 연동 설정: 구글 연결 상태, 노션 토큰 입력
공통: 오른쪽 아래 플로팅 마이크(음성 비서), 둥근 카드, 부드러운 그림자, 과목별 포인트 색, 다크 모드 변형.
```

시안(DESIGN.md, 내보낸 HTML/CSS, 스크린샷 중 하나)을 받으면 적용할 프롬프트:

```
디자인 시안을 보이스 플래너에 적용해줘. CLAUDE.md 규칙(순수 CSS, 빌드 도구·프레임워크 금지)을 지켜.
1. DESIGN.md를 루트에 두고 색·폰트·간격·모서리·그림자 토큰을 public/css/style.css의 :root 변수로 옮겨.
2. 시안 HTML을 views/*.ejs와 partials로 나누되, 기존 <%= %> 바인딩과 public/js가 쓰는 id·class·data-* 는 지우지 마.
3. Tailwind 클래스는 순수 CSS로 바꾸고, 외부 폰트는 Google Fonts <link>만.
4. 390px·1280px에서 Playwright로 화면별 스크린샷을 찍어 시안과 비교하고 docs/screenshots/에 저장.
5. npm run check 통과 후 화면당 커밋 하나.
```

## 8. 일정 (제안)

| 날짜 | 할 일 |
| --- | --- |
| 11/22(일) | 설계 변경 적용(이 파일), 구글 Cloud 설정, 1단계 AI 구조화 출력 |
| 11/23(월) | 2단계 구글 OAuth·캘린더, 3단계 타임라인 |
| 11/24(화) | 4단계 음성 비서, 디자인 시안 적용 |
| 11/25(수) | 5단계 Gmail, EC2 배포(무료 도메인 + Let's Encrypt HTTPS, 구글 리디렉션 URI 추가) |
| 11/26(목) | (여유 시) 노션, 스크린샷·ERD·GitHub 캡처 → 학번_이름.pdf, 학번_이름_소스.zip |
| 11/27(금) | 제출. 발표 전날 구글 재연결(테스트 모드 7일 만료) |

**5분 발표**: 문제 30초 → 시연 2분(@Dev.md "시연 시나리오") → ERD 1분(integrations·events·inbox_items → tasks 흐름) → 바이브 코딩 하네스 1분(CLAUDE.md·hooks·skills·MCP) → 2차 MCP 계획 30초.

## 9. 출처

- 인하공전 이러닝 공개강좌 페이지(메디오피아 표시): https://cyber.inhatc.ac.kr/Main.do?cmd=moveMenu&mainDTO.parentMenuId=menu_00142&mainDTO.menuId=menu_00143
- 인하공전 LMS 학습자 간단 매뉴얼: https://www.inhatc.ac.kr/kr/466/subview.do?enc=Zm5jdDF8QEB8JTJGYmJzJTJGa3IlMkYzMyUyRjcxNTclMkZhcnRjbFZpZXcuZG8lM0Y%3D
- 전산정보원 모바일앱: https://itcenter.inhatc.ac.kr/itcenter/2718/subview.do
- 대학저널, 인하공전 자체 개발 e-러닝시스템(2021-06-30): https://dhnews.co.kr/news/view/179523415279768
- 구글 OAuth 테스트 모드(100명, 7일 만료): https://support.google.com/cloud/answer/15549945
- Gmail API 범위(gmail.readonly = restricted): https://developers.google.com/gmail/api/auth/scopes
- 제한 범위 검수(테스트 단계는 불필요): https://developers.google.com/identity/protocols/oauth2/production-readiness/restricted-scope-verification
- Notion internal integration: https://developers.notion.com/guides/get-started/internal-integrations
- Todoist Ramble: https://techcrunch.com/2026/01/21/todoists-app-now-lets-you-add-tasks-to-your-to-do-list-by-speaking-to-its-ai/
- Stitch DESIGN.md: https://blog.google/innovation-and-ai/models-and-research/google-labs/stitch-design-md/

---

## 부록: 변경된 파일 전체 (방법 B용)

### CLAUDE.md

````markdown
# 보이스 플래너 (Voice Planner)

말하면 AI가 할 일·마감·과목을 정리하고, 구글 캘린더·Gmail·노션을 한 화면에 모아주는 대학생 플래너. 기말 과제(AI 바이브 코딩).
명세는 `@Dev.md`, DB는 `schema.sql`이 단일 진실(source of truth). 둘이 다르면 코드를 고치지 말고 먼저 물어볼 것.

## 필수 스택 (바꾸지 말 것)
- Node.js 20+ / Express 5 / EJS 7 / mysql2(promise pool) / MySQL 8
- 배포: AWS EC2 (Ubuntu) + pm2 + nginx 리버스 프록시
- 인증: express-session + bcrypt. 비밀번호 평문 저장 금지
- 프론트: EJS + 순수 CSS + 바닐라 JS(`fetch`). React·Vue·Tailwind 빌드 도구 추가 금지
- 음성: 브라우저 Web Speech API(STT `SpeechRecognition`, TTS `speechSynthesis`), 한국어 `ko-KR`
- AI: Anthropic SDK(`@anthropic-ai/sdk`), 서버에서만 호출. 키는 `.env`의 `ANTHROPIC_API_KEY`
- 외부 연동: 구글(`googleapis`, OAuth 2.0: calendar.events + gmail.readonly), 노션(`@notionhq/client`, internal integration 토큰). 서버에서만 호출, 키는 `.env`

## 폴더 구조 (교수님 todosapp 구조를 확장)
```
app.js                 # 미들웨어·라우터 등록만. 로직 금지
db.js                  # mysql2/promise createPool, .env에서 접속정보
routes/
  pages.js             # EJS 화면 렌더 (GET만)
  api/auth.js          # /api/auth  signup·login·logout·me
  api/memos.js         # /api/memos 음성메모 + AI 분석
  api/tasks.js         # /api/tasks
  api/subjects.js      # /api/subjects, 시간표 포함
  api/briefing.js      # /api/briefing/today
  api/admin.js         # /api/admin (role=admin)
  oauth.js             # /auth/google, /auth/google/callback
  api/integrations.js  # /api/integrations 연동 상태·노션 설정
  api/sync.js          # /api/sync/calendar, /api/sync/gmail
  api/inbox.js         # /api/inbox 메일 후보 수락·무시
  api/events.js        # /api/events 일정
  api/timeline.js      # /api/timeline 수업+일정+마감 통합
  api/assistant.js     # /api/assistant 음성 비서
  api/notion.js        # /api/notion/export
services/ai.js         # Claude 호출은 전부 여기. 라우터에서 SDK 직접 호출 금지
services/google.js     # 구글 캘린더·Gmail 호출은 전부 여기 (토큰 갱신 포함)
services/notion.js     # 노션 호출은 전부 여기
middleware/auth.js     # requireLogin, requireAdmin
views/                 # *.ejs, views/partials/{header,footer,nav}.ejs
public/css, public/js  # public/js/voice.js = STT/TTS 래퍼
```

## 코드 규칙
- SQL은 반드시 `?` 플레이스홀더. 문자열 연결로 쿼리 만들지 말 것
- 모든 쿼리에 `WHERE user_id = ?`로 본인 데이터만. admin API만 예외
- 라우터는 `try { … } catch (err) { next(err) }` 패턴 (교수님 예제와 동일)
- API 응답 형식 통일: 성공 `{ ok: true, data }`, 실패 `{ ok: false, error: "메시지" }` + 적절한 status
- 화면은 페이지 GET으로 EJS 렌더, 데이터 변경은 `fetch('/api/...')` → JSON
- 주석과 UI 문구는 한국어. 변수·함수명은 영어 camelCase, DB 컬럼은 snake_case
- AI 응답은 JSON 스키마로 받고(구조화 출력) 파싱 실패 시 원문만 저장(앱이 죽으면 안 됨). 호출마다 `ai_logs`에 기록
- 외부 API 실패(토큰 만료 등)도 앱을 멈추지 않는다. DB에 있는 데이터로 화면을 그리고 "다시 연결"을 안내
- 외부 데이터는 MySQL에 저장한 뒤 화면은 DB에서 읽는다 (화면 렌더 중 외부 API 직접 호출 금지)
- 토큰은 API 응답·로그·화면에 절대 내보내지 않는다

## 명령어
- `npm run dev` 개발 서버(node --watch), `npm start` 운영
- `npm run db:init` → schema.sql 적용 (로컬 DB 초기화, 데이터 삭제됨)
- `npm run check` → 전체 .js 문법 검사 + 스모크 테스트

## 작업 방식
- 새 기능은 `@Dev.md`의 해당 항목 확인 → 계획 → 구현 → `npm run check` 순서
- 새 테이블 CRUD는 `crud-route` 스킬, ERD 갱신은 `erd-export` 스킬, 배포는 `ec2-deploy` 스킬 사용
- 라이브러리 API가 헷갈리면 추측하지 말고 Context7 MCP로 최신 문서 확인 (Express 5는 4와 다름)
- DB 상태 확인은 MySQL MCP(읽기 전용)로. 스키마 변경은 schema.sql을 고친 뒤 db:init
- 화면 확인·스크린샷은 Playwright MCP. 제출용 스크린샷은 `docs/screenshots/`에 저장
- 커밋: 기능 하나당 하나, 메시지는 한국어 `feat: 음성메모 저장 API` 형식

## 하지 말 것
- `.env`, 키, 토큰을 코드나 커밋에 넣기
- `DROP`/`TRUNCATE`를 schema.sql 밖에서 실행
- 명세에 없는 기능을 임의로 추가 (먼저 제안할 것)

## 2차 목표 (지금은 손대지 말 것)
Spring Boot(Spring AI) MCP 서버가 같은 MySQL DB를 읽어 Claude Desktop에서 플래너를 조작. 노션 양방향 동기화·다국어 강의 노트도 2차 후보. 그래서 DB 스키마는 Node 전용 꼼수 없이 표준 SQL로 유지.
(구글 캘린더·Gmail·노션 내보내기 연동은 1차 범위로 옮김. 2026-11-22 결정)
````

### @Dev.md

````markdown
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
database: voiceplanner (schema.sql 참고, 10개 테이블)
- users: 회원 (email unique, bcrypt 해시, role user/admin)
- subjects: 과목 (사용자별, 카드 색상)
- schedules: 시간표 (과목 1:N, 요일·시작·끝·강의실)
- voice_memos: 음성메모 (STT 원문, AI 요약, 메모/강의 구분)
- tasks: 할 일 (마감일, 우선순위, 상태, 출처 manual/ai/voice/gmail, 어떤 메모에서 나왔는지, 완료 시각)
- briefings: 아침 브리핑 (사용자·날짜당 1개)
- ai_logs: AI 호출 기록 (기능, 음성 비서가 실행한 도구, 입력, 출력, 토큰, 성공 여부)
- integrations: 외부 연동 (google = 캘린더+Gmail OAuth 토큰·권한, notion = integration 토큰·내보낼 DB ID)
- events: 일정 (구글 캘린더에서 불러온 것 + 음성 비서로 만든 것, 구글 이벤트 ID로 중복 방지)
- inbox_items: 받은 편지함 (Gmail에서 AI가 과제·마감을 찾은 메일 = 할 일 후보, 수락하면 tasks로. 메일 본문은 저장 안 함)

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
| PATCH | /api/tasks/:id | 상태·내용 수정 | O |
| DELETE | /api/tasks/:id | 삭제 | O |
| GET | /api/tasks/summary | 총정리: 오늘·이번 주·지난 마감 개수 + AI 우선순위 Top3 | O |
| GET | /api/briefing/today | 오늘 브리핑 (없으면 생성 후 저장) | O |
| GET | /api/admin/users | 회원 목록 | admin |
| DELETE | /api/admin/users/:id | 회원 삭제 | admin |
| GET | /api/admin/stats | 가입자 수, 메모 수, AI 호출 수 | admin |
| GET | /auth/google | 구글 로그인 동의 화면으로 redirect (calendar.events, gmail.readonly) | O |
| GET | /auth/google/callback | 토큰 받아 integrations 저장 → 연동 설정 화면으로 | O |
| GET | /api/integrations | 내 연동 상태 (provider, 연결 시각, 마지막 동기화, 만료 여부). 토큰은 응답에 넣지 않음 | O |
| PUT | /api/integrations/notion | 노션 토큰·데이터베이스 ID 저장 | O |
| DELETE | /api/integrations/:provider | 연동 해제 (해당 provider 데이터는 유지) | O |
| POST | /api/sync/calendar | 구글 캘린더 오늘~14일 일정을 events에 upsert | O |
| POST | /api/sync/gmail | 최근 7일 메일 중 새 메일만 AI 분석 → 과제·마감이 있으면 inbox_items 추가 | O |
| GET | /api/inbox?status=pending | 받은 편지함 후보 목록 | O |
| POST | /api/inbox/:id/accept | 후보 → tasks 저장(source='gmail'), status=accepted | O |
| POST | /api/inbox/:id/ignore | 후보 무시 | O |
| GET | /api/events?from=&to= | 내 일정 목록 | O |
| POST | /api/events | 일정 직접 추가 (구글 연결 시 구글 캘린더에도 생성) | O |
| DELETE | /api/events/:id | 일정 삭제 (구글 일정이면 구글에서도 삭제) | O |
| GET | /api/timeline?from=&to= | 통합 타임라인: 수업(schedules)+일정(events)+할 일 마감(tasks)을 시간순 하나의 배열로 | O |
| POST | /api/assistant | 음성 비서. body { text } → Claude tool use로 도구 실행 → { reply(TTS용 문장), actions[] } | O |
| POST | /api/notion/export | 이번 주(또는 선택한) 할 일을 노션 DB에 행으로 추가, tasks.external_id 기록 | O |

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
4. 메모 목록 / 상세 (페이지네이션, 과목 필터)
5. 할 일 보드: 할 일 · 진행 중 · 완료 3열 카드, 과목 색상 표시, 마감 임박 빨간 표시
6. 시간표: 주간 표, 과목 추가/수정
7. 관리자: 회원 목록·삭제, 통계 카드 (email role이 admin일 때만 메뉴 노출)
8. 받은 편지함: Gmail 후보 카드 (보낸 사람, 제목, AI가 찾은 할 일·마감, 과목) + [할 일로] [무시]
9. 연동 설정: 구글 연결/재연결/해제, 노션 토큰·DB ID 입력, 마지막 동기화 시각
10. 음성 비서 (모든 화면 공통): 오른쪽 아래 플로팅 마이크 → 말하면 자막 → 실행 결과 토스트 + TTS 답변

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
   - 도구: add_task, list_tasks, complete_task, add_event, list_schedule(수업+일정, 날짜 범위), find_free_slot(날짜, 길이)
   - 일정이 수업·기존 일정과 겹치면 추가하지 않고 빈 시간을 제안 (사용자가 "좋아"라고 다시 말하면 추가)
   - 출력: { reply, actions: [{ tool, input, result }] }, 도구 호출마다 ai_logs(feature='assistant', tool_name) 기록
6. extractFromMail(subject, sender, snippet, subjects, today) → { is_task, title, due_at, subject } (과제·시험·마감이 없으면 is_task=false)
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
8. 외부 API 호출은 services/google.js, services/notion.js에서만. 브라우저는 우리 /api만 부른다
9. 동기화는 수동(버튼) + 대시보드 진입 시 마지막 동기화가 10분 지났으면 자동 1회
10. 구글 토큰 만료·취소 시 앱은 계속 동작하고 연동 설정에 "다시 연결" 표시 (DB에 있는 일정은 그대로 보여줌)
11. Gmail은 제목·보낸 사람·snippet만 AI에 보내고 본문은 저장하지 않는다. 이미 본 메시지 ID는 다시 분석하지 않음

# 비기능 요구사항
- HTTPS 필수 (마이크 권한 + 구글 OAuth redirect). EC2에 무료 도메인(DuckDNS 등) + Let's Encrypt
- 지원 브라우저: Chrome·Edge 최신 (Web Speech API). Safari·Firefox는 텍스트 입력 대체
- 구글 OAuth 앱은 "테스트" 상태로 운영: 테스트 사용자 100명까지, 승인 7일 후 만료 → 발표 전날 재연결
- 음성 비서 응답 목표 3초 이내 (Haiku 계열)
- 시간대: 모든 날짜 계산은 Asia/Seoul 기준 (EC2는 UTC)

# 시연 시나리오 (발표 5분 중 2분)
1. 대시보드에서 [동기화] → 구글 캘린더 일정과 받은 편지함 새 후보 1개가 나타남
2. 받은 편지함: "[데이터베이스] 기말 리포트 제출 안내" → [할 일로] → 타임라인에 마감 표시
3. 플로팅 마이크: "내일 오후 3시에 캡스톤 조 회의 잡아줘" → "그 시간엔 수업이 있어요. 4시 30분은 어때요?" → "좋아" → 구글 캘린더에도 생성
4. "이번 주 마감 노션에 정리해줘" → 노션 DB에 행 추가 (노션 연동 완료 시)
5. [브리핑 듣기] → 오늘 수업·일정·마감을 TTS로

# 범위에서 뺀 것
- 학교 LMS(인하공전 이러닝시스템) 연동: 자체 개발 시스템이고 iCal 내보내기를 확인하지 못함. 통합로그인 뒤 화면을 긁어오는 방식은 하지 않는다

# styles
- 모던 카드 UI, 둥근 모서리, 부드러운 그림자, 과목별 포인트 색상
- 모바일에서도 깨지지 않게 (반응형)
- 디자인 시안은 사용자가 따로 제공 예정 → 받으면 CSS 변수(:root)만 바꿔서 적용할 수 있게 색상·폰트를 변수로 관리

# 2차 목표 (나중에)
Spring Boot + Spring AI로 MCP 서버를 만들어 같은 DB에 연결.
도구: get_today_tasks, add_task, get_timetable, summarize_week (1차 음성 비서 도구와 같은 이름·입출력으로 맞춤).
Claude Desktop에서 "이번 주 마감 정리해줘"가 되는 것이 목표. 노션 양방향 동기화, 다국어 강의 노트도 2차 후보.
````

### schema.sql

````sql
-- 보이스 플래너 DB 스키마 (MySQL 8.0)
-- 실행: mysql -u <user> -p < schema.sql

CREATE DATABASE IF NOT EXISTS voiceplanner DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE voiceplanner;

DROP TABLE IF EXISTS ai_logs;
DROP TABLE IF EXISTS inbox_items;
DROP TABLE IF EXISTS events;
DROP TABLE IF EXISTS integrations;
DROP TABLE IF EXISTS briefings;
DROP TABLE IF EXISTS tasks;
DROP TABLE IF EXISTS voice_memos;
DROP TABLE IF EXISTS schedules;
DROP TABLE IF EXISTS subjects;
DROP TABLE IF EXISTS users;

-- 1. 회원
CREATE TABLE users (
    user_id       INT AUTO_INCREMENT PRIMARY KEY,
    email         VARCHAR(255) NOT NULL UNIQUE,
    password_hash VARCHAR(255) NOT NULL,              -- bcrypt 해시
    user_name     VARCHAR(50)  NOT NULL,
    role          ENUM('user','admin') NOT NULL DEFAULT 'user',
    created_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- 2. 과목 (사용자별)
CREATE TABLE subjects (
    subject_id  INT AUTO_INCREMENT PRIMARY KEY,
    user_id     INT NOT NULL,
    name        VARCHAR(100) NOT NULL,
    professor   VARCHAR(50),
    color       CHAR(7) NOT NULL DEFAULT '#6C8EF5',   -- 카드 색상
    created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE,
    UNIQUE KEY uq_user_subject (user_id, name)        -- AI가 과목명 매칭할 때 기준
);

-- 3. 시간표 (과목 1 : N 수업시간)
CREATE TABLE schedules (
    schedule_id INT AUTO_INCREMENT PRIMARY KEY,
    subject_id  INT NOT NULL,
    day_of_week TINYINT NOT NULL,                     -- 0=일 ~ 6=토
    start_time  TIME NOT NULL,
    end_time    TIME NOT NULL,
    room        VARCHAR(50),
    FOREIGN KEY (subject_id) REFERENCES subjects(subject_id) ON DELETE CASCADE,
    CHECK (day_of_week BETWEEN 0 AND 6),
    CHECK (end_time > start_time)
);

-- 4. 음성 메모 (STT 결과 + AI 요약)
CREATE TABLE voice_memos (
    memo_id      INT AUTO_INCREMENT PRIMARY KEY,
    user_id      INT NOT NULL,
    subject_id   INT NULL,                            -- AI가 추정한 과목 (없으면 NULL)
    memo_type    ENUM('memo','lecture') NOT NULL DEFAULT 'memo',  -- 짧은 메모 / 강의 녹음
    transcript   TEXT NOT NULL,                       -- STT 원문
    summary      TEXT,                                -- AI 요약
    duration_sec INT,
    created_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id)    REFERENCES users(user_id)       ON DELETE CASCADE,
    FOREIGN KEY (subject_id) REFERENCES subjects(subject_id) ON DELETE SET NULL
);

-- 5. 할 일 (직접 입력 또는 메모에서 AI 추출)
CREATE TABLE tasks (
    task_id    INT AUTO_INCREMENT PRIMARY KEY,
    user_id    INT NOT NULL,
    subject_id INT NULL,
    memo_id    INT NULL,                              -- 어떤 메모에서 뽑혔는지
    title      VARCHAR(200) NOT NULL,
    due_at     DATETIME NULL,                         -- D-day 계산 기준
    priority   ENUM('low','mid','high') NOT NULL DEFAULT 'mid',
    status     ENUM('todo','doing','done') NOT NULL DEFAULT 'todo',
    source     ENUM('manual','ai','voice','gmail','google','notion') NOT NULL DEFAULT 'manual',  -- voice=음성 비서, gmail=메일 후보 수락
    external_id VARCHAR(255) NULL,                    -- 노션으로 내보낸 페이지 ID (중복 내보내기 방지)
    completed_at DATETIME NULL,                       -- status가 done이 된 시각 (완료율 통계)
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id)    REFERENCES users(user_id)       ON DELETE CASCADE,
    FOREIGN KEY (subject_id) REFERENCES subjects(subject_id) ON DELETE SET NULL,
    FOREIGN KEY (memo_id)    REFERENCES voice_memos(memo_id) ON DELETE SET NULL,
    INDEX idx_user_due (user_id, status, due_at)
);

-- 6. 아침 브리핑 (하루 1개, TTS로 읽어줌)
CREATE TABLE briefings (
    briefing_id INT AUTO_INCREMENT PRIMARY KEY,
    user_id     INT NOT NULL,
    brief_date  DATE NOT NULL,
    content     TEXT NOT NULL,
    created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE,
    UNIQUE KEY uq_user_date (user_id, brief_date)
);

-- 7. AI 호출 기록 (음성 비서 도구 호출 포함)
CREATE TABLE ai_logs (
    log_id      INT AUTO_INCREMENT PRIMARY KEY,
    user_id     INT NOT NULL,
    memo_id     INT NULL,
    feature     ENUM('extract','summary','briefing','chat','sync','prioritize','assistant','mail') NOT NULL,
    tool_name   VARCHAR(50) NULL,                     -- 음성 비서가 실행한 도구. 예: add_event
    input_text  TEXT,
    output_text TEXT,
    tokens      INT,
    success     BOOLEAN NOT NULL DEFAULT TRUE,
    created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(user_id)       ON DELETE CASCADE,
    FOREIGN KEY (memo_id) REFERENCES voice_memos(memo_id) ON DELETE SET NULL
);

-- 8. 외부 연동 (google = 캘린더+Gmail OAuth, notion = internal integration 토큰)
CREATE TABLE integrations (
    integration_id INT AUTO_INCREMENT PRIMARY KEY,
    user_id        INT NOT NULL,
    provider       ENUM('google','notion') NOT NULL,
    access_token   TEXT NOT NULL,                     -- 구글 access token / 노션 integration 토큰
    refresh_token  TEXT NULL,                         -- 구글만 (테스트 모드는 7일 후 만료 → 재연결)
    expires_at     DATETIME NULL,
    scopes         VARCHAR(500) NULL,                 -- 승인받은 구글 권한 (calendar.events, gmail.readonly)
    target_ref     VARCHAR(255) NULL,                 -- 노션: 할 일을 내보낼 데이터베이스 ID
    connected_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    last_synced_at DATETIME NULL,
    FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE,
    UNIQUE KEY uq_user_provider (user_id, provider)
);

-- 9. 일정 (구글 캘린더에서 불러온 것 + 음성 비서로 만든 것). 수업은 schedules, 마감은 tasks
CREATE TABLE events (
    event_id    INT AUTO_INCREMENT PRIMARY KEY,
    user_id     INT NOT NULL,
    provider    ENUM('google','manual') NOT NULL DEFAULT 'manual',
    external_id VARCHAR(255) NULL,                    -- 구글 캘린더 이벤트 ID (동기화 기준)
    title       VARCHAR(200) NOT NULL,
    start_at    DATETIME NOT NULL,
    end_at      DATETIME NOT NULL,
    location    VARCHAR(200) NULL,
    synced_at   DATETIME NULL,                        -- 마지막으로 구글과 맞춘 시각
    created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE,
    UNIQUE KEY uq_user_external (user_id, provider, external_id),
    INDEX idx_user_start (user_id, start_at),
    CHECK (end_at >= start_at)
);

-- 10. 받은 편지함 (Gmail에서 AI가 과제·마감을 찾은 메일 = 할 일 후보). 메일 본문은 저장하지 않음
CREATE TABLE inbox_items (
    item_id     INT AUTO_INCREMENT PRIMARY KEY,
    user_id     INT NOT NULL,
    provider    ENUM('gmail') NOT NULL DEFAULT 'gmail',
    external_id VARCHAR(255) NOT NULL,                -- Gmail 메시지 ID (같은 메일 중복 분석 방지)
    sender      VARCHAR(255) NULL,
    subject     VARCHAR(500) NULL,
    received_at DATETIME NULL,
    subject_id  INT NULL,                             -- AI가 추정한 과목
    ai_title    VARCHAR(200) NULL,                    -- AI가 제안한 할 일 제목
    ai_due_at   DATETIME NULL,                        -- AI가 찾은 마감
    status      ENUM('pending','accepted','ignored') NOT NULL DEFAULT 'pending',
    task_id     INT NULL,                             -- 수락해서 만들어진 할 일
    created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id)    REFERENCES users(user_id)       ON DELETE CASCADE,
    FOREIGN KEY (subject_id) REFERENCES subjects(subject_id) ON DELETE SET NULL,
    FOREIGN KEY (task_id)    REFERENCES tasks(task_id)       ON DELETE SET NULL,
    UNIQUE KEY uq_user_message (user_id, provider, external_id)
);

-- ===== 샘플 데이터 =====
-- 비밀번호는 모두 'test1234' (bcrypt 해시는 seed 스크립트에서 생성해 교체)
INSERT INTO users (email, password_hash, user_name, role) VALUES
 ('admin@vp.com', 'CHANGE_ME_BCRYPT', '관리자', 'admin'),
 ('student@vp.com', 'CHANGE_ME_BCRYPT', '김학생', 'user');

INSERT INTO subjects (user_id, name, professor, color) VALUES
 (2, '심화응용프로젝트', '류교수', '#6C8EF5'),
 (2, '데이터베이스', '박교수', '#F5A86C'),
 (2, '운영체제', '이교수', '#7CC9A0');

INSERT INTO schedules (subject_id, day_of_week, start_time, end_time, room) VALUES
 (1, 1, '10:00', '12:00', '공학관 301'),
 (2, 2, '13:00', '15:00', '공학관 204'),
 (2, 4, '13:00', '14:00', '공학관 204'),
 (3, 3, '09:00', '11:00', '정보관 102');

INSERT INTO voice_memos (user_id, subject_id, memo_type, transcript, summary, duration_sec) VALUES
 (2, 2, 'memo', '데이터베이스 교수님이 다음 주 화요일까지 ERD 과제 내래 그리고 목요일에 퀴즈 있대',
  'DB: ERD 과제(다음 주 화) / 퀴즈(목)', 8);

INSERT INTO tasks (user_id, subject_id, memo_id, title, due_at, priority, source) VALUES
 (2, 2, 1, 'ERD 과제 제출', '2026-12-01 23:59:00', 'high', 'ai'),
 (2, 2, 1, 'DB 퀴즈 준비', '2026-11-26 13:00:00', 'mid', 'ai'),
 (2, 1, NULL, '기말 발표 PDF 제출', '2026-11-27 23:59:00', 'high', 'manual');

INSERT INTO ai_logs (user_id, memo_id, feature, input_text, output_text, tokens) VALUES
 (2, 1, 'extract', '데이터베이스 교수님이 다음 주 화요일까지...', '[{"title":"ERD 과제 제출"},{"title":"DB 퀴즈 준비"}]', 320);

INSERT INTO events (user_id, provider, external_id, title, start_at, end_at, location) VALUES
 (2, 'manual', NULL, '캡스톤 조 회의', '2026-11-24 16:30:00', '2026-11-24 17:30:00', '도서관 스터디룸'),
 (2, 'google', 'sample_gcal_1', '동아리 정기 모임', '2026-11-25 18:00:00', '2026-11-25 20:00:00', NULL);

INSERT INTO inbox_items (user_id, external_id, sender, subject, received_at, subject_id, ai_title, ai_due_at) VALUES
 (2, 'sample_gmail_1', 'prof.park@example.ac.kr', '[데이터베이스] 기말 리포트 제출 안내', '2026-11-21 09:12:00', 2, '기말 리포트 제출', '2026-12-05 23:59:00');
````

### .env.example 끝에 추가

````
# 구글 OAuth (Google Cloud Console > API 및 서비스 > 사용자 인증 정보 > OAuth 클라이언트 ID, 웹 애플리케이션)
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
GOOGLE_REDIRECT_URI=http://localhost:3000/auth/google/callback
````
