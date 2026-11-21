# ERD

```mermaid
erDiagram
    users ||--o{ subjects : "user_id"
    users ||--o{ integrations : "user_id"
    users ||--o{ tasks : "user_id"
    subjects |o--o{ tasks : "subject_id"
    voice_memos |o--o{ tasks : "memo_id"
    users ||--o{ ai_logs : "user_id"
    voice_memos |o--o{ ai_logs : "memo_id"
    subjects ||--o{ schedules : "subject_id"
    users ||--o{ voice_memos : "user_id"
    subjects |o--o{ voice_memos : "subject_id"
    users ||--o{ briefings : "user_id"
    ai_logs {
        int log_id PK
        int user_id FK
        int memo_id FK
        enum feature
        varchar tool_name
        text input_text
        text output_text
        int tokens
        tinyint success
        datetime created_at
    }
    briefings {
        int briefing_id PK
        int user_id FK
        date brief_date
        text content
        datetime created_at
    }
    integrations {
        int integration_id PK
        int user_id FK
        enum provider
        text access_token
        text refresh_token
        datetime expires_at
        datetime connected_at
        datetime last_synced_at
    }
    schedules {
        int schedule_id PK
        int subject_id FK
        tinyint day_of_week
        time start_time
        time end_time
        varchar room
    }
    subjects {
        int subject_id PK
        int user_id FK
        varchar name
        varchar professor
        char color
        datetime created_at
    }
    tasks {
        int task_id PK
        int user_id FK
        int subject_id FK
        int memo_id FK
        varchar title
        datetime due_at
        enum priority
        enum status
        enum source
        varchar external_id
        datetime created_at
    }
    users {
        int user_id PK
        varchar email UK
        varchar password_hash
        varchar user_name
        enum role
        datetime created_at
    }
    voice_memos {
        int memo_id PK
        int user_id FK
        int subject_id FK
        enum memo_type
        text transcript
        text summary
        int duration_sec
        datetime created_at
    }
```
