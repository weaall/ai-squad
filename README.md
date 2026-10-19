# AI Squad

AI 에이전트를 직원처럼 파트별로 나눠 일을 맡기고, 누가 무엇을 하는지와 서로 주고받는 말을 한 화면에서 보는 코워커 관리 시스템입니다. 설계는 [`docs/SPEC.md`](docs/SPEC.md), 메인 오더 운영 규칙은 [`ORDER.md`](ORDER.md)에 있습니다.

- Node 22 표준 모듈만 씁니다. `npm install` 이 필요 없습니다.
- 첫 적용 프로젝트는 QUGO(`C:\Users\weaal\qugo\.squad`)입니다. 멤버 8명: order, site, org-dashboard, admin-dashboard, survey-report, backend, biz-docs, ops.

## 빠른 시작

```powershell
cd C:\Users\weaal\ai-squad
npm test                                  # node --test
node bin/squad.mjs status qugo            # 멤버별 상태 표
node bin/squad.mjs board                  # 보드: http://localhost:4777
```

`npm link` 를 하면 `squad <명령>` 으로 줄여 쓸 수 있습니다.

## 명령

| 명령 | 하는 일 |
|---|---|
| `init <project> <path> [--name 이름]` | `.squad/` 뼈대와 `projects.json` 항목 만들기 (있는 파일은 건드리지 않음) |
| `status [project]` | 멤버별 상태·지금 작업·대기 작업·마지막 이벤트 |
| `order <project> "<지시>" [--dry] [--headroom]` | 메인 오더가 claude 로 계획을 받아 작업·지시 메시지를 남김. `--dry` 는 계획만 출력 |
| `run <project> <member> [taskId] [--headroom]` | 멤버의 가장 오래된 todo(또는 지정 작업)를 `claude -p` 로 실행. 도구 사용은 이름·경로만 이벤트로, 원본은 `logs/` 에 |
| `msg <project> <from> <to> "<내용>" [--kind handoff] [--task T-..]` | 메시지 남기기. from/to 는 멤버 id 또는 `human` |
| `log <project> <member> "<내용>" [--status working\|idle\|blocked]` | 대화형 세션이 지금 하는 일을 보드에 보고 |
| `task add <project> <member> "<제목>" [--detail ..]` | 작업 추가 |
| `task done\|block <project> <taskId> [--summary ..\|--reason ..]` | 작업 끝내기·막힘 표시 |
| `board [--port 4777] [--demo]` | 보드 서버 (127.0.0.1 에만 묶음) |

### Headroom (선택)

`run`·`order` 는 기본으로 `claude` 를 바로 실행합니다. 토큰을 줄이고 싶으면 `--headroom` 을 주거나 MEMBER.md frontmatter 에 `headroom: true` 를 두세요. 그러면 `headroom wrap claude -- ...` 로 감쌉니다. 켜져 있는데 headroom 이 설치돼 있지 않으면 경고만 하고 `claude` 로 실행합니다.

## 보드

`http://localhost:4777` — 상단 단추로 두 보기를 바꿉니다. 어두운 테마가 기본이고 오른쪽 위 단추로 밝은 테마로 바꿀 수 있습니다.

- **연결 보기**: 메인 오더를 가운데, 멤버를 둘레에 둔 캔버스. 메시지가 오갈 때마다 보낸 쪽에서 받은 쪽으로 흰 선이 이어지고 빛 알갱이가 흐릅니다. 최근 선은 밝게 남았다가 옅어지고, 일하는 멤버는 맥박처럼 빛나며 도구를 쓰면 파동이 퍼집니다. 노드나 아래 멤버 카드를 누르면 오른쪽 패널(MEMBER.md·NOTES.md·작업·최근 이벤트 30개)이 열립니다. 움직임 줄이기 설정이면 애니메이션 대신 선 굵기로만 보여 줍니다.
- **모니터 보기**: 멤버마다 한 줄(상태·지금 작업·마지막 이벤트·대기 수). 줄을 펼치면 모델·도구·플러그인·담당 경로·대기 작업·최근 이벤트 10개·인계 메모. 상단에 상태·멤버 필터.
- 두 보기 아래에 **작업 칸반**(추가·담당·상태 변경)과 **대화 줄**(메시지 보내기)이 있습니다.
- 서버가 `.squad/*.jsonl`, `MEMBER.md`, `data/events.jsonl` 을 감시(fs.watch + 2초 폴링)해 SSE `/api/stream` 으로 밀어 줍니다.

## 시연

> **시연 데이터는 실제 기록이 아닙니다.** 처음 보드를 열었을 때 화면이 비어 보이지 않도록 만든 가짜 기록입니다.

```powershell
node bin/squad.mjs board --demo           # 창 1: 시연 데이터 파일로 보드 열기 (상단에 "시연 데이터" 표시)
node scripts/demo-events.mjs qugo         # 창 2: 2.5초마다 시연 메시지·이벤트 보내기 (Ctrl+C 로 멈춤)
node scripts/demo-events.mjs qugo --interval 1000 --count 30   # 빠르게, 30번만
node scripts/demo-events.mjs qugo --reset                      # 시연 데이터 지우기
```

시연 기록은 `data/demo/` 아래 별도 파일(`events.jsonl`, `<project>/tasks.jsonl`, `<project>/messages.jsonl`)에만 쓰이고 모든 줄에 `"demo": true` 가 붙습니다. 실제 기록(`<프로젝트>/.squad/*.jsonl`, `data/events.jsonl`)과 섞이지 않으며, `--demo` 로 연 보드에서 보낸 메시지·작업도 시연 파일로 갑니다. 멤버 문서는 실제 `.squad` 것을 보여 줍니다.

## 저장 구조

```
ai-squad/
  ORDER.md  projects.json  bin/squad.mjs
  lib/            순수 함수(md·state·validate·claude) + 저장소(store) + *.test.mjs
  server/         index.mjs(보드 서버) + public/(index.html·app.js·style.css)
  scripts/        demo-events.mjs(시연)
  data/           events.jsonl, demo/ — git 제외
  logs/           <project>/<member>/<taskId>.log — git 제외
<프로젝트>/.squad/
  SQUAD.md  tasks.jsonl  messages.jsonl  members/<id>/MEMBER.md·NOTES.md
```

## Claude Code 훅 연결 (선택)

AI Squad 는 `~/.claude/settings.json` 을 고치지 않습니다. 대화형 세션의 도구 사용도 보드에 올리고 싶다면 사람이 직접 PostToolUse 훅에 다음과 같은 명령을 걸 수 있습니다.

```
node C:\Users\weaal\ai-squad\bin\squad.mjs log qugo <member> "작업 중" --status working
```

훅 없이도 `run` 은 stream-json 으로 이벤트를 얻고, 대화형 세션은 `squad log` 로 직접 보고하면 됩니다.

## 보안

- 보드는 `127.0.0.1` 에만 묶고, Host·Origin 이 로컬이 아니면 거부합니다(DNS 리바인딩·CSRF 방지). POST 는 `application/json` 만, 본문 16KB·필드 길이 제한.
- 멤버 파일은 등록된 프로젝트의 `.squad/members/<id>/` 안의 MEMBER.md·NOTES.md 만 읽습니다.
- 이벤트에는 도구 이름과 파일 경로만 남기고 내용·명령은 남기지 않습니다.
- `--dangerously-skip-permissions` 는 쓰지 않습니다. 멤버 실행은 `--permission-mode acceptEdits` + `--allowedTools`.
