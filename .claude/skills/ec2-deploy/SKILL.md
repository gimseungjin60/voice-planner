---
name: ec2-deploy
description: AWS EC2(Ubuntu)에 보이스 플래너를 처음 세팅하거나 새 버전을 배포한다. "배포해줘", "EC2에 올려줘" 요청 시 사용. 사용자가 SSH 접속 정보를 주기 전에는 명령만 안내한다.
---

# ec2-deploy

## 최초 1회 (EC2에서)
가장 쉬운 방법: `scripts/ec2-setup.sh`가 아래 단계 + DB 계정·.env 생성 + nginx + certbot HTTPS까지 한 번에 한다 (다시 실행해도 데이터 유지).
```bash
curl -fsSL https://raw.githubusercontent.com/gimseungjin60/voice-planner/main/scripts/ec2-setup.sh -o setup.sh && bash setup.sh <도메인>
```
직접 하려면:
```bash
sudo apt update && sudo apt install -y nginx mysql-server git
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash - && sudo apt install -y nodejs
sudo npm i -g pm2
git clone <repo-url> ~/voice-planner && cd ~/voice-planner
cp .env.example .env   # 값은 사용자가 직접 입력 (Claude가 키를 보지 않는다)
npm ci && npm run db:init
pm2 start app.js --name voice-planner && pm2 save && pm2 startup
```
nginx: `/etc/nginx/sites-available/default`의 `server { … }`를 아래처럼 → `sudo nginx -t && sudo systemctl reload nginx`.
```nginx
client_max_body_size 25m;       # 강의 녹음 10분 조각(약 2.4MB) 업로드. 기본 1MB면 413으로 막힌다
location / {
    proxy_pass http://127.0.0.1:3000;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;   # trust proxy + 세션 쿠키
    proxy_read_timeout 120s;    # 받아쓰기 서버 제한 90초보다 길게 (기본 60초)
}
```
보안그룹 인바운드: 22(브라우저 EC2 Instance Connect를 쓰면 0.0.0.0/0 또는 ec2-instance-connect 접두사 목록. 내 IP만 열면 브라우저 접속 실패), 80·443(전체). 3306은 열지 않는다. 아웃바운드는 기본(전체 허용) 유지 → api.anthropic.com·api.openai.com 호출.
pm2는 기본 fork 모드 1개로 둔다 (브리핑 음성 캐시가 프로세스 메모리에 있어서 cluster 모드면 프로세스마다 따로 생성됨).

## 업데이트 배포
```bash
cd ~/voice-planner && git pull && npm ci && pm2 reload voice-planner
```

## 배포 후 확인
1. `curl -s -o /dev/null -w "%{http_code}" http://<EC2-IP>/login` → 200
2. Playwright MCP로 `http://<EC2-IP>` 접속 → 로그인 → 대시보드·음성메모·할 일·시간표·관리자 화면 스크린샷을 `docs/screenshots/`에 저장 (제출 PDF용)

## Gotchas
- 마이크(Web Speech API, 강의 녹음 MediaRecorder 둘 다)는 HTTPS 또는 localhost에서만 동작한다. 발표 시연은 ① 도메인 + certbot HTTPS, 또는 ② 크롬 `chrome://flags/#unsafely-treat-insecure-origin-as-secure`에 EC2 주소 등록 중 하나로 준비.
- EC2 재부팅 후 앱이 안 뜨면 `pm2 resurrect`.
- 배포 후 음성 확인: 강의 녹음 30초 → 정지 → 글자가 나오는지, 대시보드 "브리핑 듣기" → 2초 안에 소리 나는지. 413이면 client_max_body_size, 504면 proxy_read_timeout 확인.
- `.env`에 ANTHROPIC_API_KEY·OPENAI_API_KEY가 있어야 한다. 없으면 AI 요약은 원문만 저장, 받아쓰기는 실패 안내, 브리핑은 브라우저 목소리로 대체된다 (앱은 멈추지 않음).
