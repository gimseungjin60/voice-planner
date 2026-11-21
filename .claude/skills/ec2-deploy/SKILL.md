---
name: ec2-deploy
description: AWS EC2(Ubuntu)에 보이스 플래너를 처음 세팅하거나 새 버전을 배포한다. "배포해줘", "EC2에 올려줘" 요청 시 사용. 사용자가 SSH 접속 정보를 주기 전에는 명령만 안내한다.
---

# ec2-deploy

## 최초 1회 (EC2에서)
```bash
sudo apt update && sudo apt install -y nginx mysql-server git
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash - && sudo apt install -y nodejs
sudo npm i -g pm2
git clone <repo-url> ~/voice-planner && cd ~/voice-planner
cp .env.example .env   # 값은 사용자가 직접 입력 (Claude가 키를 보지 않는다)
npm ci && npm run db:init
pm2 start app.js --name voice-planner && pm2 save && pm2 startup
```
nginx: `/etc/nginx/sites-available/default`의 `location /`에 `proxy_pass http://127.0.0.1:3000;` 추가 → `sudo nginx -t && sudo systemctl reload nginx`.
보안그룹 인바운드: 22(내 IP), 80(전체). 3306은 열지 않는다.

## 업데이트 배포
```bash
cd ~/voice-planner && git pull && npm ci && pm2 reload voice-planner
```

## 배포 후 확인
1. `curl -s -o /dev/null -w "%{http_code}" http://<EC2-IP>/login` → 200
2. Playwright MCP로 `http://<EC2-IP>` 접속 → 로그인 → 대시보드·음성메모·할 일·시간표·관리자 화면 스크린샷을 `docs/screenshots/`에 저장 (제출 PDF용)

## Gotchas
- Web Speech API(마이크)는 HTTPS 또는 localhost에서만 동작한다. 발표 시연은 ① 도메인 + certbot HTTPS, 또는 ② 크롬 `chrome://flags/#unsafely-treat-insecure-origin-as-secure`에 EC2 주소 등록 중 하나로 준비.
- EC2 재부팅 후 앱이 안 뜨면 `pm2 resurrect`.
