---
name: erd-export
description: 실제 MySQL DB(또는 schema.sql)에서 테이블·컬럼·FK를 읽어 Mermaid ERD를 docs/ERD.md로 갱신한다. 스키마를 바꾼 뒤나 발표·제출용 ERD가 필요할 때 사용.
---

# erd-export

1. DB가 떠 있으면 `node .claude/skills/erd-export/scripts/erd.js > docs/ERD.md` 실행 (.env 접속정보 사용, information_schema 조회).
2. DB가 없으면 MySQL MCP나 schema.sql을 읽고 같은 형식으로 직접 작성.
3. 결과 확인: 테이블 수가 schema.sql의 CREATE TABLE 수와 같아야 한다.
4. 발표용 이미지가 필요하면 Playwright MCP로 https://mermaid.live 에 붙여넣고 스크린샷 → `docs/erd.png`.

## Gotchas
- Mermaid erDiagram 컬럼 타입에는 괄호·쉼표를 못 쓴다. `VARCHAR(255)` → `varchar` 로 줄인다.
- 관계 표기: FK가 NULL 허용이면 `|o--o{`, 아니면 `||--o{`.
