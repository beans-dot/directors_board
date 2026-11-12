#!/bin/bash
# git pull 이후 화면 빌드와 API 재시작.
# 운영 SQLite, 회의자료, 메모 파일은 읽어서 지우거나 복사하지 않는다.
set -euo pipefail

layout_problem() {
  local docroot="${1%/}" app="${2%/}" data="${3%/}" db="${4%/}" materials="${5%/}"
  local dbdir broad
  dbdir=$(dirname "$db")
  if [[ "$docroot" != /* || "$app" != /* || "$data" != /* || "$db" != /* || "$materials" != /* ]]; then
    printf '%s\n' "경로가 절대 경로가 아닙니다."
    return 0
  fi
  for broad in / /var /var/www /usr /etc /home /root /tmp /var/lib /var/lib/depthm; do
    if [[ "$docroot" == "$broad" ]]; then
      printf '%s\n' "문서 루트 ${docroot} 는 배포 대상이 될 수 없습니다."
      return 0
    fi
  done
  if path_inside "$docroot" "$data" || path_inside "$data" "$docroot"; then
    printf '%s\n' "문서 루트와 자료 디렉터리가 겹칩니다. 문서 루트=${docroot} 자료=${data}"
    return 0
  fi
  if path_inside "$docroot" "$materials" || path_inside "$materials" "$docroot"; then
    printf '%s\n' "문서 루트와 회의자료 폴더가 겹칩니다. 문서 루트=${docroot} 자료=${materials}"
    return 0
  fi
  if path_inside "$db" "$docroot" || [[ "$docroot" == "$dbdir" ]]; then
    printf '%s\n' "데이터베이스가 문서 루트 쪽에 있습니다. 데이터베이스=${db}"
    return 0
  fi
  if [[ "$docroot" == "$app" ]] || path_inside "$app" "$docroot"; then
    printf '%s\n' "문서 루트가 저장소이거나 저장소를 포함합니다. 문서 루트=${docroot}"
    return 0
  fi
  if path_inside "$docroot" "$app" && [[ "$docroot" != "$app/web/dist" ]]; then
    printf '%s\n' "저장소 안의 문서 루트는 web/dist만 허용됩니다. 문서 루트=${docroot}"
    return 0
  fi
  if path_inside "$data" "$app" || path_inside "$materials" "$app" || path_inside "$db" "$app"; then
    printf '%s\n' "운영 데이터베이스나 회의자료가 저장소 안에 있습니다. 배포를 멈추었습니다."
    return 0
  fi
}

path_inside() {
  local child="${1%/}" parent="${2%/}"
  [[ "$child" == "$parent" || "$child" == "$parent"/* ]]
}

remove_under_lib() {
  local target real
  target="$1"
  [[ -e "$target" || -L "$target" ]] || return 0
  real=$(readlink -f "$target")
  case "$real" in
    /var/lib/depthm/*) ;;
    *)
      printf '%s\n' "이 경로는 지우지 않습니다: ${real}" >&2
      return 1
      ;;
  esac
  if path_inside "$real" "${DATA_ROOT:-/var/www/depthm-data}" || [[ "$real" == "${DB_PATH:-/unset}" ]]; then
    printf '%s\n' "자료 경로는 지우지 않습니다: ${real}" >&2
    return 1
  fi
  rm -rf -- "$real"
}

say() {
  printf '%s\n' "$*"
  if [[ -n "${LOG_FILE:-}" ]]; then
    printf '%s %s\n' "$(date -Is 2>/dev/null || date)" "$*" >>"$LOG_FILE" || true
  fi
}

fail() {
  printf '\n========================================\n' >&2
  printf '배포 실패: %s\n' "$1" >&2
  printf '%s\n' "$2" >&2
  printf '========================================\n' >&2
  exit 1
}

self_test() {
  local ok empty
  empty=$(layout_problem /var/www/depthm /var/www/depthm-app /var/www/depthm-data /var/www/depthm-data/depthm.sqlite /var/www/depthm-data/materials)
  [[ -z "$empty" ]] || { printf '정상 경로를 거부했습니다: %s\n' "$empty" >&2; exit 1; }
  empty=$(layout_problem /var/www/depthm-app/web/dist /var/www/depthm-app /var/www/depthm-data /var/www/depthm-data/depthm.sqlite /var/www/depthm-data/materials)
  [[ -z "$empty" ]] || { printf 'web/dist를 거부했습니다: %s\n' "$empty" >&2; exit 1; }
  for bad in \
    "/|/var/www/depthm-app|/var/www/depthm-data|/var/www/depthm-data/depthm.sqlite|/var/www/depthm-data/materials" \
    "/var/www/depthm-data|/var/www/depthm-app|/var/www/depthm-data|/var/www/depthm-data/depthm.sqlite|/var/www/depthm-data/materials" \
    "/var/www/depthm-app|/var/www/depthm-app|/var/www/depthm-data|/var/www/depthm-data/depthm.sqlite|/var/www/depthm-data/materials" \
    "/var/www/depthm|/var/www/depthm-app|/var/www/depthm-data|/var/www/depthm/depthm.sqlite|/var/www/depthm-data/materials" \
    "/var/www/depthm-app/server|/var/www/depthm-app|/var/www/depthm-data|/var/www/depthm-data/depthm.sqlite|/var/www/depthm-data/materials"
  do
    IFS='|' read -r a b c d e <<<"$bad"
    ok=$(layout_problem "$a" "$b" "$c" "$d" "$e")
    [[ -n "$ok" ]] || { printf '위험한 경로를 통과시켰습니다: %s\n' "$a" >&2; exit 1; }
  done
  printf '%s\n' "publish layout self-test ok"
}

if [[ "${1:-}" == "--self-test" ]]; then
  self_test
  exit 0
fi

if [[ "${BASH_SOURCE[0]}" != "$0" ]]; then
  return 0
fi

MODE="${1:-}"
if [[ "$MODE" != "--hook" && "$MODE" != "--install" ]]; then
  printf '%s\n' "이 스크립트는 git pull 훅 또는 최초 설치에서만 실행됩니다." >&2
  exit 1
fi

export PATH="/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"
export GIT_TERMINAL_PROMPT=0
APP_ROOT=$(git rev-parse --show-toplevel)
cd "$APP_ROOT"
ENV_FILE=/etc/depthm/deploy.env
LOG_FILE=/var/lib/depthm/deploy.log
KEEP="데이터베이스와 회의자료, 메모는 그대로 두었습니다."
UNCHANGED="운영 화면과 API는 바꾸지 않았습니다. ${KEEP}"

if [[ ! -f "$ENV_FILE" ]]; then
  fail "배포 설정 ${ENV_FILE} 이 없습니다. 서버에서 한 번 sudo bash deploy/install-server-hook.sh 를 실행해야 합니다." "$UNCHANGED"
fi

# shellcheck disable=SC1090
set -a
# shellcheck disable=SC1091
source "$ENV_FILE"
set +a

for key in DOCROOT APP_ROOT DATA_ROOT DB_PATH MATERIALS_DIR SERVICE SERVICE_USER API_PORT SERVER_NAME SYSTEMCTL; do
  if [[ -z "${!key:-}" ]]; then
    fail "배포 설정에 ${key} 가 없습니다." "$UNCHANGED"
  fi
done
if [[ "$DOCROOT" != /* || "$APP_ROOT" != /* || "$DATA_ROOT" != /* || "$DB_PATH" != /* || "$MATERIALS_DIR" != /* ]]; then
  fail "배포 경로 형식이 올바르지 않습니다." "$UNCHANGED"
fi
if [[ ! "$SERVICE" =~ ^[A-Za-z0-9@._-]+$ || ! "$SERVICE_USER" =~ ^[A-Za-z0-9@._-]+$ || ! "$API_PORT" =~ ^[0-9]+$ ]]; then
  fail "서비스 이름이나 포트 설정이 올바르지 않습니다." "$UNCHANGED"
fi
if [[ "$(git rev-parse --show-toplevel)" != "$APP_ROOT" ]]; then
  fail "지금 저장소와 배포 설정의 앱 경로가 다릅니다." "$UNCHANGED"
fi

problem=$(layout_problem "$DOCROOT" "$APP_ROOT" "$DATA_ROOT" "$DB_PATH" "$MATERIALS_DIR")
if [[ -n "$problem" ]]; then
  fail "$problem" "$UNCHANGED"
fi
for path in "$DOCROOT" "$APP_ROOT" "$DATA_ROOT" "$MATERIALS_DIR" "$DB_PATH"; do
  if [[ -e "$path" ]]; then
    resolved=$(readlink -f "$path")
    case "$path" in
      "$DOCROOT") RES_DOC=$resolved ;;
      "$APP_ROOT") RES_APP=$resolved ;;
      "$DATA_ROOT") RES_DATA=$resolved ;;
      "$MATERIALS_DIR") RES_MAT=$resolved ;;
      "$DB_PATH") RES_DB=$resolved ;;
    esac
  fi
done
if [[ -n "${RES_DOC:-}" && -n "${RES_DATA:-}" ]]; then
  problem=$(layout_problem "$RES_DOC" "${RES_APP:-$APP_ROOT}" "$RES_DATA" "${RES_DB:-$DB_PATH}" "${RES_MAT:-$MATERIALS_DIR}")
  if [[ -n "$problem" ]]; then
    fail "실제 경로가 겹칩니다. ${problem}" "$UNCHANGED"
  fi
fi
if [[ -e "$DOCROOT/.git" || -e "$DOCROOT/depthm.sqlite" ]]; then
  fail "문서 루트에 Git 저장소나 데이터베이스 파일이 있습니다." "$UNCHANGED"
fi
if [[ ! -d /var/lib/depthm ]]; then
  fail "/var/lib/depthm 가 없습니다. 최초 설치 스크립트를 다시 실행하세요." "$UNCHANGED"
fi

exec 9>/var/lib/depthm/deploy.lock
if ! flock -n 9; then
  fail "다른 배포가 진행 중입니다." "$UNCHANGED"
fi

inode_of() {
  if [[ -e "$1" ]]; then
    stat -c '%d:%i' "$1"
  fi
}
DB_INODE=$(inode_of "$DB_PATH")
MAT_INODE=$(inode_of "$MATERIALS_DIR")
DATA_INODE=$(inode_of "$DATA_ROOT")

assert_data() {
  local now
  now=$(inode_of "$DB_PATH")
  if [[ -n "$DB_INODE" && "$now" != "$DB_INODE" ]]; then
    fail "데이터베이스 파일 inode가 바뀌었습니다 (${DB_INODE} -> ${now}). 배포를 중단합니다." "자료 파일을 되돌리는 복사는 하지 않습니다. 서버 상태를 확인하세요."
  fi
  now=$(inode_of "$MATERIALS_DIR")
  if [[ -n "$MAT_INODE" && "$now" != "$MAT_INODE" ]]; then
    fail "회의자료 폴더 inode가 바뀌었습니다." "자료 파일을 되돌리는 복사는 하지 않습니다. 서버 상태를 확인하세요."
  fi
  now=$(inode_of "$DATA_ROOT")
  if [[ -n "$DATA_INODE" && "$now" != "$DATA_INODE" ]]; then
    fail "자료 디렉터리 inode가 바뀌었습니다." "자료 파일을 되돌리는 복사는 하지 않습니다. 서버 상태를 확인하세요."
  fi
}

NEEDS_WEB=0
NEEDS_WEB_DEPS=0
NEEDS_API=0
NEEDS_API_DEPS=0
SAVED_ORIG=""
if [[ "$MODE" == "--install" ]]; then
  NEEDS_WEB=1
  NEEDS_WEB_DEPS=1
  NEEDS_API=1
  NEEDS_API_DEPS=1
  say "최초 설치 배포를 시작합니다. 문서 루트=${DOCROOT} 자료=${MATERIALS_DIR} 데이터베이스=${DB_PATH}"
else
  SAVED_ORIG=$(git rev-parse --verify -q ORIG_HEAD || true)
  if [[ -z "$SAVED_ORIG" ]]; then
    fail "ORIG_HEAD가 없어 이번 pull의 변경 범위를 알 수 없습니다." "$UNCHANGED"
  fi
  while IFS= read -r changed; do
    [[ -n "$changed" ]] || continue
    case "$changed" in
      web/package.json | web/package-lock.json)
        NEEDS_WEB=1
        NEEDS_WEB_DEPS=1
        ;;
      web/src/test/* | *.md) ;;
      web/*.test.ts | web/*.test.tsx | web/*/*.test.ts | web/*/*.test.tsx | web/*/*/*.test.ts | web/*/*/*.test.tsx) ;;
      web/*) NEEDS_WEB=1 ;;
      server/package.json | server/package-lock.json)
        NEEDS_API=1
        NEEDS_API_DEPS=1
        ;;
      server/*.test.mjs | server/*/*.test.mjs) ;;
      server/*.mjs | server/*/*.mjs) NEEDS_API=1 ;;
      deploy/systemd/*)
        say "서비스 유닛 파일이 저장소에서 바뀌었습니다. 실행 중인 유닛과 자료 경로는 바꾸지 않습니다."
        ;;
    esac
  done < <(git diff --name-only "$SAVED_ORIG" HEAD)
fi

if [[ "$NEEDS_WEB" -eq 0 && "$NEEDS_API" -eq 0 ]]; then
  say "화면과 API 동작 코드는 바뀌지 않았습니다. 문서 루트와 서비스를 그대로 둡니다."
  assert_data
  exit 0
fi

if [[ ! -x "$SYSTEMCTL" ]]; then
  fail "systemctl을 찾지 못했습니다: ${SYSTEMCTL}" "$UNCHANGED"
fi

restart_api() {
  if [[ "$(id -u)" -eq 0 ]]; then
    "$SYSTEMCTL" reset-failed "$SERVICE" || true
    "$SYSTEMCTL" restart "$SERVICE"
  else
    sudo -n "$SYSTEMCTL" reset-failed "$SERVICE" || true
    sudo -n "$SYSTEMCTL" restart "$SERVICE"
  fi
}

restore_old_modules() {
  local dest real
  dest="$APP_ROOT/server/node_modules"
  if [[ ! -d "$MOD_BACKUP/node_modules" ]]; then
    return 0
  fi
  if [[ -e "$dest" ]]; then
    real=$(readlink -f "$dest")
    expected="$(readlink -f "$APP_ROOT/server")/node_modules"
    if [[ "$real" != "$expected" ]] || path_inside "$real" "$DATA_ROOT" || path_inside "$real" "$MATERIALS_DIR"; then
      fail "API 모듈 경로가 자료 폴더를 가리켜 되돌리지 않았습니다." "$KEEP"
    fi
    rm -rf -- "$dest"
  fi
  mv "$MOD_BACKUP/node_modules" "$dest"
}

wait_health() {
  local i body
  for i in $(seq 1 20); do
    body=$(curl -fsS --max-time 2 "http://127.0.0.1:${API_PORT}/health" 2>/dev/null || true)
    if [[ "$body" == *'"service":"depthm"'* && "$body" == *'"ok":true'* ]]; then
      return 0
    fi
    sleep 1
  done
  return 1
}

PUBLISHED=0
MODULES_SWAPPED=0
RESTARTED=0
ROLLBACK="$APP_ROOT/.deploy-rollback-not-used"
STAGE=""
API_STAGE=""
MOD_BACKUP=""

cleanup() {
  [[ -n "$STAGE" ]] && remove_under_lib "$STAGE" || true
  [[ -n "$API_STAGE" ]] && remove_under_lib "$API_STAGE" || true
  if [[ "${ROLLBACK:-}" == /var/lib/depthm/* ]]; then
    remove_under_lib "$ROLLBACK" || true
  fi
  if [[ "${MOD_BACKUP:-}" == /var/lib/depthm/* ]]; then
    remove_under_lib "$MOD_BACKUP" || true
  fi
}
trap cleanup EXIT

if [[ "$NEEDS_API" -eq 1 ]]; then
  say "API 코드를 검사합니다. 데이터베이스는 열지 않습니다."
  API_STAGE=$(mktemp -d /var/lib/depthm/api.XXXXXX)
  rsync -a --exclude node_modules --exclude data --exclude '*.sqlite' --exclude '*.sqlite-*' --exclude '*.sqlite-wal' --exclude '*.sqlite-shm' \
    "$APP_ROOT/server/" "$API_STAGE/"
  if [[ "$NEEDS_API_DEPS" -eq 1 || ! -d "$APP_ROOT/server/node_modules" ]]; then
    if ! (cd "$API_STAGE" && npm ci --omit=dev); then
      fail "API 의존성 설치에 실패했습니다. 출력된 npm 오류를 확인하세요." "$UNCHANGED"
    fi
  else
    rsync -a "$APP_ROOT/server/node_modules/" "$API_STAGE/node_modules/"
  fi
  if ! (cd "$APP_ROOT" && node --input-type=module -e "await import('${API_STAGE}/api.mjs')"); then
    fail "새 API 코드를 불러오지 못했습니다. 실행 중인 서비스는 재시작하지 않았습니다." "$UNCHANGED"
  fi
fi

if [[ "$NEEDS_WEB" -eq 1 ]]; then
  say "화면을 빌드합니다. 문서 루트는 빌드가 끝난 뒤에만 바꿉니다."
  if [[ ! -s "$APP_ROOT/web/public/fonts/NanumGothic-Regular.ttf" ]]; then
    (cd "$APP_ROOT/web" && node scripts/fetch-font.mjs) || say "한글 폰트를 받지 못했습니다. 서버에 이미 있는 폰트 파일은 지우지 않습니다."
  fi
  if [[ "$NEEDS_WEB_DEPS" -eq 1 || ! -x "$APP_ROOT/web/node_modules/.bin/vite" ]]; then
    if ! (cd "$APP_ROOT/web" && npm ci); then
      fail "화면 의존성 설치에 실패했습니다. 출력된 npm 오류를 확인하세요." "$UNCHANGED"
    fi
  fi
  STAGE=$(mktemp -d /var/lib/depthm/dist.XXXXXX)
  if ! (cd "$APP_ROOT/web" && ./node_modules/.bin/tsc --noEmit && ./node_modules/.bin/vite build --outDir "$STAGE" --emptyOutDir); then
    fail "화면 빌드에 실패했습니다. 출력된 오류를 확인하세요." "$UNCHANGED"
  fi
  if [[ ! -s "$STAGE/index.html" ]]; then
    fail "빌드 결과에 index.html이 없습니다." "$UNCHANGED"
  fi
  ROLLBACK=$(mktemp -d /var/lib/depthm/docroot.XXXXXX)
  rsync -a "$DOCROOT/" "$ROLLBACK/"
  if ! rsync -a --delete --chmod=D755,F644 \
    --exclude 'depthm.sqlite' --exclude 'depthm.sqlite-wal' --exclude 'depthm.sqlite-shm' \
    --exclude 'materials/' --exclude '.trash/' \
    "$STAGE/" "$DOCROOT/"; then
    rsync -a --delete "$ROLLBACK/" "$DOCROOT/" || true
    fail "문서 루트 반영에 실패해 이전 화면으로 되돌렸습니다." "$KEEP"
  fi
  PUBLISHED=1
  if [[ -e "$DOCROOT/depthm.sqlite" || -d "$DOCROOT/materials" ]]; then
    rsync -a --delete "$ROLLBACK/" "$DOCROOT/" || true
    PUBLISHED=0
    fail "반영 직후 문서 루트에 데이터베이스나 자료 폴더가 보입니다. 이전 화면으로 되돌렸습니다." "$KEEP"
  fi
fi

if [[ "$NEEDS_API" -eq 1 ]]; then
  if [[ "$NEEDS_API_DEPS" -eq 1 || ! -d "$APP_ROOT/server/node_modules" ]]; then
    MOD_BACKUP=$(mktemp -d /var/lib/depthm/modules.XXXXXX)
    if [[ -d "$APP_ROOT/server/node_modules" ]]; then
      cp -a "$APP_ROOT/server/node_modules" "$MOD_BACKUP/node_modules"
    fi
    if ! rsync -a --delete "$API_STAGE/node_modules/" "$APP_ROOT/server/node_modules/"; then
      if [[ -d "$MOD_BACKUP/node_modules" ]]; then
        restore_old_modules
      fi
      if [[ "$PUBLISHED" -eq 1 ]]; then
        rsync -a --delete "$ROLLBACK/" "$DOCROOT/" || true
        PUBLISHED=0
      fi
      fail "API 모듈 반영에 실패했습니다. 이전 모듈과 화면을 유지합니다." "$KEEP"
    fi
    MODULES_SWAPPED=1
  fi
  say "API를 다시 시작합니다."
  if ! restart_api; then
    if [[ "$MODULES_SWAPPED" -eq 1 && -d "$MOD_BACKUP/node_modules" ]]; then
      restore_old_modules
      MODULES_SWAPPED=0
    fi
    if [[ "$PUBLISHED" -eq 1 ]]; then
      rsync -a --delete "$ROLLBACK/" "$DOCROOT/" || true
      PUBLISHED=0
    fi
    fail "API 재시작 권한이 없거나 systemctl이 실패했습니다. 화면은 이전 파일로 되돌렸습니다." "$KEEP"
  fi
  RESTARTED=1
  if ! wait_health; then
    say "새 API가 응답하지 않습니다. 이전 화면과 이전 API로 되돌립니다."
    if [[ "$MODE" == "--hook" && -n "$SAVED_ORIG" ]]; then
      git checkout "$SAVED_ORIG" -- server
    fi
    if [[ "$MODULES_SWAPPED" -eq 1 && -d "$MOD_BACKUP/node_modules" ]]; then
      restore_old_modules
    fi
    if [[ "$PUBLISHED" -eq 1 ]]; then
      rsync -a --delete "$ROLLBACK/" "$DOCROOT/" || true
      PUBLISHED=0
    fi
    if restart_api && wait_health; then
      assert_data
      if [[ "$MODE" == "--hook" ]]; then
        fail "새 API가 응답하지 않아 이전 코드로 되돌렸습니다. server 파일은 ${SAVED_ORIG} 입니다. 다음 pull이 막히면 git checkout HEAD -- server 후 고친 코드를 다시 pull 하세요." "$KEEP"
      fi
      fail "새 API가 응답하지 않아 이전 모듈로 다시 시작했습니다. journalctl -u ${SERVICE} -n 50 을 확인하세요." "$KEEP"
    fi
    assert_data
    fail "API를 되돌린 뒤에도 응답이 없습니다. journalctl -u ${SERVICE} -n 50 을 확인하세요." "$KEEP"
  fi
fi

if [[ "$PUBLISHED" -eq 1 ]]; then
  live=$(mktemp /var/lib/depthm/live.XXXXXX)
  if curl -fsS --max-time 10 --resolve "${SERVER_NAME}:443:127.0.0.1" "https://${SERVER_NAME}/" -o "$live"; then
    if ! cmp -s "$STAGE/index.html" "$live"; then
      rsync -a --delete "$ROLLBACK/" "$DOCROOT/" || true
      PUBLISHED=0
      remove_under_lib "$live" || true
      if [[ "$RESTARTED" -eq 1 ]]; then
        if [[ "$MODE" == "--hook" && -n "$SAVED_ORIG" ]]; then
          git checkout "$SAVED_ORIG" -- server || true
        fi
        if [[ "$MODULES_SWAPPED" -eq 1 && -d "$MOD_BACKUP/node_modules" ]]; then
          restore_old_modules || true
        fi
        restart_api || true
      fi
      fail "nginx가 방금 반영한 index.html을 보여 주지 않아 이전 화면으로 되돌렸습니다. 문서 루트 ${DOCROOT} 와 nginx root가 같은지 확인하세요." "$KEEP"
    fi
  else
    say "서버 안에서 https://${SERVER_NAME}/ 확인은 건너뛰었습니다. 문서 루트 파일은 반영되어 있습니다."
  fi
  remove_under_lib "$live" || true
fi

assert_data
if [[ "$NEEDS_WEB" -eq 1 && "$NEEDS_API" -eq 1 ]]; then
  say "배포되었습니다. 화면은 ${DOCROOT} 에 반영했고 API를 다시 시작했습니다. 데이터베이스와 회의자료는 그대로입니다."
elif [[ "$NEEDS_WEB" -eq 1 ]]; then
  say "배포되었습니다. 화면은 ${DOCROOT} 에 반영했습니다. API는 재시작하지 않았고 데이터베이스와 회의자료는 그대로입니다."
else
  say "배포되었습니다. API를 다시 시작했습니다. 화면 파일, 데이터베이스, 회의자료는 그대로입니다."
fi
exit 0
