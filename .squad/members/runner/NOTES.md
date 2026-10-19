## 인계 메모

- T-mveurkrt-5e24: headroom 은 항상 켬(runners/claude.mjs launcher, 설치 안 됐으면 경고 후 claude). CLI --headroom 제거, doctor 는 늘 headroom 점검. order 작업 대기열 제외(lib/queue.mjs:85)·config/store 스위치 제거는 server M-mveuu66b-6382, 보드 '항상 켜짐' 표시는 ui M-mveuu7kk-2159 대기.
- T-mveuctfq-a3de: route.mjs routeTask + index.mjs routedRunner(antigravity 실패 시 claude 대체). runMember 연결 등은 server M-mveusfjn-12f6, 화면 ui M-mveusfn0-c3b4 대기. agy 헤드리스 run_command 자동 거부 → '도구 거부' 실패 처리.
- T-mveubxm6-d4b4: run-queue 는 locks/run-queue.lock 으로 프로젝트당 하나, wakeQueue 로 깨움. 위험 명령은 `approve run` 만 실행(T-mveu426k-9122). agy 설치 URL 확정되면 bin/setup.mjs DEFAULT_TOOLS 에 추가.
