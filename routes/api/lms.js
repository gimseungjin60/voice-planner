// /api/lms/sync     LMS 달력 피드에서 과제·시험 가져오기 (대시보드 자동 동기화·연동 설정 '지금 가져오기')
// /api/lms/courses  피드에 나온 과목 코드 ↔ 내 과목 연결 보기·저장
// 피드 주소 저장·해제는 /api/integrations/lms. 피드 주소는 응답에 넣지 않는다
const express = require("express");
const { requireLogin } = require("../../middleware/auth");
const lmsSync = require("../../services/lms-sync");

const router = express.Router();
router.use(requireLogin);

const notConnected = (res) => res.status(400).json({ ok: false, error: "LMS가 연결되어 있지 않아요", not_connected: true });

router.post("/sync", async (req, res, next) => {
  try {
    const result = await lmsSync.pull(req.session.user.user_id);
    if (!result) return notConnected(res);
    res.json({ ok: true, data: result });
  } catch (err) {
    next(err);
  }
});

router.get("/courses", async (req, res, next) => {
  try {
    const list = await lmsSync.courses(req.session.user.user_id);
    if (!list) return notConnected(res);
    res.json({ ok: true, data: list });
  } catch (err) {
    next(err);
  }
});

// { map: { 과목코드: subject_id | 0(연결 안 함) | null(자동) } } 저장 후 바로 다시 가져와 이미 가져온 과제의 과목도 맞춘다
router.put("/courses", async (req, res, next) => {
  try {
    const userId = req.session.user.user_id;
    const map = await lmsSync.saveMap(userId, req.body?.map);
    if (!map) return notConnected(res);
    const result = await lmsSync.pull(userId, { remap: true });
    res.json({ ok: true, data: { map, ...result } });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
