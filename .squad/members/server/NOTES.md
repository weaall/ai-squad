## 인계 메모
- 입력 요청: lib/input.mjs(검증·requestInput·answerInput) + server POST /api/input/request·answer(토큰·Origin, SSE 는 기존 fs.watch). 시험 lib/input.test.mjs, lib/input.api.test.mjs (63/63). runner·ui 에 형식 handoff 보냄.
- 'input' 은 TASK_STATUSES 에 일부러 없음(수동 PATCH 금지). 
- 커밋 안 됨(git 권한 없음): 사람이 lib/input.mjs, lib/input.test.mjs, lib/input.api.test.mjs, server/index.mjs 를 커밋해야 함.
