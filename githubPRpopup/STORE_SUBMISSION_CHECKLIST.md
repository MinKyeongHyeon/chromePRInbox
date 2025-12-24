Chrome Web Store 제출 체크리스트

1. 계정 및 준비

- [ ] Chrome Web Store 개발자 계정 등록(일회성 수수료)
- [ ] 확장 아이콘(128x128 포함) 준비
- [ ] 스크린샷/데모 GIF(권장) 준비

2. 메타데이터

- [ ] 확장 이름/설명 작성
- [ ] 상세 설명(기능, 권한 설명, 개인정보 처리 방식) 작성
- [ ] 지원 이메일/웹사이트 링크 추가

3. 개인정보/환불

- [ ] `PRIVACY_POLICY.md` 내용 복사/붙여넣기 또는 링크 제공
- [ ] `REFUND_POLICY.md` 내용 준비

4. 기술 항목

- [ ] `manifest.json` 권한 최소화 확인(`storage`, `notifications`, `alarms`, `host_permissions`)
- [ ] 아이콘 파일 경로 및 포맷 확인
- [ ] 모든 외부 호출(예: api.github.com) `host_permissions`에 포함

5. 빌드/패키징

- [ ] 번들(필요 시) 및 불필요한 파일 제외 확인
- [ ] `zip` 패키지 생성(루트에 `manifest.json`, 아이콘 및 스크립트 포함)

6. 테스트

- [ ] 로컬에서 `chrome://extensions`로 로드하여 기능 확인
- [ ] 알림, 스누즈, 옵션 저장/로드, 토큰 입력 흐름 테스트

7. 제출 이후

- [ ] 리뷰 응대 계획(리뷰에서 요구하는 정보에 빠르게 대응)
- [ ] 릴리스 노트/업데이트 설명 준비

메모

- Chrome Web Store의 정책은 변경될 수 있으니 최신 가이드를 확인하세요.
