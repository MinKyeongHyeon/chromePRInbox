# PR Inbox — Pro MVP 스펙

작성일: 2025-12-24
대상 기능: Saved Views(저장된 뷰), Multi-account(멀티 계정), Encrypted Token Storage(암호화 토큰 저장)
목표: 서버 도입 없이(또는 최소화) 빠르게 구현 가능한 Pro 유료 플랜의 핵심 기능을 제공하여 수익 전환 가능성 검증

---

## 1. 목표 요약

- 사용자가 자주 쓰는 복합 필터(레포, 작성자, 라벨, 역할 등)를 저장하고 빠르게 전환할 수 있도록 한다.
- 다중 GitHub 계정을 지원하여 개인/회사 계정 간 전환을 간편화한다.
- 저장된 토큰은 사용자가 선택한 경우 로컬에서 암호화하여 저장(비밀번호/OS 키체인 또는 Web Crypto 기반)하고, sync 저장 시에는 암호화된 상태로 저장하도록 한다.

성공 기준(해당 조건 충족 시 MVP 완료로 간주):

- 사용자에게 `Saved View` 생성/수정/삭제/적용 UI가 제공되고, 적용 시 PR 목록이 즉시 필터링된다.
- 사용자가 2개 이상의 계정을 등록·전환할 수 있고, 각 계정별 필터를 유지할 수 있다.
- 토큰 저장 시 기본은 `local`(암호화된)이며, 사용자가 `sync`를 선택하면 암호화된 문자열이 `chrome.storage.sync`에 저장된다.

---

## 2. 기능 상세

### 2.1 Saved Views (저장된 뷰)

- 기능
  - 현재 필터(Repository substring, Author, Labels, Roles, Sort, 기타)를 `Saved View`로 저장.
  - Saved View 목록: 이름, 설명, 아이콘(선택), 계정 연결(옵션)
  - 단축키 / UI 빠른 액세스: 팝업 상단에 드롭다운으로 노출, 1클릭으로 적용
  - 공유(옵션): 로컬 복사/붙여넣기(공유 링크는 향후 팀 기능으로 확장)
- 데이터
  - 저장 키: `savedViews:{id}` 또는 전체 배열 `savedViews` (sync에 저장할지 옵션 제공)
  - 구조 예시:
    {
    id: "sv_20251224_x",
    name: "My Review Queue",
    description: "팀/관심 레포 우선순위",
    filters: { repo: "team/", author: null, labels: ["bug","high"], roles: ["review_requested"] },
    ownerAccount: "github:mingyeonghyeon@example",
    createdAt: 1700000000000
    }
- UI
  - 팝업 상단에 `Saved Views` 드롭다운(최근 사용 순으로 정렬)
  - `Save current filters` 버튼(필터 패널에 추가)
  - 관리 화면: Saved Views 목록(편집/삭제/복제)
  - 제한 및 Pro 차별화 (권장)
    - 무료 사용자: 최대 3개의 `Saved View` 생성 제한
    - Pro 사용자: 무제한 저장 및 Saved View 별로 공유/내보내기 권한 부여
    - 관리화면에서 Saved View를 `즐겨찾기`로 고정하여 드롭다운 상단에 노출하는 옵션 제공
  - 단축키 및 내보내기/가져오기
    - `Saved View` 적용 단축키(예: 숫자 1–9) 지원(팝업이 열려있을 때 동작)
    - Saved Views를 JSON으로 내보내기/가져오기(import/export) 기능 제공(로컬 복사 붙여넣기 형태)
- 권한/보안
  - 저장 데이터는 필터 메타데이터만 포함 — 토큰/민감정보는 포함하지 않음

### 변경 이력

- 2025-12-24: 초기 스펙 작성
- 2025-12-24: Saved Views에 대한 무료/Pro 제한, 단축키 및 내보내기/가져오기 섹션 추가

원하시면 이 변경사항을 기반으로 구체적인 깃 이슈 목록(예: `saved-views-ui`, `saved-views-storage`, `saved-views-import-export`, `saved-views-billing`)을 생성해 드리겠습니다.

### 2.2 Multi-account (멀티 계정)

- 기능
  - 여러 GitHub Personal Access Token(PAT)을 등록하고 계정별로 전환
  - 각 계정에 대해 별도 `Saved Views`를 연결할 수 있음
  - 계정 추가 시 `options.html`에서 토큰 입력 및 간단 권한(벤리 위임) 검증
- 데이터
  - 저장 키: `accounts` (배열)
  - 구조 예시:
    {
    id: "acct_github_mykor",
    login: "mingyeonghyeon",
    host: "github.com",
    tokenRef: "token_local_id_or_cipher",
    default: true
    }
- UI
  - 팝업 헤더에 계정 전환 드롭다운(아바타 + 로그인)
  - 계정 추가/삭제는 Options 페이지에 배치
- 권한/보안
  - 토큰은 기본적으로 로컬 암호화 저장(see 2.3)
  - 계정 간 데이터(예: seenPRs, pinnedPRs)는 계정별 namespace로 분리하여 충돌 방지

### 2.3 Encrypted Token Storage (암호화 토큰 저장)

- 목표: 사용자가 토큰을 안전하게 보관할 수 있도록 기본적으로 암호화 저장을 제공
- 옵션 전략(우선순위)
  1. Web Crypto + 사용자 비밀번호(로컬 전용): 사용자가 비밀번호를 입력하면 key를 유도(PBKDF2)하고 토큰을 암호화/복호화. `chrome.storage.local`에 암호문 저장.
  2. OS 제공 스토리지 사용(가능 시): macOS Keychain, Windows Credential Manager — 확장에서는 직접 접근 불가(브라우저 제한), 대신 `chrome.identity` 등 복잡함. 우선 1번 권장.
  3. sync 저장 시: 사용자가 `Sync (encrypted)` 옵션을 켜면 암호문을 `chrome.storage.sync`에 저장하되, 복호화는 로컬 비밀번호로만 가능.
