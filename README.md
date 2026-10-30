# 보직회의 지원 시스템

Admin이 Google Drive에 날짜 폴더와 PDF를 올리면, 보직자는 로그인 없이 자료를 보고 그 기기에만 메모를 남깁니다. `회의종료 및 자료전송`을 누르면 메모를 입힌 PDF와 요약을 본인 `@yeonsung.ac.kr` 메일로 받습니다.

화면은 Firebase Hosting, 서버는 Google Apps Script입니다. 유료 기능은 쓰지 않습니다.

주소는 보직자에게만 알려 주세요. 검색엔진에 올리지 않습니다.

## 로컬 실행

```bash
cd web
cp .env.example .env.local
npm install
npm run fetch-font
npm run dev
```

`.env.local`의 `VITE_GAS_URL`에 Apps Script 웹앱 `/exec` 주소를 넣습니다. 비어 있으면 화면은 열리지만 자료 폴더를 불러오지 않습니다.

확인:

```bash
npm run typecheck
npm run lint
npm test
npm run build
```

## 운영자가 넣는 값

코드와 이 문서에는 실제 비밀값을 적지 않습니다. Apps Script 편집기 > 프로젝트 설정 > 스크립트 속성에 넣습니다.

| 키 | 필수 | 설명 |
|---|---|---|
| `ADMIN_PASSWORD` | 예 | Admin 전환 비밀번호. Drive·메일 계정 비밀번호가 아닙니다. |
| `SHEET_ID` | 예 | 기록용 스프레드시트 ID |
| `ROOT_FOLDER_ID` | 나중에 가능 | 자료 루트 폴더 ID. 비워 두고 Admin 화면에서 저장해도 됩니다. |
| `RESULT_FOLDER_ID` | 아니오 | 25MB 초과 발송 파일 폴더. 없으면 `setup` 또는 첫 발송 때 만듭니다. |
| `TOKEN_SECRET` | 자동 | `setup`이 만듭니다. |
| `MAIL_FROM_NAME` | 아니오 | 메일 표시 이름. Admin 화면에서 바꿉니다. |
| `MAIL_FROM_ALIAS` | 아니오 | 배포 계정에 등록된 별칭만. |

메일은 **웹앱을 배포한 구글 계정**으로 나갑니다. 다른 계정으로 보내려면 그 계정으로 Apps Script를 다시 배포합니다. Admin 화면에는 그 주소가 읽기 전용으로 보이고, 표시 이름과 별칭만 바꿀 수 있습니다.

받는 주소는 `@yeonsung.ac.kr`만 허용됩니다. 이 규칙은 설정으로 바꾸지 않습니다.

## Apps Script 배포

