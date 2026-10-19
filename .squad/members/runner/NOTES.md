## 인계 메모

- T-mveq2ab2-2ec3: 멤버 실행은 이미 loadMembers 실효 headroom(config headroom.default)으로 감쌈. `squad order` 계획 호출도 `--headroom || headroom.default` 로 기본 켬. 미설치면 claude.mjs launcher 가 경고 후 claude 직접 실행.
- T-mveq2ab2-6235: `squad order` 는 planNeedsConfirm 불필요면 saveOrder 후 detached `run-queue`, 필요하면 이유 출력 뒤 y/N(+--auto).
- node --test 102개 통과.
