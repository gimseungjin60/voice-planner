# 화면별 디자인 매핑표

디자인 시안(Google Stitch, Figma AI, DESIGN.md)을 실제 코드에 옮길 때 쓰는 기준표.
절차는 `.claude/skills/design-apply/SKILL.md`.

## 0. 현재 디자인 시스템 (`public/css/style.css`, 113줄 한 파일)

| 토큰 | 현재 값 | 쓰이는 곳 |
|---|---|---|
| `--bg` | `#f5f6fa` | 페이지 배경, ghost 버튼, 요약 박스, 탭 배경 |
| `--card` | `#ffffff` | 카드, nav, 할 일 카드 |
| `--text` | `#1f2330` | 본문, toast 배경, "강의/메모" 칩 |
| `--muted` | `#6b7280` | 보조 글자, 기본 칩 |
| `--line` | `#e5e7ef` | 입력 테두리, 목록 구분선, 시간표 칸 |
| `--primary` / `--primary-dark` | `#6c8ef5` / `#4f6fd8` | 버튼, 마이크, 링크, 현재 페이지 |
| `--danger` / `--warn` / `--ok` | `#e5484d` / `#f59e0b` / `#30a46c` | 삭제, 녹음 중, D-day 빨강·주황 |
| `--radius` | `16px` | 카드·보드 열 |
| `--shadow` | `0 4px 16px rgba(31,35,48,.07)` | 카드·nav |
| `--font` | Pretendard → 시스템 폰트 | 전체 (Pretendard는 아직 로드 안 함) |

**변수로 안 빠진 하드코딩 값** (시안 적용 때 변수로 올릴 것)
- `.column` 배경 `#eceef5`, 입력 배경 `#fff`, 버튼 글자 `#fff`
- 마이크 그림자 `rgba(108,142,245,.45)`, 녹음 펄스 `rgba(229,72,77,.15)`
- radius 12px/10px/8px/999px가 섞여 있음 → `--radius-sm/md` 정리 권장
- 반응형 브레이크포인트는 `760px` 하나 (board 1열, 마이크 축소)

**공통 컴포넌트 클래스**: `.nav .nav-inner .brand .nav-links` · `.container .page-head` · `.card .grid .stat .stack` · `.btn(.ghost .danger .sm)` · `input select textarea label .form-row .field` · `.tabs .active` · `.chip` · `.list` · `.due .due-red .due-orange` · `.mic .mic-wrap .recording` · `.summary` · `.toast` · `.pager` · `.muted .hidden .error-msg`

## 1. 전 화면 공통 규칙
- **이름 바꾸면 기능이 깨지는 클래스**: `.hidden`(JS가 보이기/숨기기), `.active`(탭·nav), `.recording`(녹음 상태), `.due-red`/`.due-orange`(JS가 붙임), `.toast`(JS가 만듦)
- **과목 색은 DB 값**이 `style="background: …"`로 인라인 들어간다 (`.chip`, `.slot`, 할 일 카드 왼쪽 띠). 시안이 과목 색을 다르게 쓰면 인라인 속성 대상만 바꾸고 값은 `subjects.color`를 그대로 쓴다
- 레이아웃 뼈대: `partials/header.ejs`(head, `<main class="container">` 열기) → `nav.ejs`(로그인 시) → 화면 → `footer.ejs`
- 웹폰트를 쓰려면 `header.ejs` `<head>`에 `<link>` 한 줄 추가

## 2. 화면별 체크리스트
각 화면마다: ☐ 시안 있음/없음 ☐ 토큰 반영 ☐ 레이아웃 반영 ☐ 고정 선택자 유지 ☐ 데스크톱·모바일 스크린샷

### ① 로그인/회원가입 — `views/login.ejs` (`/login`, `/signup`)
- 구조: `.card.auth-box` 안에 로고·탭(링크 2개)·폼
- 고정: `#auth-form[data-mode]`, `#user_name #email #password`, `#auth-error`, 폼 안 첫 `button` (auth.js가 `form.querySelector("button")`로 잡음 → 버튼은 폼 안에 하나만)
- 시안 포인트: 첫인상 화면. 서비스 한 줄 소개·일러스트 영역 추가 가능 (정적 요소라 기능 영향 없음)

### ② 대시보드 — `views/dashboard.ejs` + `public/js/dashboard.js` (`/`)
- 구조: 날짜 헤더 + 브리핑 버튼 → 요약 카드 4개(`.grid`) → 큰 마이크 → "오늘 이것부터" 목록
- 고정: `#briefing-btn #briefing-text #sum-today #sum-week #sum-overdue #sum-nearest #top-note #top-list`, 마이크 링크 `href="/memo?start=1"`
- JS가 그리는 마크업: `#sum-nearest`에 `.stat` + 제목, `#top-list`에 `<li>` (칩·제목·D-day·이유) → dashboard.js 18~25줄도 같이 수정
- 시안 포인트: **가장 중요한 화면.** 마이크가 주인공, 요약 카드 위계

