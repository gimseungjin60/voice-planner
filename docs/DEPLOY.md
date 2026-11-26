# EC2 배포 + 구글·노션 연동 순서

키·토큰·.pem은 채팅이나 커밋에 넣지 않는다. 모두 EC2의 `~/voice-planner/.env` 또는 앱의 연동 설정 화면에만 입력한다.

## 1. EC2 인스턴스 (AWS 콘솔, 약 5분)
1. EC2 → 인스턴스 시작: 이름 `voice-planner`, AMI **Ubuntu Server 24.04 LTS**, 유형 **t3.small**(여유) 또는 t2/t3.micro(프리티어, 스크립트가 스왑 1GB 추가)
2. 키 페어: 새로 만들기(.pem 다운로드, 본인만 보관)
3. 네트워크 설정 → 보안 그룹 인바운드: SSH 22(내 IP), HTTP 80(0.0.0.0/0), HTTPS 443(0.0.0.0/0). **3306은 열지 않는다**
4. 스토리지 16GB → 시작
5. (권장) 탄력적 IP 할당 → 인스턴스에 연결. 재시작해도 IP가 안 바뀐다

## 2. 무료 도메인 (DuckDNS, 약 2분)
1. https://www.duckdns.org 에 로그인 → 하위 도메인 만들기 (예: `voiceplanner`)
2. current ip 칸에 EC2 퍼블릭 IP 입력 → update ip
3. 결과 주소: `voiceplanner.duckdns.org`

마이크(Web Speech API·녹음)와 구글 로그인은 HTTPS에서만 되므로 도메인이 필요하다.

## 3. 서버 세팅 (EC2 터미널, 약 10분)
EC2 콘솔 → 인스턴스 선택 → **연결 → EC2 Instance Connect → 연결** (브라우저 터미널. .pem 없이 가능)
```bash
curl -fsSL https://raw.githubusercontent.com/gimseungjin60/voice-planner/main/scripts/ec2-setup.sh -o setup.sh
bash setup.sh voiceplanner.duckdns.org
```
끝나면 `https://voiceplanner.duckdns.org`에서 로그인 화면이 보인다. 이어서 키 입력:
```bash
nano ~/voice-planner/.env     # ANTHROPIC_API_KEY, OPENAI_API_KEY, GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET
pm2 reload voice-planner --update-env
```

## 4. 구글 (Google Cloud Console)
1. 프로젝트 만들기 → API 및 서비스 → 라이브러리에서 **Google Calendar API**, **Gmail API** 사용 설정
2. OAuth 동의 화면(Google 인증 플랫폼): 외부, 앱 이름 `보이스 플래너`, **테스트** 상태 유지 → 대상 → 테스트 사용자에 본인 Gmail 추가
3. 데이터 액세스(범위): `.../auth/calendar.events`, `.../auth/gmail.readonly` 추가
4. 클라이언트 → OAuth 클라이언트 ID 만들기 → 웹 애플리케이션
   - 승인된 리디렉션 URI: `https://voiceplanner.duckdns.org/auth/google/callback` (로컬 개발용으로 `http://localhost:3000/auth/google/callback`도 함께)
5. 클라이언트 ID·보안 비밀을 EC2 `.env`에 넣고 `pm2 reload voice-planner --update-env`
6. 앱 → 연동 → **구글 계정 연결** → "확인되지 않은 앱" 경고에서 고급 → 이동 → 권한 체크박스 모두 선택
7. 연동 화면 또는 대시보드에서 **동기화** → 캘린더 일정·메일 과제 후보 확인

테스트 상태 앱은 승인이 7일 뒤 만료된다. 발표 전날 연동 화면에서 다시 연결한다.

## 5. 노션
1. https://www.notion.so/profile/integrations → 새 integration(내부) 만들기 → 토큰 복사 (`ntn_…`)
2. 노션에서 할 일을 받을 데이터베이스(표) 만들기. 속성 예: `이름`(제목), `마감일`(날짜), `과목`(선택), `우선순위`(선택). 제목만 있어도 동작하고, 날짜·과목·우선순위 속성은 이름이 비슷하면 자동으로 채운다
3. 데이터베이스 페이지 오른쪽 위 ⋯ → **연결** → 만든 integration 추가 (이걸 빠뜨리면 "데이터베이스를 찾을 수 없어요")
4. 앱 → 연동 → 노션: 토큰과 데이터베이스 주소 붙여넣기 → 저장 → **이번 주 할 일 내보내기**

## 배포 후 연동 점검 (순서대로 한 번)
1. 연동 → 구글 계정 연결 → 돌아오면 "구글 계정을 연결했어요" 안내, 권한 배지 2개(캘린더·메일 읽기)
2. 구글 캘린더에 내일 일정 하나 만들기 → 연동의 [지금 동기화] → 대시보드 타임라인에 보이는지
3. 다른 메일 계정에서 본인 Gmail로 "[과목명] 과제 제출 안내 · 12월 5일까지" 메일 보내기 → 받은 편지함 [메일 확인] → 후보 카드 → [할 일로] → 할 일·타임라인에 마감
4. 음성/직접 추가한 일정이 구글 캘린더에도 생기는지 (구글 연결 상태에서)
5. 노션 저장 → [이번 주 할 일 내보내기] → 노션 데이터베이스에 행이 생기는지, 한 번 더 누르면 "새로 내보낼 할 일이 없어요"
6. 문제가 생기면 화면 안내 문구 그대로 + `pm2 logs voice-planner --lines 50`을 알려주기 (토큰은 로그에 안 남는다)

## 업데이트 배포
```bash
cd ~/voice-planner && git pull && npm ci --omit=dev && pm2 reload voice-planner
```

## 문제가 생기면
- 502 Bad Gateway: `pm2 logs voice-planner --lines 50`
- 재부팅 후 안 뜸: `pm2 resurrect`
- 구글 `redirect_uri_mismatch`: 콘솔의 리디렉션 URI와 `.env`의 `GOOGLE_REDIRECT_URI`가 글자 하나까지 같은지
- 구글 `access_denied`: 테스트 사용자에 그 Gmail이 있는지
- 인증서 발급 실패: DuckDNS IP가 EC2 IP와 같은지, 보안 그룹 80 열렸는지 확인 후 `sudo certbot --nginx -d <도메인>`
