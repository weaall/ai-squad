## 인계 메모
- 한도: lib/limits.mjs(readLimit·limitsView·limitHint·weekUsage), data/limits.json 전역 최신값, events type 'limit'. /api/state 에 limits·week. 걸리면 blockedReason '사용 한도', runQueue stoppedBy '사용 한도'. ui·runner 에 handoff 보냄.
- 하루 경계는 KST 21:00(state.mjs usageDay/sameDay — 예산·오늘 사용·예산 승인 모두). 계획·작업 difficulty → runMember modelFor, config.models.
- 'input' 은 TASK_STATUSES 에 일부러 없음(수동 PATCH 금지). rate_limit_event 실제 모양은 실운영 로그로 한 번 확인할 것.
