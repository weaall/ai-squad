## 인계 메모
- 한도: lib/limits.mjs(readLimit·limitsView·limitHint·weekUsage), data/limits.json 전역 최신값, events type 'limit'. /api/state 에 limits·week. 걸리면 blockedReason '사용 한도', runQueue stoppedBy '사용 한도'. ui·runner 에 handoff 보냄.
- 하루 경계는 KST 21:00(state.mjs usageDay/sameDay — 예산·오늘 사용·예산 승인 모두). 계획·작업 difficulty → runMember modelFor, config.models.
- 'input' 은 TASK_STATUSES 에 일부러 없음(수동 PATCH 금지). rate_limit_event 실제 모양은 실운영 로그로 한 번 확인할 것.
- headroom: config headroom.default(기본 true) + store.resolveHeadroom — MEMBER.md 'false' 만 끈다. loadMembers 의 m.headroom 이 실효값(paths.root 로 config 읽음), /api/state·toggle 응답에 그대로.
- 자동 배정: /api/order 는 planNeedsConfirm 결과(needsConfirm·reasons)를 같이 준다. 확인 불필요면 saveOrder + startQueue(백그라운드 runQueue, 프로젝트당 1개) → 응답 tasks·queue('started'|'running'|'off'). /api/order/confirm 도 저장 뒤 대기열 시작. 끝/실패는 events type 'queue'.
- startBoard queue 옵션: planner 가짜면 기본 null(시험에서 멤버 실제 실행 안 함). 멤버 프롬프트에 모호하면 `squad ask ... form` 안내 줄 추가.
