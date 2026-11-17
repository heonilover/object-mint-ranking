# OBJΞKT Mint Ranking — 무료 웹사이트 + Firebase 저장

**사이트:** GitHub Pages · **저장:** Firebase Cloud Firestore(Spark) · **자동 수집:** GitHub Actions · **출처:** objekt.top.
기존 FCO 프로젝트와 완전히 별개이며, 브라우저에서 객체별 최초 민팅 수량을 합산해 표시합니다. npm/Node 설치는 GitHub Actions 서버에서만 진행되므로 **사이트 방문자는 설치가 필요하지 않습니다.**

## 현재 개발·검증 상태 (꼭 읽어주세요)

- ✅ 화면과 필터, 지갑별 합산, 시리얼별 중복 방지, CSV 내보내기 구현
- ✅ 사용자가 제공한 `serialTransfers` 예시에서 토큰 ID `20629058`의 `KiwiKoko` 추출 테스트 통과
- ✅ oRPC POST 요청 형태는 코드에 반영 (공식 oRPC 프로토콜 기반)
- ⚠️ **실제 objekt.top 서버를 이 제작 환경에서 호출하지 못했습니다.** 서버 연결이나 8종 전체 수집을 성공했다고 말할 수 없습니다.
- ⚠️ 사용자 URL로 확인한 slug는 `binary02-hyerin-331z`뿐입니다. 다른 7개는 동일한 패턴을 사용한 **추정값**으로, 확인이 필요합니다.
- ⚠️ GitHub Pages 공개 주소는 **아직 배포되지 않았습니다.** GitHub 계정과 Firebase 프로젝트를 한 번 연결해야 합니다.

## 사이트를 여는 사람의 사용 방법

웹주소에 접속하여 오브젝트를 선택하고 구매량 순위를 확인하면 됩니다. 개발자 도구, 브라우저 북마크, 프로그램 설치는 필요하지 않습니다. 집계 기준은 **시리얼별 가장 오래된 수령 기록의 주소**, 즉 사용자가 정의한 최초 구매자입니다. 양도 후 현재 보유자는 계산하지 않습니다.

## 최초 1회 설정 (돈 내는 설정 없음)

### A. Firebase: 데이터 저장만 사용

1. https://console.firebase.google.com 에서 **무료 Spark** 프로젝트를 새로 만듭니다. 기존 FCO 프로젝트는 건드리지 않는 게 안전합니다.
2. `Firestore Database`에서 `(default)` 데이터베이스를 만듭니다.
3. Firestore `규칙(Rules)`에 이 폴더의 `firestore.rules` 내용 **전체**를 붙여 넣고 게시합니다. `rankShards`와 `public/status`는 읽기 전용, 나머지 데이터는 클라이언트에서 접근 불가입니다.
4. ✅ `docs/config.js`에는 **object-mint-ranking** Firebase 웹 앱 설정을 이미 연결했습니다. 별도의 설정값 복사가 필요하지 않습니다. 이 값은 공개 웹 앱 설정값이며 **서비스 계정 비밀키가 아닙니다.**
5. `프로젝트 설정 → 서비스 계정 → 새 비공개 키 생성`으로 받은 JSON의 전체 내용을 GitHub 저장소의 비밀값(Secrets)에만 추가합니다. 파일을 GitHub 저장소에 업로드하거나 채팅에 붙이지 마세요. 가능하다면 별도의 최소 권한 서비스 계정을 사용하세요.

### B. GitHub: 사이트와 자동 수집

1. GitHub에서 **공개(Public) 저장소**를 하나 만듭니다. GitHub Free에서 Pages 브랜치 배포가 지원됩니다.
2. 이 압축 파일의 폴더 구조를 유지한 채 저장소의 최상위 경로에 업로드합니다 (`docs/`, `src/`, `scripts/`, `.github/workflows/sync.yml` 포함). `docs/config.js`에는 이 프로젝트의 Firebase 웹 설정이 이미 들어 있습니다.
3. `Settings → Secrets and variables → Actions → New repository secret`에서 이름을 **`FIREBASE_SERVICE_ACCOUNT_JSON`** 으로 만들고 서비스 계정 키 JSON 전체를 값으로 넣습니다. **프로젝트 코드나 `config.js`에 절대 넣지 마세요.**
4. `Settings → Pages → Build and deployment → Deploy from a branch → main /docs → Save`를 선택합니다.
5. 생성되는 주소 `https://깃허브아이디.github.io/저장소이름/`으로 접속할 수 있습니다. 호스팅과 Firestore는 서로 별개 서비스입니다.