- 데이터 모델
  - `tokenStore`:
    {
    id: "token_local_id",
    accountId: "acct_github_mykor",
    cipher: "<base64 ciphertext>",
    cipherMeta: { iv: "...", alg: "AES-GCM", kdf: "PBKDF2", salt: "..." },
    storage: "local" | "sync",
    createdAt: 1700000000000
    }
- UI Flow
  - 옵션 페이지에서 `Save token securely (recommended)` 체크박스
  - 최초 저장 시 사용 비밀번호 입력(또는 빈 비밀번호 허용 선택)을 묻고, 암호화 후 저장
  - 복호화가 필요한 동작(예: background에 인증이 필요한 fetch)에서는 사용자 비밀번호 재입력 요청(세션 옵션 제공, 예: 15분)
- 보안 주의사항
  - 비밀번호는 절대 서버로 전송 안 함
  - 암호화 파라미터(alg, salt 등) 저장 필요
  - 복구: 비밀번호 분실 시 토큰 복구 불가 — 사용자에게 명확히 고지

---

## 3. 구현 아키텍처(클라이언트 우선)

- 기본 원칙: 가능한 한 서버 없이 로컬/브라우저 스토리지만으로 동작하도록 설계
- 저장소: `chrome.storage.local`(기본), `chrome.storage.sync`(옵션)
- 네임스페이스:
  - `accounts` (array)
  - `tokenStore` (map)
  - `savedViews` (array)
  - per-account keys: `seenPRs:{accountId}`, `pinnedPRs:{accountId}`, `snoozedPRs:{accountId}`
- 배경 작업:
  - background service worker는 현재 활성 계정의 token을 참조하여 notifications/graphQL 호출
  - 토큰 복호화 시 background에서 직접 복호화 하지 않고 popup/options와 협업(권한/UX) — 단, 자동 작업을 위해 세션형 복호화 토큰을 background에 일시 보관(메모리)

---

## 4. 개발 분해 및 추정 일정(1인 기준, 주 단위)

가정: 1개의 숙련된 프론트엔드 개발자(Chrome extension 경험) + 짧은 QA/검증

1. 설계 및 준비 (0.5주)
   - 세부 스펙 확정, 데이터 구조 확정, UX 간단 와이어프레임
2. Saved Views 구현 (1.5주)
   - UI: 저장/관리/적용(팝업 필터 패널, 드롭다운)
   - storage: CRUD, sync 옵션
   - 테스트: 단위/통합
3. Multi-account 구현 (1주)
   - account 등록/전환 UI(팝업 header + options)
   - per-account namespace 적용(데이터 분리)
   - token ref model 연결
4. Encrypted Token Storage (1.5주)
   - Web Crypto 기반 암호화/복호화 구현
   - 옵션 UI(로컬 vs sync), 비밀번호 입력/세션 정책
   - 마이그레이션 로직(기존 plain token -> 암호화)
   - 보안/테스트
5. 통합/테스트 (0.5주)
   - E2E 간단 흐름 검증, 문서화, 사용자 가이드 업데이트

총 합계(예상): 5.0주 (약 5주)

비고: 팀 2명 이상 투입 시 3주 내 완료 가능

---

## 5. 수용 기준(AC)

- 사용자는 Saved View를 생성하고 즉시 적용할 수 있다.
- 동일 브라우저에서 계정 전환 시 각 계정의 Saved Views/Seen/Pinned가 분리되어 나타난다.
- 토큰을 암호화하여 저장한 후, background에서 정상적으로 인증 요청이 성공한다(세션 복호화 흐름 테스트).
- 기존 사용자(이미 토큰을 local에 저장한 경우)는 옵션을 통해 암호화 저장으로 마이그레이션 가능.

---

## 6. 테스트 및 롤아웃 계획

- 내부 베타(사내 또는 소수 사용자) 1주 → 피드백 수집
- 베타 기간 중 수집할 지표: SavedView 사용률, 계정 추가 비율, 토큰 저장 방식 선택(local vs sync), 오류/지원 문의
- 가격 론칭: 베타 피드백 기반으로 가격 최종 확정

---

## 7. 개인정보/규정 고려

- 암호화된 토큰 외에는 사용자 토큰을 서버로 전송하지 않음(옵션적 서버 기능 제외)
- sync 저장을 허용할 경우에도 암호문만 sync 저장
- GDPR/데이터 삭제: 계정 제거 시 로컬/ sync에 저장된 데이터(토큰, savedViews, history) 전부 즉시 삭제

---

## 8. 비용/수익 가이드 (간단)

- 개발비: 1인 기준 5주 → 인건비 × 5주
- 인프라: MVP는 서버 불필요(로컬만으로 가능) → 인프라비 0
- 예상 전환율: 무료 사용자 중 1–3%가 Pro 구독으로 전환(업계 평균 참조)
- 가격 제안: Pro $3/mo 또는 $30/yr

---

## 9. 다음 액션(단계별)

1. 이 스펙으로 팀/개발자와 리뷰(1일)
2. UI 와이어프레임(팝업 내 Saved Views와 계정 선택 흐름) 작성(0.5주)
3. 개발 착수: Saved Views → Multi-account → Token 암호화(순서대로)
4. 베타 테스트(1주)

---

파일 생성: `PRO_MVP_SPEC.md` — 원하시면 이 스펙을 바탕으로 구체적인 이슈(깃 이슈) 목록과 PR 템플릿을 만들어 드립니다.
