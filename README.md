# 보직회의 지원 시스템

관리자가 웹 화면에서 회의를 만들고 PDF를 올리면, 보직자는 직위와 이름을 고른 뒤 비밀번호로 로그인합니다. 메모는 계정별로 서버에 남고, 다른 PC에서 같은 계정으로 들어가면 그 메모가 다시 열립니다. 내려받기는 그 계정의 메모를 원본 PDF에 입혀 저장합니다. 메일은 보내지 않습니다.

운영 화면은 `https://depthm.yeonsung.ac.kr/` 입니다. nginx가 `web/dist`를 보여주고, `/materials-api/`는 같은 서버의 `127.0.0.1:8787`로 넘깁니다. Firebase와 Google Apps Script는 이 화면의 동작에 쓰이지 않습니다. 깃 푸시만으로는 화면이 바뀌지 않습니다.

자료 파일은 `/var/www/depthm-data/materials`, 데이터베이스는 그 옆의 `depthm.sqlite`입니다. 이 폴더는 nginx 문서 루트가 아닙니다.

## 로컬 실행

```bash
cd web
npm install
npm run fetch-font
npm run dev
```

다른 터미널에서 자료 API를 띄웁니다. 개발용 자료 폴더는 `server/data/materials`이고, 데이터베이스는 그 옆의 `depthm.sqlite`입니다.

```bash
cd server
npm install
node api.mjs
```

`web`에서 `npm run dev`를 하면 Vite가 `/materials-api`를 `127.0.0.1:8787`로 넘깁니다.

확인:

```bash
cd web
npm run typecheck
npm run lint
npm test
npm run build
```

```bash
cd server
node --test materials.test.mjs api.test.mjs
```

## 로그인

보직자는 관리 화면의 보직자 관리에 등록합니다. 사번이 첫 비밀번호입니다. 처음 로그인하면 비밀번호를 바꿔야 자료를 볼 수 있습니다. 이후에는 그 비밀번호로 들어갑니다. 비밀번호는 scrypt로 데이터베이스에만 저장합니다.

관리자는 로그인 화면의 `admin으로 들어가기`에서 비밀번호를 입력합니다. 처음 비밀번호는 `admin`이고, 처음 로그인하면 비밀번호를 바꿔야 관리 화면을 쓸 수 있습니다. 이후에는 이름 메뉴에서 비밀번호를 바꿉니다. 보직자 비밀번호를 사번으로 되돌리는 기능은 관리 화면에 있습니다.

다섯 번 연속으로 틀리면 15분 동안 그 계정과 그 주소의 로그인이 멈춥니다.

## 운영 서버

이 저장소만으로는 대학 서버에 올라간 상태가 아닙니다. 서버 관리자가 아래를 수행해야 화면과 API가 바뀝니다.

1. Node.js 24 이상이 있는 계정 `depthm`을 만들고, 이 저장소를 `/var/www/depthm-app`에 둡니다.
2. `/var/www/depthm-data/materials`를 만들고 소유자를 `depthm`으로 합니다. 다른 사용자는 읽지 못하게 합니다.
3. 관리자 비밀번호는 데이터베이스에 저장됩니다. 서버를 처음 열면 비밀번호는 `admin`이고, 로그인 후 바꿉니다.
4. `deploy/systemd/depthm-api.service`를 `/etc/systemd/system/`에 두고 `systemctl enable --now depthm-api`를 실행합니다. 자료 경로가 유닛에 적힌 대로인지 확인합니다.
5. `deploy/nginx/depthm.conf`의 `/materials-api/` 프록시와 `X-Forwarded-Proto`를 반영한 뒤 `nginx -t`와 reload를 합니다. 자료 폴더를 `alias`로 열지 않습니다.
6. 저장소를 받은 뒤 한 번 `sudo bash deploy/install-server-hook.sh`를 실행합니다. 이 스크립트가 실행 중인 nginx 문서 루트와 systemd 경로를 읽고, 화면을 빌드해 문서 루트에 반영한 다음 API를 다시 시작합니다.
7. `NODE_ENV=production`이면 자료 폴더를 쓸 수 없으면 프로세스가 시작하지 않습니다. 개발 폴더로 바꾸지 않습니다.

## git pull로 배포

Git 훅은 저장소에 넣어도 서버에 자동으로 설치되지 않습니다. 서비스와 nginx가 이미 떠 있는 서버에서, 앱을 실행하는 계정으로 한 번만 설치합니다.

```bash
cd /var/www/depthm-app
git pull
sudo bash deploy/install-server-hook.sh
```

설치 스크립트는 `nginx -T`와 `systemctl cat`으로 문서 루트, 저장소, 회의자료, 데이터베이스 경로를 읽습니다. 그 경로가 서로 겹치거나 데이터베이스 파일이 없으면 설치를 멈춥니다. 자료 디렉터리의 소유권은 바꾸지 않습니다. API 재시작만 `sudo`로 허용하고, 그 명령은 `systemctl restart`와 `systemctl reset-failed`로 한정합니다.

이후에는 그 계정으로 저장소에서 `git pull`만 하면 됩니다. `post-merge` 훅이 화면 변경이면 빌드가 끝난 뒤에만 문서 루트를 바꾸고, API 변경이면 코드를 불러온 뒤에만 서비스를 다시 시작합니다. 빌드나 재시작이 실패하면 이유를 출력하고 이전 화면과 이전 API로 되돌립니다. `git pull` 자체는 이미 끝난 병합을 취소하지 않으므로, 실패 문구를 확인합니다. 같은 커밋을 다시 배포할 때는 `bash deploy/publish.sh --install`을 실행합니다.

`/var/www/depthm-data`의 SQLite와 회의자료, 메모는 이 배포가 복사하거나 지우지 않습니다. 푸시만으로는 운영 화면이 바뀌지 않습니다.

서비스 확인:

```bash
systemctl status depthm-api
journalctl -u depthm-api -n 100 --no-pager
```

## 백업과 복구

```bash
cd /var/www/depthm-app
node server/backup.mjs /var/www/depthm-data/backups/수동
```

백업 폴더에는 `depthm.sqlite`와 `materials`가 함께 있습니다. 삭제된 원본은 `materials/.trash`에 있습니다.

복구할 때는 서비스를 멈추고, 백업의 데이터베이스 파일과 `materials` 폴더를 원래 자리에 덮어쓴 다음 서비스를 다시 시작합니다. 웹 화면만 다시 배포해도 메모와 자료는 지워지지 않습니다.

## 메모와 자료

메모는 PDF에 바로 합치지 않고, 사용자 ID·회의·파일 ID 기준으로 데이터베이스에 저장합니다. 저장이 실패하면 화면에 알리고 그 브라우저에 남겨 두어 다시 보낼 수 있습니다. 같은 메모를 두 화면에서 고치면 먼저 저장된 쪽을 유지하고, 나중에 저장한 화면에서 덮어쓸지 서버 내용을 불러올지 고릅니다.

자료를 삭제하면 원본은 `.trash`로 옮겨지고 메모 행은 남습니다. 자료를 교체하면 같은 파일 ID에 새 PDF가 들어가고 메모도 남습니다. 페이지 구성이 바뀌면 메모 위치가 어긋날 수 있습니다. 내려받기와 메모 저장은 원본 파일을 수정하지 않습니다.

같은 날짜에 회의가 여러 개일 수 있습니다. 폴더 이름은 `26.11.12.`이고, 그 안에 회의 ID 폴더가 따로 있습니다.
