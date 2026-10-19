## 인계 메모

- T-mveq2ab2-f1a7: run-queue 멈춤 원인 = proc.mjs collect 가 'close' 만 기다림 → 자식 종료 뒤 손자가 stdout 을 쥐면 영영 대기. 'exit' 뒤 2초 유예 후 파이프 닫고 끝내도록 고침(proc.test.mjs 재현 테스트). runQueue 종료 조건(stoppedBy·running 비면 끝)은 문제 없음.
- T-mveq2ab2-cbb0 GIT_TOOLS(add·commit) / T-mvemvifb-9cee `--retry` — 각각 server handoff(M-mveq6xzp-9366, M-mvenltgt-8c21).
- node --test 76개 통과.
