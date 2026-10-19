---
id: server
name: 보드 서버·API
initials: SV
runner: claude
model:
headroom: true
owns:
  - "server/*.mjs"
  - "lib/**"
reads:
  - "docs/SPEC.md"
  - "README.md"
tools:
  - "Read"
  - "Edit"
  - "Write"
  - "Glob"
  - "Grep"
  - "Bash(node *)"
  - "Bash(npm test*)"
  - "Bash(curl *)"
plugins:
  headroom: true
---

## 역할

보드 서버(server/index.mjs)의 API·SSE·접속 토큰과 lib/ 의 순수 함수(검증·상태 판단·저장). 새 로직은 순수 함수로 떼고 node:test 를 붙인다.

## 지금 작업

인계: runQueue 의 검수(lib/runner.mjs runReview)도 lib/runners/precheck.mjs 의 precheck({me

## 인계 메모

## 하지 말 것

- npm 의존성 추가 금지, 127.0.0.1 바인딩·Host/Origin 검사·접속 토큰을 약하게 하지 않는다.
- 화면(server/public/**)은 ui 멤버 소유 — 필요하면 handoff.