### C. 데이터 수집 테스트 및 시작

1. GitHub 저장소의 `Actions → Update objekt purchase rankings → Run workflow`를 선택합니다.
2. **mode `probe`** 로 먼저 실행합니다. `binary02-hyerin-331z`의 시리얼 목록과 시리얼 #1의 가장 오래된 수령자를 **읽기만** 하고 로그를 표시합니다. 비교하고 싶은 다른 시리얼이 있으면 `serial`을 변경하세요. `KiwiKoko`의 시리얼 번호는 아직 알려져 있지 않으므로 #1에서 KiwiKoko가 나오리라는 보장은 없습니다.
3. API 연결이 실제로 성공하면 **mode `sync`** 를 한 번 실행합니다. Firebase에 새 기록을 저장합니다. 이후 15분 간격 예약 실행이 이어집니다.
4. 웹사이트에는 수집 수량, 진행률, 각 지갑의 합산 순위가 나타납니다. 최초 전체 집계에는 시간이 걸리므로 완료 전에는 **잠정 순위**로 표시합니다.

## Firebase 저장 구조

| 경로 | 설명 |
| --- | --- |
| `receipts/{slug}__{serial}` | 시리얼 원본: 최초 수령 지갑, 닉네임, tokenId, 수령 시각 |
| `rankShards/{00..63}` | 지갑 주소별 누적 총수량 / 오브젝트별 수량 (`buyers` 맵) |
| `collectionState/{slug}` | 전체 시리얼 번호, 이미 집계한 번호, 마지막 확인 시간 |
| `public/status` | 마지막 수집 시각, 8종별 집계 진행률, 원본 API 에러 |

동일한 시리얼이 두 번 저장되면 Firestore `create`의 중복 조건 오류로 저장이 취소됩니다. 시리얼과 구매량 증가는 한 번의 원자적 batch commit으로 진행되어, 실패한 저장으로 순위만 오르는 일이 없도록 구현했습니다.

## 갱신 간격과 무료 사용량

- GitHub Actions의 수집은 **15분마다 최대 72개 시리얼**, 요청 간 최소 약 1초 대기로 설정했습니다. 다만 예약 실행 시각은 정확히 보장되지 않습니다.
- 최초 대상이 수천~수만 장이면 전체 수집에 **하루 이상 걸릴 수 있습니다.** 설정을 공격적으로 올리면 상대 서비스에 부담을 주고 Firebase Spark 무료 한도를 초과할 수 있어 제한을 유지했습니다.
- 웹사이트는 Firestore 변경을 구독합니다. 수집 작업이 끝난 뒤에는 새로고침 없이 변경된 구매량이 표시됩니다. 엄밀한 실시간 민팅 추적은 아닙니다.
- Firestore Spark는 저장 1GiB, 읽기 50,000회/일, 쓰기 20,000회/일의 기본 무료 할당량이 있습니다. 무료 한도를 초과하면 일시적으로 작업이 중단될 수 있습니다.
- 공개 저장소 기반 GitHub Pages는 링크를 아는 사람뿐 아니라 주소를 발견한 사람도 사이트와 공개 랭킹을 볼 수 있습니다. **진짜 비공개 접근 제어는 아닙니다.**

## 문제가 생기면

| 증상 | 볼 곳 | 원인 후보 |
| --- | --- | --- |
| Firebase 설정 필요 | `docs/config.js` | 웹 앱 설정 누락 |
| `permission-denied` | Firestore Rules | 읽기용 규칙 미게시 |
| Probe: HTTP 400/404 | GitHub Actions 로그 | slug 오류 또는 RPC 입력/경로가 실제 서버와 다름 |
| Probe: HTTP 403/429 | GitHub Actions 로그 | 외부 서버 접근 제한 또는 요청 제한. 제한을 우회하지 말고 중단/조정 |
| Probe: transfers 배열 없음 | GitHub Actions 로그 | 실제 응답 스키마 차이 |
| 사이트는 열리는데 0장 | GitHub Actions logs, `public/status` | 수집 미시작 / 데이터 미확인 / API 실패 |
| GitHub Pages 404 | Settings → Pages | main /docs 분기 설정 확인 |

이 저장소는 **Firebase Cloud Functions를 사용하지 않습니다.** 별도 유료 요금제 연결도 요구하지 않습니다. 지갑 주소가 그대로 수집되는 특성을 고려해 공개 범위와 서비스 약관을 확인하세요.
