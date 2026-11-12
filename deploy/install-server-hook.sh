#!/bin/bash
# 서버에서 한 번만 실행한다. 이후 배포는 git pull 뿐이다.
# nginx와 systemd에 적힌 경로만 사용한다. 자료 디렉터리와 SQLite는 복사하거나 지우지 않는다.
set -euo pipefail

if [[ "$(id -u)" -ne 0 ]]; then
  printf '%s\n' "최초 설치는 root로 실행합니다: sudo bash deploy/install-server-hook.sh" >&2
  exit 1
fi

export PATH="/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"
HERE=$(cd "$(dirname "$0")" && pwd)
REPO=$(git -C "$HERE" rev-parse --show-toplevel)
cd "$REPO"

if [[ ! -x /usr/bin/python3 && ! -x /bin/python3 ]]; then
  printf '%s\n' "python3이 필요합니다." >&2
  exit 1
fi
PYTHON=$(command -v python3)
if ! command -v nginx >/dev/null || ! command -v systemctl >/dev/null || ! command -v rsync >/dev/null || ! command -v curl >/dev/null || ! command -v node >/dev/null || ! command -v npm >/dev/null || ! command -v flock >/dev/null; then
  printf '%s\n' "nginx, systemctl, rsync, curl, node, npm, flock이 모두 있어야 합니다." >&2
  exit 1
fi

SERVICE=""
if systemctl cat depthm-api >/dev/null 2>&1; then
  SERVICE=depthm-api
else
  matches=()
  while IFS= read -r unit; do
    [[ -n "$unit" ]] || continue
    if systemctl cat "$unit" 2>/dev/null | grep -q 'server/api.mjs'; then
      matches+=("$unit")
    fi
  done < <(systemctl list-unit-files --type=service --no-legend | awk '{print $1}' | sed 's/\.service$//')
  if [[ ${#matches[@]} -ne 1 ]]; then
    printf '%s\n' "depthm-api 서비스를 하나로 확정하지 못했습니다: ${matches[*]:-없음}" >&2
    exit 1
  fi
  SERVICE=${matches[0]}
fi

tmp=$(mktemp -d /tmp/depthm-install.XXXXXX)
trap 'rm -rf "$tmp"' EXIT
nginx -T >"$tmp/nginx.txt" 2>"$tmp/nginx.err" || {
  printf '%s\n' "nginx -T 가 실패했습니다." >&2
  cat "$tmp/nginx.err" >&2
  exit 1
}
systemctl cat "$SERVICE" >"$tmp/unit.txt"

if ! "$PYTHON" "$REPO/deploy/read-server-layout.py" --nginx-file "$tmp/nginx.txt" --unit-file "$tmp/unit.txt" --service "$SERVICE" >"$tmp/layout.txt"; then
  printf '%s\n' "실행 중인 nginx와 systemd에서 경로를 읽지 못했습니다." >&2
  exit 1
fi

DOCROOT="" APP_ROOT="" SERVICE_USER="" MATERIALS_DIR="" DATA_ROOT="" DB_PATH="" API_PORT="" SERVER_NAME=""
while IFS='=' read -r key value; do
  case "$key" in
    DOCROOT) DOCROOT=$value ;;
    APP_ROOT) APP_ROOT=$value ;;
    SERVICE_USER) SERVICE_USER=$value ;;
    MATERIALS_DIR) MATERIALS_DIR=$value ;;
    DATA_ROOT) DATA_ROOT=$value ;;
    DB_PATH) DB_PATH=$value ;;
    API_PORT) API_PORT=$value ;;
    SERVER_NAME) SERVER_NAME=$value ;;
    SERVICE) SERVICE=$value ;;
    *)
      printf '%s\n' "알 수 없는 설정 키입니다: ${key}" >&2
      exit 1
      ;;
  esac
done <"$tmp/layout.txt"

printf '%s\n' "확인한 운영 경로"
printf '%s\n' "  서비스        ${SERVICE} (${SERVICE_USER})"
printf '%s\n' "  저장소        ${APP_ROOT}"
printf '%s\n' "  nginx 문서 루트 ${DOCROOT}"
printf '%s\n' "  회의자료      ${MATERIALS_DIR}"
printf '%s\n' "  데이터베이스  ${DB_PATH}"
printf '%s\n' "  API 포트      ${API_PORT}"

if [[ "$APP_ROOT" != "$REPO" ]]; then
  printf '%s\n' "systemd WorkingDirectory(${APP_ROOT})와 이 저장소(${REPO})가 다릅니다. 설치를 멈추었습니다." >&2
  exit 1
fi

# shellcheck disable=SC1091
source "$REPO/deploy/publish.sh"
problem=$(layout_problem "$DOCROOT" "$APP_ROOT" "$DATA_ROOT" "$DB_PATH" "$MATERIALS_DIR")
if [[ -n "$problem" ]]; then
  printf '%s\n' "$problem" >&2
  exit 1
