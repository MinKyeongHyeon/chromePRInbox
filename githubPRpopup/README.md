# PR Inbox — 개발자용 GitHub Unread PR 확장

이 저장소는 GitHub의 Unread PR을 빠르게 확인하고 읽음 처리할 수 있는 크롬 확장입니다.

## 변경사항 (요약)

- Notifications API 기반으로 PR 조회 및 읽음 처리 구현
- 페이징(더 불러오기), PR 메타(작성자/번호/업데이트), 수동/자동 새로고침 추가
- 읽음 처리 재시도(최대 3회, 지수 백오프)
- options에서 토큰 검증 시 Notifications 권한 확인

## 설치/실행

1. chrome://extensions 이동 후 '개발자 모드' 활성화
2. '압축해제된 확장 프로그램 로드'로 이 디렉터리 선택
3. Options에서 GitHub 토큰(Notifications Read&Write 포함)을 입력
4. 확장 아이콘 클릭하여 Unread PR을 확인

## 테스트 지침

## 개발자 노트

- `popup.js`는 모듈 없이 동작하도록 단일 파일로 유지했습니다.
- `options.js`에서 토큰 검증시 `/notifications?per_page=1`로 scope 확인합니다.

(Playwright E2E는 확장을 unpacked로 불러오는 브라우저 인스턴스를 사용해야 하므로, 테스트를 완전히 작동시키려면 로컬에서 Chromium을 확장과 함께 시작하도록 설정이 필요합니다.)

간단 실행(로컬):

```bash
# 확장 루트에서
npx playwright install
node e2e/run-local.js
```

`e2e/run-local.js`는 기본적으로 확장 폴더(`..`)를 unpacked extension으로 로드하고 `popup.html`을 열어 스누즈 항목 렌더링을 확인합니다.