### ③ 음성 메모 — `views/memo.ejs` + `public/js/memo.js` (`/memo`)
- 구조: 탭(짧은 메모/강의 녹음) → 마이크·상태 → 인식 텍스트 → AI 분석 버튼 → 결과(요약 + 할 일 후보 카드)
- 고정: `.tabs button[data-type]`, `#type-help #mic-area #mic-btn #mic-status #no-stt #transcript #interim #analyze-btn #memo-error #result #summary #cand-wrap #candidates #confirm-btn #memo-link`, `<template id="cand-tpl">` 안 `.candidate .c-title .c-due .c-priority .c-subject` + 체크박스
- 상태 3가지 디자인 필요: 대기 / 녹음 중(`.mic.recording`) / 분석 중(버튼 disabled)
- 시안 포인트: 실시간 자막 느낌, 후보 카드 편집 UX

### ④ 메모 목록 — `views/memos.ejs` (`/memos`)
- 구조: 제목+개수, 과목 필터(select 자동 제출) → `.list` → `.pager`
- 고정: `select[name=subject]`의 `onchange` 자동 제출, pager 링크 쿼리 형식
- 서버 렌더만 있음 (JS 없음) → 구조 바꾸기 가장 쉬움

### ⑤ 메모 상세 — `views/memo-detail.ejs` (`/memos/:id`)
- 구조: 헤더(종류·날짜·과목, 목록/삭제 버튼) → 카드 3개(요약/원문/만든 할 일)
- 고정: `#delete-memo[data-id]`(인라인 스크립트), 할 일 `.due[data-due]`(app.js가 D-day 채움)

### ⑥ 할 일 보드 — `views/tasks.ejs` + `public/js/tasks.js` (`/tasks`)
- 구조: 과목 필터 → 추가 폼(`.card.form-row`) → 3열 `.board`(할 일/진행 중/완료)
- 고정: `#subject-filter #task-form #t-title #t-due #t-priority #t-subject`, `.board`, `.column[data-status=todo|doing|done]` 안 `.cards`·`.count`, `#tasks-data`
- JS가 그리는 마크업: `tasks.js`의 `card()` → `<article class="task">` + `button[data-move][data-to]`, `button[data-del]`. 카드 디자인은 **여기서** 바꾼다
- 시안 포인트: 칸반 카드, 마감 임박 강조, 모바일 1열

### ⑦ 시간표 — `views/timetable.ejs` + `public/js/timetable.js` (`/timetable`)
- 구조: `.timetable` 표(시×요일, 과목 `.slot`) → 내 과목 `.list` → 과목 추가/수정 폼(숨김)
- 고정: `#new-subject #subject-form #form-title #s-name #s-prof #s-color #schedule-rows #add-row #cancel-form #subject-error`, `button[data-edit] [data-delete]`, `<template id="row-tpl">` 안 `.r-day .r-start .r-end .r-room .r-del`, `#subjects-data`
- 주의: 지금은 수업이 시작 시각 칸 하나에만 찍힘. 시안이 "길이만큼 늘어나는 블록"이면 EJS 계산 로직 변경이 필요 → 사용자 확인 후 진행
- 시안 포인트: 과목 색 블록, 모바일 가로 스크롤(`.table-scroll`)

### ⑧ 관리자 — `views/admin.ejs` (`/admin`, admin만)
- 구조: 통계 카드 4개 → 회원 표(`table.data`)
- 고정: `button[data-delete][data-name]`, `closest("tr")` → 행은 `<tr>` 유지
- 우선순위 낮음: 토큰·컴포넌트만 반영해도 충분

### ⑨ 오류 — `views/error.ejs`
- `.card.auth-box` 재사용. 404/500 공통. 토큰만 반영

## 3. 시안 도구에 넣을 프롬프트 (Stitch / Figma AI 공통)
시안을 만들 때 아래를 붙여 넣으면 우리 코드에 옮기기 쉬운 결과가 나온다.

```
대학생용 음성 플래너 웹앱 "보이스 플래너"의 UI를 디자인해줘. 한국어 UI, 데스크톱(1280)과 모바일(390) 두 가지.
말하면 AI가 할 일·마감·과목을 정리해주는 서비스이고, 마이크 버튼이 핵심 행동이야.
화면: 1) 로그인/회원가입 2) 대시보드(오늘 날짜, 브리핑 듣기 버튼, 오늘 수업·오늘 마감·이번 주 마감·가장 가까운 D-day 카드 4개, 큰 마이크 버튼, AI 추천 "오늘 이것부터" 목록)
3) 음성 메모(짧은 메모/강의 녹음 탭, 마이크와 녹음 상태, 실시간 인식 텍스트, AI 분석 버튼, 요약과 체크 가능한 할 일 후보 카드)
4) 메모 목록(과목 필터, 페이지네이션) 5) 메모 상세(요약·원문·만든 할 일) 6) 할 일 칸반(할 일/진행 중/완료, 과목 색 띠, D-day 빨강·주황)
7) 주간 시간표(과목별 색 블록, 과목 목록, 과목 추가 폼) 8) 관리자(통계 카드, 회원 표)
조건: 상단 가로 내비게이션, 카드 기반 레이아웃, 과목마다 사용자가 정한 색이 칩·블록에 들어감.
결과는 색·폰트·radius·그림자·간격을 디자인 토큰으로 정리해서 함께 줘. Tailwind 클래스 대신 일반 CSS 값으로.
```

DESIGN.md 형식으로 줄 때는 최소한 **색 토큰, 타이포 단계, radius, 그림자, 간격, 컴포넌트(버튼·카드·입력·칩) 규칙**이 들어 있으면 1~2단계는 바로 적용 가능하다.