fi
for path in "$DOCROOT" "$APP_ROOT" "$DATA_ROOT" "$MATERIALS_DIR"; do
  if [[ ! -d "$path" ]]; then
    printf '%s\n' "필요한 디렉터리가 없습니다: ${path}" >&2
    exit 1
  fi
  resolved=$(readlink -f "$path")
  case "$path" in
    "$DOCROOT") RDOC=$resolved ;;
    "$APP_ROOT") RAPP=$resolved ;;
    "$DATA_ROOT") RDATA=$resolved ;;
    "$MATERIALS_DIR") RMAT=$resolved ;;
  esac
done
if [[ ! -f "$DB_PATH" ]]; then
  printf '%s\n' "데이터베이스 파일이 없습니다: ${DB_PATH}" >&2
  exit 1
fi
RDB=$(readlink -f "$DB_PATH")
problem=$(layout_problem "$RDOC" "$RAPP" "$RDATA" "$RDB" "$RMAT")
if [[ -n "$problem" ]]; then
  printf '%s\n' "실제 경로가 안전하지 않습니다. ${problem}" >&2
  exit 1
fi
if path_inside "$RDATA" "$RDOC" || path_inside "$RDB" "$RDOC" || path_inside "$RMAT" "$RDOC"; then
  printf '%s\n' "자료 경로가 문서 루트 안에 있습니다. 설치를 멈추었습니다." >&2
  exit 1
fi

before_db=$(stat -c '%d:%i' "$DB_PATH")
before_mat=$(stat -c '%d:%i' "$MATERIALS_DIR")

chown -R "$SERVICE_USER:$SERVICE_USER" "$DOCROOT"
find "$DOCROOT" -xdev -type d -exec chmod 755 {} +
find "$DOCROOT" -xdev -type f -exec chmod 644 {} +
chown -R "$SERVICE_USER:$SERVICE_USER" "$APP_ROOT"

install -d -o "$SERVICE_USER" -g "$SERVICE_USER" -m 755 /var/lib/depthm
install -d -o root -g root -m 755 /etc/depthm

SYSTEMCTL=$(readlink -f "$(command -v systemctl)")
cat >"$tmp/deploy.env" <<EOF
# $(date -Is) 실행 중인 nginx와 systemd에서 읽었다.
DOCROOT=${DOCROOT}
APP_ROOT=${APP_ROOT}
DATA_ROOT=${DATA_ROOT}
MATERIALS_DIR=${MATERIALS_DIR}
DB_PATH=${DB_PATH}
SERVICE=${SERVICE}
SERVICE_USER=${SERVICE_USER}
API_PORT=${API_PORT}
SERVER_NAME=${SERVER_NAME}
SYSTEMCTL=${SYSTEMCTL}
EOF
install -o root -g root -m 644 "$tmp/deploy.env" /etc/depthm/deploy.env

sudo_tmp="$tmp/sudoers"
{
  printf '%s\n' "# depthm git pull은 이 서비스 재시작만 root로 실행할 수 있다."
  printf '%s ALL=(root) NOPASSWD: %s restart %s, %s reset-failed %s\n' \
    "$SERVICE_USER" "$SYSTEMCTL" "$SERVICE" "$SYSTEMCTL" "$SERVICE"
} >"$sudo_tmp"
visudo -cf "$sudo_tmp" >/dev/null
install -o root -g root -m 440 "$sudo_tmp" /etc/sudoers.d/depthm-deploy

chmod 755 "$REPO/deploy/hooks/post-merge" "$REPO/deploy/publish.sh" "$REPO/deploy/install-server-hook.sh" "$REPO/deploy/read-server-layout.py"
sudo -u "$SERVICE_USER" -H git config --global --get-all safe.directory | grep -Fxq "$APP_ROOT" || \
  sudo -u "$SERVICE_USER" -H git config --global --add safe.directory "$APP_ROOT"
sudo -u "$SERVICE_USER" -H git -C "$APP_ROOT" config core.hooksPath deploy/hooks
sudo -u "$SERVICE_USER" -H git -C "$APP_ROOT" config pull.rebase false
sudo -u "$SERVICE_USER" -H git -C "$APP_ROOT" config pull.ff only

after_db=$(stat -c '%d:%i:%s' "$DB_PATH")
after_mat=$(stat -c '%d:%i' "$MATERIALS_DIR")
if [[ "$before_db" != "$after_db" || "$before_mat" != "$after_mat" ]]; then
  printf '%s\n' "설치 중 데이터베이스나 회의자료 폴더가 바뀌었습니다. 배포는 시작하지 않습니다." >&2
  exit 1
fi

printf '%s\n' "훅을 켰습니다. 현재 커밋을 한 번 빌드하고, 필요하면 API를 다시 시작합니다."
sudo -u "$SERVICE_USER" -H bash "$REPO/deploy/publish.sh" --install

after_db=$(stat -c '%d:%i' "$DB_PATH")
after_mat=$(stat -c '%d:%i' "$MATERIALS_DIR")
if [[ "$after_db" != "$before_db" || "$after_mat" != "$before_mat" ]]; then
  printf '%s\n' "배포 뒤 데이터베이스나 회의자료 폴더의 inode가 바뀌었습니다. 파일을 확인하세요." >&2
  exit 1
fi

printf '%s\n' "최초 설치가 끝났습니다. 이후에는 ${SERVICE_USER} 계정으로 이 저장소에서 git pull 만 실행하면 됩니다."
