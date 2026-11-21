# 보이스 플래너: 하네스 세팅

말하면 AI가 할 일·마감·과목을 정리해주는 대학생 플래너 (Node.js + Express + EJS + MySQL, AWS EC2).

## 하네스 구성
| 구분 | 파일 | 역할 |
|---|---|---|
| 규칙 | `CLAUDE.md` | 스택·폴더구조·코드규칙·금지사항 (교수님 todosapp 구조 기반) |
| 명세 | `@Dev.md` | 기능·API·화면·AI 기능 명세 |
| DB | `schema.sql`, `docs/ERD.md` | 8개 테이블 + 샘플 데이터, Mermaid ERD |
| MCP | `.mcp.json` | Context7(최신 문서), MySQL(읽기 전용 DB 조회), Playwright(화면 테스트·스크린샷) |
| Hooks | `.claude/hooks/` | guard(위험 명령·.env·DB 쓰기 차단), format(Prettier), verify(완료 전 npm run check), session-start(DB·환경 상태 보고) |
| Skills | `.claude/skills/` | crud-route, erd-export, ec2-deploy |
| 플러그인 | `.claude/settings.json` | Superpowers(기획→계획→TDD→리뷰), anthropics/skills(document·example skills: pdf, frontend-design, mcp-builder 등) |

## 처음 한 번
```bash
npm install
cp .env.example .env        # DB 비밀번호, ANTHROPIC_API_KEY 입력
npm run db:init             # 테이블 8개 + 샘플 계정 student@vp.com / test1234
claude                      # 폴더 신뢰 → MCP 서버·플러그인 설치 승인
```
MySQL MCP는 `.env`가 아니라 셸 환경변수(DB_USER, DB_PASSWORD)를 읽습니다. `claude` 실행 전에 export 하거나 Windows는 `set`으로 지정하세요.

## 명령어
- `npm run dev` 개발 서버 / `npm start` 운영
- `npm run check` 문법 검사 + 스모크 테스트 (Stop 훅이 자동 실행)
- `npm run erd` 실제 DB → docs/ERD.md 갱신
