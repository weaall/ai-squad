## 인계 메모

- T-mveuxgjp-3a3e: msg --kind handoff → 받는 멤버 인계 작업(제목=첫 줄, detail 에 원래 작업 id)+run-queue 깨움. agy 프롬프트 앞에 AGY_RULE(셸 금지), denied_actions 있으면 답이 있어도 실패 → claude 대체. 경로 밖 경고 보드 표시·다른 멤버 몫 표시는 server T-mvev6m3v-3f3a 대기.
- T-mveuctfq-a3de / T-mveurkrt-5e24: route.mjs routeTask·routedRunner, headroom 항상 켬(claude.mjs launcher). 보드 표시는 ui M-mveusfn0-c3b4·M-mveuu7kk-2159 대기.
- T-mveubxm6-d4b4: run-queue 는 locks/run-queue.lock 으로 프로젝트당 하나, wakeQueue 로 깨움. 위험 명령은 `approve run` 만. agy 설치 URL 확정되면 bin/setup.mjs DEFAULT_TOOLS 에 추가.
