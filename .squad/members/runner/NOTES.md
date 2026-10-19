## 인계 메모

- T-mvemvifb-0208: scripts/demo-events.mjs 토큰을 budgetTokens 기준으로, 상한 95% 넘으면 사용량 0(82% 경고 유지). af2d809 커밋. config daily=0 이면 예산 시연 안 보임.
- T-mvemvifb-9cee `--retry`(retry.mjs) — runQueue 적용·timedOut 반환은 server handoff(M-mvenltgt-8c21). 이전: lock.mjs, `squad ask`.
- node --test 69개 통과. 미커밋(사람이 커밋): bin/{squad,ask,ask.test}.mjs, lib/runners/{lock,proc,retry}{,.test}.mjs, lib/input.mjs.
