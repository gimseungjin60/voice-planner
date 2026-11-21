---
name: crud-route
description: schema.sql의 테이블 하나에 대해 Express JSON API 라우터(routes/api/*.js)와 EJS 화면을 프로젝트 규칙대로 생성한다. "OO CRUD 만들어줘", "OO API 추가" 요청 시 사용.
---

# crud-route

## 순서
1. `schema.sql`에서 대상 테이블의 컬럼·FK·ENUM을 읽는다. MySQL MCP가 있으면 `DESCRIBE <table>`로 실제 DB와 일치하는지 확인.
2. `@Dev.md`의 API 표에서 해당 엔드포인트를 찾는다. 표에 없으면 만들기 전에 사용자에게 제안.
3. `routes/api/<복수형>.js` 생성:
   - `const router = express.Router(); router.use(requireLogin);`
   - GET 목록(`?page=` 10개씩, 최신순) / GET :id / POST / PATCH 또는 PUT / DELETE
   - 모든 쿼리 `?` 바인딩 + `WHERE user_id = ? ` (req.session.user.user_id)
   - 응답 `{ ok: true, data }` / 에러는 `next(err)`, 검증 실패는 `res.status(400).json({ ok:false, error })`
   - 다른 사람 데이터면 404 (존재 여부를 숨김)
4. `app.js`에 `app.use("/api/<복수형>", require("./routes/api/<복수형>"))` 한 줄 추가.
5. 화면이 필요하면 `routes/pages.js`에 GET 추가 + `views/<이름>.ejs` 생성 (partials header/nav/footer 포함, 데이터 변경은 `public/js/<이름>.js`에서 fetch).
6. `npm run check` 통과 확인.

## 템플릿 (POST)
```js
router.post("/", async (req, res, next) => {
  try {
    const title = (req.body.title || "").trim();
    if (!title) return res.status(400).json({ ok: false, error: "제목을 입력하세요" });
    const [r] = await pool.query(
      "INSERT INTO tasks (user_id, title, due_at) VALUES (?, ?, ?)",
      [req.session.user.user_id, title, req.body.due_at || null]
    );
    res.status(201).json({ ok: true, data: { task_id: r.insertId } });
  } catch (err) {
    next(err);
  }
});
```

## Gotchas
- Express 5에서는 async 에러가 자동으로 next로 가지만, 교수님 예제와 맞추기 위해 try/catch를 유지한다.
- mysql2 `pool.query`는 `[rows, fields]`를 반환한다. 구조분해 `[rows]` 잊지 말 것.
- DATETIME은 `YYYY-MM-DD HH:mm:ss` 문자열로 넣는다. ISO `T`/`Z` 그대로 넣으면 시간대가 틀어진다.
