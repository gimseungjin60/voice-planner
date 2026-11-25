#!/usr/bin/env bash
# EC2(Ubuntu 22.04/24.04) 최초 1회 세팅: Node 20 · MySQL 8 · pm2 · nginx · (도메인이 있으면) HTTPS까지 한 번에
# 사용법 (EC2 터미널에서):
#   curl -fsSL https://raw.githubusercontent.com/gimseungjin60/voice-planner/main/scripts/ec2-setup.sh -o setup.sh
#   bash setup.sh 내도메인.duckdns.org      # 도메인이 아직 없으면 인자 없이 → http://IP 로만 뜬다
# DB 비밀번호·세션 비밀값은 서버에서 무작위로 만들어 .env에 넣는다. API 키(ANTHROPIC·OPENAI·GOOGLE)만 나중에 직접 넣으면 된다
# 다시 실행해도 안전하다: 이미 있는 .env·DB 데이터는 건드리지 않는다
set -euo pipefail

DOMAIN="${1:-}"
REPO="https://github.com/gimseungjin60/voice-planner.git"
APP="$HOME/voice-planner"

echo "== 1/7 패키지 설치 (nginx, mysql, git, certbot)"
sudo apt-get update -y
sudo apt-get install -y nginx mysql-server git curl openssl certbot python3-certbot-nginx

echo "== 2/7 Node.js 20 + pm2"
if ! command -v node >/dev/null || [ "$(node -p 'process.versions.node.split(".")[0]')" -lt 20 ]; then
  curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
  sudo apt-get install -y nodejs
fi
command -v pm2 >/dev/null || sudo npm i -g pm2

# 메모리 1GB 인스턴스(t2/t3.micro)는 npm 설치 중 멈출 수 있어 스왑 1GB 추가
if [ "$(free -m | awk '/Mem:/{print $2}')" -lt 1800 ] && ! swapon --show | grep -q /swapfile; then
  echo "== 스왑 1GB 추가 (메모리 작은 인스턴스용)"
  sudo fallocate -l 1G /swapfile && sudo chmod 600 /swapfile && sudo mkswap /swapfile && sudo swapon /swapfile
  echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab >/dev/null
fi

echo "== 3/7 소스 받기"
if [ -d "$APP/.git" ]; then git -C "$APP" pull --ff-only; else git clone "$REPO" "$APP"; fi
cd "$APP"

echo "== 4/7 .env 만들기 (이미 있으면 그대로)"
FRESH_DB=0
if [ ! -f .env ]; then
  DB_PASS="$(openssl rand -hex 16)"
  cp .env.example .env
  sed -i "s|^SESSION_SECRET=.*|SESSION_SECRET=$(openssl rand -hex 32)|" .env
  sed -i "s|^DB_PASSWORD=.*|DB_PASSWORD=${DB_PASS}|" .env
  [ -n "$DOMAIN" ] && sed -i "s|^GOOGLE_REDIRECT_URI=.*|GOOGLE_REDIRECT_URI=https://${DOMAIN}/auth/google/callback|" .env
  chmod 600 .env
  echo "== 5/7 MySQL 계정 만들기 (DB는 이 서버 안에서만 접속)"
  sudo mysql -e "CREATE DATABASE IF NOT EXISTS voiceplanner DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
    CREATE USER IF NOT EXISTS 'voiceplanner'@'localhost' IDENTIFIED BY '${DB_PASS}';
    ALTER USER 'voiceplanner'@'localhost' IDENTIFIED BY '${DB_PASS}';
    GRANT ALL PRIVILEGES ON voiceplanner.* TO 'voiceplanner'@'localhost'; FLUSH PRIVILEGES;"
  FRESH_DB=1
else
  echo "   .env가 이미 있어서 건너뜀"
fi

npm ci --omit=dev
# 처음 만들 때만 스키마 적용 (다시 실행하면 데이터가 지워지므로)
[ "$FRESH_DB" = 1 ] && npm run db:init

echo "== 6/7 pm2로 실행 + 재부팅 시 자동 시작"
pm2 describe voice-planner >/dev/null 2>&1 && pm2 reload voice-planner --update-env || pm2 start app.js --name voice-planner
pm2 save
sudo env PATH="$PATH:/usr/bin" pm2 startup systemd -u "$USER" --hp "$HOME" >/dev/null

echo "== 7/7 nginx 리버스 프록시"
sudo tee /etc/nginx/sites-available/voice-planner >/dev/null <<NGINX
server {
    listen 80 default_server;
    server_name ${DOMAIN:-_};
    client_max_body_size 25m;          # 강의 녹음 10분 조각 업로드 (기본 1MB면 413)
    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header Host \$host;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;   # trust proxy + secure 세션 쿠키
        proxy_read_timeout 120s;       # 받아쓰기 서버 제한 90초보다 길게
    }
}
NGINX
sudo ln -sf /etc/nginx/sites-available/voice-planner /etc/nginx/sites-enabled/voice-planner
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t && sudo systemctl reload nginx

if [ -n "$DOMAIN" ]; then
  echo "== HTTPS 인증서 (Let's Encrypt)"
  sudo certbot --nginx -d "$DOMAIN" --non-interactive --agree-tos --register-unsafely-without-email --redirect \
    || echo "!! 인증서 발급 실패: 도메인이 이 서버 IP를 가리키는지, 보안그룹에 80·443이 열려 있는지 확인 후 다시 실행하세요"
fi

IP="$(curl -s -m 3 https://checkip.amazonaws.com || echo '<EC2-IP>')"
echo
echo "완료! 접속: ${DOMAIN:+https://$DOMAIN  또는 }http://$IP"
echo "샘플 계정: student@vp.com / test1234 (관리자 admin@vp.com / test1234)"
echo "남은 일: nano ~/voice-planner/.env 에서 ANTHROPIC_API_KEY · OPENAI_API_KEY · GOOGLE_CLIENT_ID · GOOGLE_CLIENT_SECRET 입력"
echo "         → pm2 reload voice-planner --update-env"
