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
