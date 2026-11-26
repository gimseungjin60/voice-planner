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
- 강의 녹음 받아쓰기만 OpenAI `gpt-4o-mini-transcribe` (SDK 없이 fetch, `services/ai.js`). 키는 `.env`의 `OPENAI_API_KEY` (2026-11-23 결정)
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
  api/share.js         # /api/share 일정 공유 링크 + 주간 보드 데이터 (친구 화면 /s/:token은 pages.js)
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
