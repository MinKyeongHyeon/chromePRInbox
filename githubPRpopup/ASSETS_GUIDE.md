Chrome Web Store: 아이콘·스크린샷 가이드

현재 상태

- 발견된 아이콘: `icon.png` (저장소 루트)
- 스크린샷/데모 GIF: 없음 (권장: 최소 1~3개 스크린샷)

필요한 아이콘

- 128x128 PNG (스토어 썸네일)
- 48x48, 32x32, 16x16 (action / toolbar 용)
- manifest.json에 참조된 파일이 모두 존재해야 함(현재: 16/32/48/128 모두 `icon.png`로 지정)

권장 작업

1. `icon.png`가 고해상도(>=128px)인지 확인. 부족하면 128px 버전을 준비하세요.
2. 별도 사이즈 파일 생성(권장): `icon-128.png`, `icon-48.png`, `icon-32.png`, `icon-16.png`.
   - manifest.json을 명시적으로 각 크기 파일로 참조하도록 변경 권장.

macOS 기본 유틸(sips)로 크기 변환 예시

```bash
# 128px
sips -Z 128 icon.png --out icon-128.png
# 48px
sips -Z 48 icon.png --out icon-48.png
# 32px
sips -Z 32 icon.png --out icon-32.png
# 16px
sips -Z 16 icon.png --out icon-16.png
```

ImageMagick(권장, 더 세밀한 제어 가능)

```bash
# 설치 (macOS)
brew install imagemagick
# 리사이즈
magick convert icon.png -resize 128x128 icon-128.png
magick convert icon.png -resize 48x48 icon-48.png
magick convert icon.png -resize 32x32 icon-32.png
magick convert icon.png -resize 16x16 icon-16.png
```

스크린샷 가이드

- 권장 크기: 1280x800 이상(스토어가 자동으로 조정). PNG 형식 권장.
- 종류: 팝업(확장 클릭 시 보이는 UI), Options 페이지, 알림/스누즈 매니저(상태 변화 스냅샷).
- 캡처 방법: 로컬에서 `chrome://extensions` > 개발자 모드 > 확장 로드(압축해제) 후 팝업을 열어 macOS 화면 캡처(`Shift+Cmd+4`)로 캡처.
- 데모 GIF(선택): 단기(5–10s) GIF로 기능 흐름(스누즈 설정 → 알림)을 보여주면 사용자 이해에 도움.

manifest.json 권장 점검 항목

- `icons`에 각 사이즈 파일을 명시적으로 선언하세요. 예:
  "icons": { "16": "icon-16.png", "32": "icon-32.png", "48": "icon-48.png", "128": "icon-128.png" }
- `action.default_popup` 및 `options_page`는 올바르게 설정되어 있음(확인: `popup.html`, `options.html`).
- `host_permissions`는 필요한 범위만 포함(`https://api.github.com/*`) — 현재 적절함.
- `permissions`: `storage`, `alarms`, `notifications` 등 최소 권한만 유지되어 있음.

패키징 전 체크리스트

- 불필요한 개발 파일(.git, node_modules, tests 등)을 제외하고 루트에 `manifest.json` 위치 확인
- 모든 스크린샷/아이콘이 프로젝트에 포함되어 있는지 확인
- README/스크린샷 캡션 준비(스토어 상세 설명에 사용)

다음 단계 (제가 할 수 있는 것)

- `icon.png` 크기 확인(픽셀 크기) 후 사이즈별 PNG 파일 생성(명령 실행 필요)
- `manifest.json`을 업데이트하여 사이즈별 아이콘 파일을 참조하도록 수정
- 스토어 설명용 캡션 텍스트 초안 작성

원하시면 제가 `icon-128.png` 등 파일명을 manifest에 반영하는 패치와, 아이콘 변환 명령을 실행할 스크립트(`scripts/make-icons.sh`)를 생성해 드리겠습니다.