1. 자료를 올릴 Google 계정으로 [script.google.com](https://script.google.com)에 로그인하고 프로젝트를 만듭니다.
2. `gas/`의 `.gs` 파일을 같은 이름으로 붙여 넣습니다. 매니페스트를 표시한 뒤 `gas/appsscript.json`으로 바꿉니다.
3. Drive API(v3)가 켜져 있는지 확인합니다.
4. 스크립트 속성에 `ADMIN_PASSWORD`, `SHEET_ID`를 넣습니다. 폴더 ID는 지금 넣거나 Admin 화면에 맡겨도 됩니다.
5. 함수 `setup`을 실행하고 Drive, Sheets, Gmail, 트리거 권한을 승인합니다. 시트 탭 4개, `TOKEN_SECRET`, 매일 03:00 정리 트리거가 만들어집니다.
6. 배포 > 새 배포 > 웹 앱. 실행 계정은 나, 액세스 권한은 모든 사용자(Anyone)입니다.
7. `/exec` 주소가 `{"ok":true,"data":{"service":"bojik",...}}`이면 됩니다.
8. 코드를 고친 뒤에는 배포 관리에서 새 버전으로 갱신합니다. 주소는 유지됩니다.

clasp를 쓸 때는 `gas/.clasp.json.example`을 `.clasp.json`으로 복사해 `<SCRIPT_ID>`를 넣고 `clasp push`합니다. `.clasp.json`은 저장소에 올리지 않습니다.

## Firebase Hosting

Spark(무료)만 사용합니다. Blaze, Cloud Functions, Firestore, Storage는 쓰지 않습니다.

```bash
cd web
cp .env.example .env.production
# VITE_GAS_URL=<웹앱 /exec URL>
npm install
npm run build
cd ..
cp .firebaserc.example .firebaserc
# default 프로젝트 ID를 입력
firebase deploy --only hosting
```

배포 주소는 보직자에게만 전달합니다.

## Admin이 Drive에 올리는 법

1. 루트 폴더 아래 `26.11.06.`처럼 날짜 폴더를 만듭니다. 연도는 두 자리이고, 끝의 점은 없어도 됩니다.
2. 그 안에 `본문`, `별첨`, `규정` 폴더를 만들고 PDF만 올립니다.
3. 파일명 앞 번호(`1_`, `2_`)가 정렬 순서입니다.
4. 자료를 고칠 때는 `1_예산안_수정.pdf`처럼 다른 이름이 원칙입니다. 같은 이름 덮어쓰기도 감지되어 메모가 옮겨지지만 권장하지 않습니다.

보직자에게는 같은 브라우저를 쓰고, 브라우저 데이터를 지우지 말라고 안내합니다. 새 폴더가 안 보이면 자료 폴더 오른쪽 ↻을 누릅니다.

Admin 기기는 첫 화면 또는 사용자 메뉴의 `admin으로 변환`에서 `ADMIN_PASSWORD`를 입력합니다. 틀려도 잠기지 않고, 횟수 제한도 없습니다. Admin 화면에서 회의 일시, 접속 현황, 발송 기록, 자료 폴더, 발신 표시를 바꿉니다.

비밀번호를 바꾸려면 Script Property `ADMIN_PASSWORD`를 수정합니다. 이미 발급된 Admin 토큰까지 끊으려면 `ADMIN_TOKEN_VERSION` 숫자를 올립니다.

## 한글 폰트

화면 글꼴 SCoreDream은 `web/public/fonts`에 있습니다. PDF에 메모를 입힐 때 쓰는 정적 TTF는 저장소에 넣지 않습니다.

```bash
cd web
npm run fetch-font
```

`web/public/fonts/NanumGothic-Regular.ttf`가 없으면 자료전송 때 "한글 폰트 파일이 없습니다"가 나옵니다.

로고는 `web/public/assets/logo.png`입니다. 파일이 없으면 "연성대학교" 글자가 대신 나옵니다.

## 문제 해결

- 자료 폴더가 비어 있고 설정 안내가 보이면 Admin 운영 설정에 Drive 폴더 주소가 없는 것입니다.
- 폴더를 저장했는데 못 연다고 하면, 웹앱을 배포한 계정이 그 폴더를 볼 수 있는지 확인합니다.
- 메일이 다른 사람 주소로 나가지 않습니다. 보내는 계정은 배포 계정입니다.
- `@yeonsung.ac.kr`이 아닌 주소는 화면과 서버 모두에서 거절됩니다.
- 오프라인이면 받아 둔 PDF와 메모만 열립니다. 자료전송은 인터넷이 필요합니다.
- 회의 일시를 저장해 두면, 웹앱을 연 순간부터(보직을 고르기 전 로그인 화면 포함) 회의 10분 전부터 시작 1분 전까지 1분마다 자료 목록을 확인합니다. 그 날짜의 PDF 중 아직 없거나 바뀐 파일만 미리 받아 둡니다. 그 시각에 앱이 꺼져 있었으면 다음에 열 때 받습니다. HWP, 엑셀 등 PDF가 아닌 파일은 목록에 나오지 않습니다.
