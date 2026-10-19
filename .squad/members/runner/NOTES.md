## 인계 메모

- T-mves6pxd-39ba: `squad msg` 뒤처리 bin/msg.mjs afterMessage — question → 받는 멤버 답변 작업(easy)+detached run-queue, answer --task T → T 가 input/blocked(task.input 없음)면 todo.
- 프롬프트 규칙·멤버 목록, run 시작 때 안 읽은 메시지+readAt, 오더 요약은 lib 소유라 server 에 handoff(M-mvesbovk-5449).
- node --test 106개 중 lib/v04 run-queue 동시 실행 타이밍 테스트 1개 실패(lib 미변경, 부하 의심).
