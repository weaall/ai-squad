---
id: runner
name: CLI·실행기
initials: RN
runner: claude
model:
headroom: false
owns:
  - "bin/**"
  - "lib/runners/**"
  - "scripts/**"
reads:
  - "docs/SPEC.md"
  - "squad.config.json"
tools:
  - "Read"
  - "Edit"
  - "Write"
  - "Glob"
  - "Grep"
  - "Bash(node *)"
  - "Bash(npm test*)"
plugins:
  headroom: false
---

## 역할

squad CLI(bin/squad.mjs)와 runner 어댑터(claude·command), 실행 안전장치(시간 초과·프로세스 정리·중복 실행 방지), 시연 스크립트.

## 지금 작업

## 인계 메모

## 하지 말 것

- --dangerously-skip-permissions 금지, push 금지(승인 요청으로).
- lib/runners 밖 lib/** 는 server 멤버 소유.
