# AI Squad — 설계 (v0.4, 2026-10-19)

AI 에이전트를 "직원"처럼 파트별로 나눠 일을 맡기고, 누가 무엇을 하는지·서로 무슨 말을 주고받는지를 한 화면에서 보는 코워커 관리 시스템. 첫 적용 프로젝트는 QUGO(`C:\Users\weaal\qugo`).

## 1. 원칙

1. **메인 오더(Main Order)** 가 지시를 받아 파트(스쿼드 멤버)에게 나눠 준다. 파트가 잘 나뉘면 멤버마다 맥락이 좁게 유지돼 전문성이 높아지고 토큰이 준다. 그래서 메인 오더의 문서(`ORDER.md`)와 각 멤버 문서(`MEMBER.md`) 관리가 핵심이다.
2. 스쿼드는 화면 단위(메인 페이지·대시보드·문진)만이 아니라 IR·PoC 같은 사업 문서 파트도 포함하는, 프로젝트마다 전형적이지만 전문적인 구성이다.
3. **커뮤니케이션이 가장 중요하다.** 지시·인계·질문·완료 보고가 모두 메시지로 남고 보드에 보인다.
4. 멤버마다 쓰는 AI(모델)·플러그인·스킬·MCP·도구가 문서에 적혀 있어야 하고, 메인 오더는 그것을 보고 일을 배정한다. Claude(Claude Code CLI)가 메인이고, 다른 AI(예: 모두의창업 지원 솔루션)는 `squad.config.json` 의 runner 로 붙인다 → 멤버의 `runner` 값으로 고른다(8절).
7. **(v0.3) 어떤 파트도 뒤떨어지거나 동떨어지지 않는다.** 분업(owns 감시·승인 대기), 토큰 관리(사용량 누적·짧은 요약), 커뮤니케이션(답 없는 인계·멈춤 표시, 확인 모달)을 보드와 메인 오더 요약 양쪽에 보인다.
5. 메인 오더 문서는 AI Squad 저장소에, **멤버 문서는 해당 프로젝트 안의 폴더**(`<프로젝트>/.squad/members/<id>/MEMBER.md`)에 둔다. 그래야 그 프로젝트에서 일하는 어떤 에이전트든 서로의 맥락과 작업을 읽을 수 있다.
6. 토큰 절약: 멤버 실행은 기본으로 `claude -p ...` 를 바로 띄운다. Headroom(압축 프록시)은 필수가 아닌 선택 도구로, `--headroom` 플래그나 MEMBER.md frontmatter 의 `headroom: true` 가 있을 때만 `headroom wrap claude -- -p ...` 로 감싼다(2026-10-19 변경). 실행 로그는 파일에 쓰고 보드에는 요약 이벤트만 올린다.

## 2. 저장 구조

```
C:\Users\weaal\ai-squad\                 # 이 저장소 (git)
  ORDER.md                               # 메인 오더 운영 규칙 — 분배 기준, 메시지 규칙, 완료 기준
  projects.json                          # { "qugo": { "name": "QUGO", "path": "C:\\Users\\weaal\\qugo" } }
  bin/squad.mjs                          # CLI
  server/                                # 보드 서버 + 정적 화면 (의존성 없음, node 22 표준 모듈만)
  lib/                                   # 공용 순수 함수 (MD frontmatter 파싱, 이벤트 요약, 상태 계산) + *.test.mjs
  data/events.jsonl                      # 실행 이벤트 (git 제외)
  data/captures/*.png                    # (v0.4) 화면 캡처 (git 제외)
  logs/<project>/<member>/<taskId>.log   # 멤버 실행 원본 로그 (git 제외)
  docs/SPEC.md

<프로젝트>\.squad\                       # 예: C:\Users\weaal\qugo\.squad
  SQUAD.md                               # 프로젝트 개요, 멤버 목록·경계, 공용 규칙 링크(각 저장소 CLAUDE.md)
  tasks.jsonl                            # 작업: {id, title, detail, member, status: todo|doing|review|blocked|done, createdBy, createdAt, updatedAt, summary,
                                         #        step?, dependsOn?, reviewer?, diffStat?, reviewNote?, blockedReason?, usage?, attachments?}
  messages.jsonl                         # 대화: {id, at, from, to, kind: order|handoff|question|answer|report|note, taskId?, text, attachments?}
  approvals.jsonl                        # (v0.3) 승인 대기 — 요청 줄 + 결정 줄 (v0.4: 상세 필드, action budget)
  inbox.jsonl                            # (v0.4) 데스크톱 세션 지시 — add / take / done 줄
  reports\YYYY-MM-DD.md                  # (v0.4) 일일 보고
  members\<id>\MEMBER.md                 # 멤버 문서 (아래 형식)
  members\<id>\NOTES.md                  # 멤버가 스스로 남기는 작업 메모·인계 (짧게 유지)
```

## 3. MEMBER.md 형식

```markdown
---
id: org-dashboard
name: 기업 대시보드
emoji: (쓰지 않음 — 이모지 금지. 화면은 이니셜 아바타)
runner: claude            # squad.config.json 의 runners 이름(claude, startup-ai 등) | external (사람이 넘겨 주는 AI — CLI 가 실행하지 않음)
model: claude-opus-5-5    # claude -p --model 값 (비우면 기본)
owns:                     # 이 멤버가 고치는 경로 — 다른 멤버는 손대지 않는다
  - qugo_fe_web/app/organization/**
reads:                    # 참고만 하는 경로
  - qugo_fe_web/CLAUDE.md
tools:                    # claude -p --allowedTools 로 넘길 도구 (없으면 기본 Read·Edit·Write·Glob·Grep)
  - Read
  - Edit
  - "Bash(npx tsc *)"
plugins:                  # 플러그인·스킬·MCP 켜기·끄기 맵. 켜진 것만 실행 프롬프트·오더 요약에 들어간다
  design:design-critique: true
  dataviz: false          # 옛 배열 형식 `plugins: [a, b]` 도 읽는다(모두 켜짐)
initials: OD              # 아바타 이니셜 (비우면 id 에서 만든다)
headroom: false           # true 면 run 이 headroom wrap claude 로 감싼다 (선택)
budget: 300000            # (v0.4) 이 멤버의 하루 토큰 상한 (비우면 squad.config.json budget.memberDaily)
reviewer: site            # (v0.4) 끝난 작업을 검수할 멤버 (비우면 config review.default, 그것도 없으면 검수 없음)
---

## 역할
## 지금 작업        ← 실행 중 CLI 가 갱신
## 인계 메모        ← 멤버가 끝낼 때 남김 (3줄 이내)
## 하지 말 것
```

## 4. CLI (`node bin/squad.mjs <명령>`, 나중에 `npm link` 로 `squad`)

| 명령 | 하는 일 |
|---|---|
| `init <project> <path>` | `.squad/` 뼈대와 `projects.json` 항목 만들기 (있으면 건드리지 않음) |
| `status [project]` | 멤버별 상태·지금 작업·대기 작업 수를 표로 |
| `order <project> "<지시>" [--dry] [--auto] [--headroom]` | 메인 오더 실행: `squad.config.json` 의 `mainAi`(runner·모델)로 ORDER.md + SQUAD.md + 멤버 짧은 요약(8.4)을 넣어 계획(JSON: `[{member, title, detail, why, step}]`, step 은 실행 순서)을 받는다. **사람이 터미널에서 y 로 승인해야** 작업·지시 메시지로 저장한다(자동 배정 없음, 터미널이 아니면 저장하지 않음). `--dry` 는 계획만, `--auto` 는 배정 뒤 한 번 더 승인하면 step 순서대로 `run` 을 차례로 돌린다(막히면 멈춤). 계획 사용량은 `plan` 이벤트로 남긴다 |
| `run <project> <member> [taskId] [--headroom]` | 그 멤버의 가장 오래된 todo(또는 지정 작업)를 실행: 프롬프트 = MEMBER.md + NOTES.md + 작업 + 실행 규칙. `claude -p <프롬프트> --output-format stream-json --verbose --permission-mode acceptEdits --allowedTools ...` 를 프로젝트 경로에서 띄우고(`--headroom` 이나 MEMBER.md `headroom: true` 면 `headroom wrap claude -- ...` 로 감싼다), stream-json 을 읽어 도구 사용(도구 이름·파일 경로만, 내용 없이)을 events.jsonl 에 올리고 원본은 logs/ 에. 끝나면 결과 요약을 작업 summary 와 `report` 메시지로, MEMBER.md "지금 작업"을 비운다. headroom 이 켜져 있는데 설치돼 있지 않으면 경고만 하고 `claude` 로 실행 |
| `msg <project> <from> <to> "<내용>" [--kind handoff] [--task T]` | 메시지 남기기 (사람·다른 세션·멤버 공용) |
| `approve request <project> <from> <push\|deploy\|migrate\|send\|delete> "<무엇을>" [--reason] [--scope] [--task]` | 위험 행위 승인 요청 → `<project>/.squad/approvals.jsonl` |
| `approve list\|yes\|no <project> [id] [--reason 사유]` | 승인 대기 보기·결정 (요청한 멤버에게 answer 메시지). `--demo` 면 시연 파일에 |
| `auth status\|set\|clear\|login [runner]` | runner 연결 상태 / 외부 runner 키 넣기(입력이 보이지 않음) / 지우기 / `claude auth login` |
| `log <project> <member> "<내용>" [--status working|idle|blocked]` | 대화형 세션(이 Claude Code 창 등)이 지금 하는 일을 보드에 보고 |
| `task <project> add|done|block <...>` | 작업 직접 다루기 |
| `run-queue <project> [--max 2]` | (v0.4) 의존이 풀린 todo·검수 대기를 골라 담당 경로가 겹치지 않는 멤버끼리 동시에 실행 (9.5) |
| `review <project> <taskId>` | (v0.4) 검수 대기 작업을 검수 멤버가 통과/반려 (9.6) |
| `report <project> [--date] [--ai] [--demo]` | (v0.4) 일일 보고 (9.7) |
| `capture <project> <url> [--member] [--task] [--width] [--height] [--demo]` | (v0.4) headless Chrome/Edge 화면 캡처 (9.8) |
| `inbox <project> [--take]` · `inbox add <project> "<지시>"` · `inbox done <id> "<결과>"` | (v0.4) 데스크톱 세션 다리 (9.9) |
| `board [--port 4777]` | 보드 서버 실행 |

실행 규칙(멤버 프롬프트에 붙는 것): 자기 `owns` 밖 파일은 고치지 않는다 → 필요하면 `node <ai-squad>/bin/squad.mjs msg ... --kind handoff` 로 그 멤버에게 넘긴다 / 끝나면 NOTES.md 인계 3줄 / 커밋은 그 저장소 CLAUDE.md 규칙대로, push 는 하지 않는다(사람·오더 결정) / 비밀값 출력 금지.

## 5. 보드 화면 (`http://localhost:4777`)

**한 화면 배치**(사용자 요청 2026-10-19): 위에서부터 머리(프로젝트·현황 수·탭) → 명령 창 → 탭 내용. 탭 내용은 화면 높이(100vh, 위 머리 제외)를 채우고, 넘치는 목록은 그 칸 안에서만 스크롤한다. 1440×900·1280×720 에서 페이지 스크롤이 없다. 폭 960px 미만이나 높이 560px 미만이면 고정을 풀고 페이지 스크롤로 바꾼다.

- **상단 탭** [스쿼드] [작업] [대화] [보고] — 선택은 주소의 `#squad` / `#tasks` / `#chat` / `#report` 로 남는다(보고는 v0.4, 9.7).
  - **스쿼드**: 연결 보기 / 모니터 보기 전환 단추.
    1. **연결 보기(네트워크)** — 왼쪽 캔버스, 오른쪽 멤버 카드 격자(칸 안 스크롤). 캔버스는 메인 오더를 가운데, 멤버를 둘레에 노드로 둔다. 메시지·인계·지시가 오갈 때마다 보낸 멤버 → 받은 멤버 사이에 흰 선이 이어지고 빛 알갱이가 흐르며, 최근 선은 밝게 남았다가 옅어진다. 일하는 멤버 노드는 맥박처럼 빛나고, 도구를 쓰면 짧은 파동. 노드를 누르면 상세 모달.
    2. **모니터 보기(목록)** — 멤버마다 한 줄: 상태 · 지금 작업 · 마지막 이벤트 · 대기 수. 줄을 펼치면 사용 기술, 담당 경로, 대기 작업, 최근 이벤트 10개, 인계 메모. 상단 필터(상태별, 멤버별).
  - **작업**: 칸반 todo / doing / blocked / done (열마다 칸 안 스크롤). 화면에서 작업 추가·담당·상태 변경(POST API).
  - **대화**: messages.jsonl 시간순 "메인 오더 → 기업 대시보드 · 지시", 종류별 표시. 아래에서 메시지 보내기.
- **픽셀 캐릭터** — 멤버마다 16×16 픽셀 격자를 코드로 정의해 canvas 에 그린다(`server/public/pixel.js`, 외부 이미지 없음). 멤버 id 의 해시로 피부·머리색·머리 모양·옷 색·머리 소품(헤드셋·안경·모자)·넥타이·책상 소품(노트북·서류철·머그·서류)이 고정된다. 상태별 움직임: 일하는 중은 두 손이 번갈아 올라가는 타이핑, 대기는 머리가 한 칸 오르내리는 숨쉬기, 막힘은 머리 위 빨간 느낌표(멈춤). 0.5초마다 프레임을 바꾸고, `prefers-reduced-motion` 이면 움직이지 않는다. 연결 보기 노드·카드·모니터·칸반·대화·모달의 아바타가 모두 이 캐릭터다.
- **멤버 카드** — 캐릭터 + 이름 + 상태 + 맡은 작업(늘 3줄 높이: line-clamp 3 + 고정 높이, 비어도 자리 유지) + 마지막 이벤트 + "사용 기술 n개" 접기 단추(모델·실행·도구·플러그인·스킬·MCP, 기본은 접힘). 일하는 중이면 초록 테두리와 옅은 초록 바탕, 막힘은 빨강 계열, 대기는 기본 색.
- **상세 모달** — 이름이나 작업 내용을 누르면 연다(`<dialog>`). 역할, 지금 작업 전문, 대기 작업, 인계 메모, 최근 이벤트, 담당 경로, 사용 기술, MEMBER.md·NOTES.md 원문(접힘). Esc·바깥 클릭·닫기 단추로 닫히고, 포커스는 모달 안에서만 돈다. 닫으면 연 자리로 포커스가 돌아간다.
- **명령 창 "메인 오더에게 지시"** — 두 단계.
  1. 입력 → `POST /api/order {project, instruction}`: `squad order <project> "<지시>" --dry` 와 같은 계획을 만든다(같은 `lib/runner.mjs` 의 `planOrder`). 저장하지 않고 `{plan: [{member, title, detail, why}]}` 를 돌려주며, 화면은 멤버별 작업 목록으로 보여 준다.
  2. "이대로 배정" → `POST /api/order/confirm {project, instruction, plan}`: 계획을 다시 검증해 작업(tasks.jsonl, createdBy=order)과 지시 메시지(사람 → 오더 1건, 오더 → 멤버 작업마다)로 저장한다.
  - 지시는 1000자 이하, 계획은 20개 이하. 빈 지시는 400, 계획을 만드는 중에 또 보내면 409(서버 전체에 한 건). claude 가 없거나 실패·시간 초과(5분)면 502 와 원인 문구를 화면에 보여 주고, 서버는 계속 돈다.
- **빈 상태** — 시연이 아니고 기록(작업·대화·이벤트)이 없으면 캔버스·칸반·대화에 "아직 기록이 없습니다 — 위 지시 창에 첫 지시를 입력하세요" 를 보여 준다.
- 상단: 프로젝트 선택, 지금 일하는 멤버 수 / 대기 작업 / 막힘, 시연이면 "시연 데이터" 표시.
- 실시간: 서버가 events.jsonl·.squad/*.jsonl·MEMBER.md 변경을 감시(fs.watch + 2초 폴링 대체)해 SSE(`/api/stream`)로 밀어 준다.
- 디자인: 대시보드형, 밝은·어두운 테마 모두, 한국어 UI, 이모지 금지. 네이비 계열(QUGO 와 어울리되 별개 제품).
- 보안: 127.0.0.1 에만 바인딩. 입력은 길이 제한·JSON 검증. 파일 경로는 등록된 프로젝트의 `.squad` 밖으로 못 나가게. claude 호출은 CLI 와 같은 실행 방식(`--dangerously-skip-permissions` 없음).

## 6. QUGO 첫 스쿼드

| id | 이름 | owns (요약) | 비고 |
|---|---|---|---|
| order | 메인 오더 | `.squad/**`, `CLAUDE.md`(루트), 드라이브 HANDOFF | 분배·조율·우선순위, 코드 직접 수정 안 함 |
| site | 사이트·SEO | fe `app/page.tsx`, `app/service/**`, `app/survey/**`, `app/guide/**`, `app/faq/**`, `app/contact/**`, `components/main/**`, `lib/guides/**`, `app/sitemap.ts` | SEO 최우선, 대외 문구 금지어 |
| org-dashboard | 기업 대시보드 | fe `app/organization/**` | PC 전용, 권한 격리 |
| admin-dashboard | 슈퍼어드민·상담센터 | fe `app/admin/**`, `app/counsel/**`, `components/dashboard/**` | 공용 대시보드 부품 소유 |
| survey-report | 문진·결과지 | fe `app/user/**`, `components/survey/**`, `components/report/**`, `lib/report-content/**` | 모바일 전용 문진, A4 결과지, 문구 중앙화 |
| backend | 백엔드 API·DB | `qugo_be_api/src/**`, `prisma/**` | 멀티테넌시·PII 암호화 규칙 |
| biz-docs | 사업 문서(IR·PoC·BM) | fe `docs/business/**`, `scripts/build-business-docs.mjs`, `scripts/build-service-docs.mjs` | BM 범위: KOSHA 근거 + 기업 + 검진기관 |
| ops | 배포·보안 | be `deploy/**`, `docs/MANUAL-DEPLOY.md`, `docs/SECURITY-ROADMAP.md` | 운영 DB 금지, 배포는 사람 확인 후 |

각 MEMBER.md 의 "하지 말 것"에는 해당 저장소 CLAUDE.md 의 절대 규칙 중 그 파트에 걸리는 것만 짧게 옮긴다(전체 복사 금지 — 링크).

## 7. 하지 않는 것

- Claude Code 설정(`~/.claude/settings.json`) 훅 자동 등록 — 사람이 결정. 대신 `run` 이 stream-json 으로 이벤트를 얻고, 대화형 세션은 `squad log` 로 보고한다. 훅 연결 방법은 README 에 "선택"으로 적는다.
- 외부 배포, 계정·사용자 인증, 여러 PC 동기화(나중에 드라이브·클라우드). 보드의 접속 토큰은 "이 컴퓨터의 이 실행"만 확인한다.
- 웹 화면에서 비밀번호·API 키 받기. 로그인은 콘솔 창과 브라우저에서 사람이 직접, 키는 터미널 `auth set` 으로만.
- owns 밖 수정을 되돌리기(감지·경고·막힘 표시만).
- `--dangerously-skip-permissions` 사용.

## 8. v0.3 — 분업·토큰·커뮤니케이션 (2026-10-19)

### 8.1 메인 AI 와 실행기(runner)

- `squad.config.json`(git 포함, 비밀값 없음): `mainAi: {runner, model}`, `runners: {이름: {type, label, ...}}`, `stale: {answerMinutes, idleMinutes}`.
- 어댑터는 `lib/runners/` — `claude.mjs`(Claude Code CLI, 계획은 `--output-format json`, 멤버는 `stream-json`), `command.mjs`(범용 CLI 템플릿 `{"cmd": "some-ai", "args": ["--prompt", "{prompt}"]}`; `{prompt}`·`{model}`·`{cwd}` 를 채우고, `{prompt}` 가 없으면 stdin 으로 보낸다. 셸을 거치지 않는다. 출력은 텍스트 그대로, 사용량은 모름). 같은 모양 `exec({prompt, cwd, mode: plan|member, model, tools, onLine, onTool}) → {code, text, isError, usage}`, `status() → ok|login|unset`.
- 오더(`order`·보드 지시)는 `mainAi`, 멤버(`run`)는 MEMBER.md 의 `runner`. `lib/runner.mjs` 의 `planOrder` · `saveOrder` · `runMember` 를 CLI 와 보드가 같이 쓴다.

### 8.2 로그인·인증 (로컬에만)

- 보드 상단에 runner 별 연결 상태: 연결됨 / 로그인 필요 / 미설정. claude 는 `claude auth status --json`(모델을 부르지 않는 가벼운 확인, 5분 기억)과 마지막 실행 결과로 정한다. 이메일 같은 값은 내보내지 않는다.
- 로그인 필요면 [로그인 창 열기] → 서버가 `cmd /c start "" cmd /k claude auth login` 으로 보이는 콘솔 창을 띄운다. 사람은 그 창과 브라우저에서 직접 로그인한다. 웹 화면은 비밀번호·키를 받지 않는다. 그 뒤 5초마다 상태를 다시 본다(최대 2분).
- 키가 필요한 외부 runner 는 `node bin/squad.mjs auth set <runner>` — 입력이 화면에 보이지 않고, `%APPDATA%\ai-squad\secrets.json`(다른 OS 는 `~/.config/ai-squad/`)에 저장한다. runner 실행 때 `secret` 에 적은 이름의 환경 변수로만 넘긴다. 보드는 "키 설정됨/없음" 만 본다.

### 8.3 권한

- **접속 토큰:** 보드를 띄울 때마다 무작위 토큰을 만들어 `http://localhost:<port>/?t=...` 로 터미널에 찍는다. 첫 방문에 `HttpOnly; SameSite=Strict` 쿠키(`squad_t_<port>` — 쿠키는 포트를 가리지 않아 이름에 포트를 넣음)로 바꾸고 302 로 주소창에서 지운다. `/api/*`(읽기·쓰기·SSE 모두)는 쿠키가 없으면 401. 화면 파일은 토큰 없이도 받아 "터미널의 주소로 다시 여세요" 안내를 띄운다. Host·Origin 검사는 그대로.
- **승인 대기:** 위험 행위(push·배포·DB 마이그레이션·외부 발송·삭제)는 `squad approve request ...` 로 요청만 남긴다(멤버 실행 프롬프트 규칙에 들어 있다). `approvals.jsonl` 은 덧붙이기만(요청 줄 + 결정 줄, 첫 결정만 인정). 보드 "승인 대기" 칸과 확인 모달에서 승인·거절(사유) → 요청한 멤버에게 answer 메시지.
- **맡은 경로 밖 수정 감지:** `run` 전후로 대상 저장소의 `git status --porcelain -z -uall` 을 (상태 + 수정 시각 + 크기) 지문으로 비교한다. 프로젝트 경로가 저장소가 아니면 바로 아래 저장소들(QUGO: `qugo_be_api/`, `qugo_fe_web/`)을 본다. owns + 자기 멤버 폴더 + `.squad/*.jsonl` 밖이 바뀌었으면 작업을 `blocked` 로, 메인 오더에게 경고 메시지. 되돌리지 않는다. ponytail: 같은 저장소를 사람이 동시에 고치면 그것도 잡힌다 — 그럴 때는 경고를 보고 사람이 상태를 바꾼다.

### 8.4 토큰 관리

- claude 의 마지막 result 에서 `usage`(입력·출력·캐시 읽기·캐시 쓰기)와 `total_cost_usd` 를 읽어 작업(`usage`)과 `end`/`plan` 이벤트에 남긴다. 상태 계산이 멤버별 이번 작업·오늘·누적과 프로젝트의 오늘 합계를 낸다.
- 카드: "이번 작업 n토큰"(마우스를 올리면 오늘·누적), 상단: "오늘 토큰"(입력·출력·캐시 내역은 툴팁), 칸반 카드: 작업 토큰.
- 메인 오더 프롬프트에는 멤버 문서 전체가 아니라 `memberDigest`(상태·지금 작업·대기 수·역할 1줄·owns·켜진 플러그인·최근 인계 1줄·주의) 만 넣는다. 줄마다 160자, 멤버마다 520자, 전체 4000자 상한(`squadDigest`, 넘치면 "n명 더"). 시험이 상한을 지킨다.
- 멤버 실행 프롬프트도 MEMBER.md 의 frontmatter 를 빼고 본문만 넣고, 경계(owns·reads)와 "사용할 수 있는 도구"(도구 + 켜진 플러그인만)를 짧게 따로 적는다.

### 8.5 뒤처지거나 동떨어진 파트

- **답 없는 인계:** handoff·question 을 받은 지 `answerMinutes`(기본 30분)가 지났는데 받은 쪽이 그 뒤로 보낸 쪽에게(또는 같은 작업으로) 아무 말도 하지 않았다 → 받은 멤버 카드·모니터 줄·대화 탭에 표시.
- **멈춤:** 할 일(todo)이 있는데 일하는 중이 아니고, 마지막 이벤트와 가장 오래된 할 일 중 늦은 쪽에서 `idleMinutes`(기본 30분)가 지났다 → 카드(점선 테두리)·모니터 줄에 표시.
- 두 가지 모두 메인 오더 요약의 "주의" 줄에 들어가, 오더가 그것부터 푸는 작업을 앞 순서에 둔다. `status` 명령에도 보인다.

### 8.6 확인 모달 (v0.4 에서 오른쪽 확인 패널로 바뀜 — 9.2)

- 사람이 확인해야 하는 것 — 새 승인 요청, "이대로 배정"을 기다리는 계획, 로그인 필요 — 이 SSE 로 들어오면 어느 탭에 있든 모달이 뜬다.
- 요청한 멤버의 캐릭터, 하려는 일, 이유, 영향 범위(요청의 scope, 없으면 그 멤버의 owns)와 [승인] [거절(사유)] [나중에]. 여러 건이면 줄을 세워 하나씩, "남은 확인 n건".
- [나중에]·Esc·바깥 클릭으로 닫아도 상단에 "확인 대기 n" 배지가 남고, 누르면 다시 연다. 다른 탭·브라우저·CLI 에서 처리된 요청은 저절로 사라진다. 탭이 백그라운드면 제목에 "(확인 n)". 소리·알림 권한 팝업 없음.

### 8.7 플러그인·headroom 켜기·끄기

- MEMBER.md `plugins` 는 `이름: true|false` 맵(옛 배열은 모두 켜짐), `headroom: true|false`. 켜진 것만 실행·오더 프롬프트에 들어가고 headroom 은 켜졌을 때만 감싼다.
- 보드의 사용 기술 팝오버·상세 모달·모니터 줄에 스위치. 바꾸면 `POST /api/member/toggle` 이 frontmatter 의 그 값만 고친다(`setFrontmatterValue`·`setFrontmatterFlag`: 다른 줄·주석·본문·줄바꿈 보존, 배열 형식이면 그 키 줄만 맵으로 바꿈). 카드에는 "켜진 기술 n / 전체 m". 시연(`--demo`)에서는 실제 MEMBER.md 대신 `data/demo/<project>/toggles.json` 에 쓴다.

### 8.8 화면 수정

- 사용 기술은 카드 밖에 뜨는 팝오버(고정 위치, 바깥 클릭·Esc 로 닫힘, 화면 밖으로 나가지 않게 보정, 아래가 모자라면 위로). 카드 높이가 바뀌지 않는다.
- 픽셀 캐릭터는 정수 배율만: 카드 48px(3배), 작은 아바타 32px, 모달 64px, 노드 지름 56px 에 캐릭터 48px(오더 72px 에 64px), `image-rendering: pixelated`.
- 동작: 전환 150ms 안팎, 빛 알갱이 동시 30개·파동 12개 상한, 탭이 안 보이면 그리지 않음, 캔버스는 requestAnimationFrame 하나로 움직일 것이 없으면 멈춤. 멤버 12명 이상이거나 "효과 줄이기"(localStorage `squad.lite`)·움직임 줄이기면 가벼운 효과(알갱이 1개, 파동·빛 번짐·맥박·캐릭터 움직임 없음).
- 빈 지시 오류는 "지시를 입력하세요". 검증 문구는 조사 자동 처리 없이 필드마다 완성 문장으로 쓴다.

### 8.9 시연

`scripts/demo-events.mjs` 가 연결 상태(실제 상태), 승인 요청 1건(백엔드의 로컬 DB 마이그레이션 → 확인 모달), 토큰 사용량, 답 없는 인계(사이트 → 사업 문서), 멈춘 멤버(배포·보안)를 만든다. 모두 `data/demo/` 에만 쓴다.

## 9. v0.4 — 예산·의존·검수·보고·캡처·inbox (2026-10-19)

### 9.1 먼저 고친 것

- **확인이 저절로 뜨지 않던 문제.** v0.3 은 상태를 받을 때마다 "새로 들어온 확인"을 고르면서, 모달을 띄우기 전에 그 항목을 "이미 봄"으로 적었다. 그래서 띄우는 쪽(`showModal`)이 실패하거나 그 앞의 연결 그림 그리기가 오류를 내면(`load` 안에서 `net.sync` 뒤에 `syncConfirm` 이 있었다) 첫 승인 대기가 다시는 저절로 열리지 않고 배지만 남았다. 연결 상태를 읽는 쪽(`loadRunners`)은 오류를 조용히 삼켜 원인이 보이지 않았다. 시연 4788 보드에서는 다시 만들지 못했고, 위 경로를 원인으로 보고 구조를 바꿨다.
  - 판단을 순수 함수 `panelDecision({items, seen, open}) → {open, fresh, seen}` 로 뗐다(`server/public/logic.js`, 시험 `server/logic.test.mjs`). 처음 받은 상태에서는 seen 이 비어 모든 항목이 새것이라 닫혀 있어도 펼친다. SSE 로 새 key 가 오면 다시 펼친다.
  - `load` 는 그리기 직후 확인 패널을 먼저 맞추고, 연결 그림은 그 뒤에 `try` 로 감싼다.
- **머리줄 넘침.** 1440·1280 폭에서 한 줄. runner 연결 상태는 "연결 n/m" 칩 하나로 묶고 누르면 팝오버(이름·상태·키 설정 여부·[로그인 창 열기]). 효과 줄이기는 아이콘 단추, 실시간은 점 하나(글자는 화면 읽기용). 머리줄은 `flex-wrap: nowrap`, 통계 칩 묶음만 줄어든다.

### 9.2 확인 패널 (모달 대신)

- 확인할 일(승인 대기 · 예산 확인 · 배정 기다리는 계획 · 로그인 필요)은 화면 오른쪽 340px 패널에 카드로 보인다. 순서는 급한 것 먼저: 승인 → 예산 → 계획 → 로그인(`confirmItems`).
- 패널은 덮지 않고 밀어낸다: `.shell` 이 `main` 과 `aside#side` 를 가로로 둔다. 펼치면 본문이 줄고 연결 보기 캔버스는 `ResizeObserver` 로 다시 그린다. 1280 폭에서 펼쳐도 가로 스크롤이 없다(패널이 열려 있으면 카드 칸 최소 폭을 줄인다).
- 상단 "확인 대기 n" 배지가 패널을 열고 닫는다. 열림 상태는 localStorage `squad.side`(try/catch). 새 확인이 오면 닫혀 있어도 펼치고 새 카드를 150ms 두 번 강조한다. 화면을 가리는 모달은 띄우지 않는다. 백그라운드 탭 제목 "(확인 n)"은 그대로.
- 카드: 캐릭터, 제목, 하려는 일, 이유, 영향 범위, 위험도 칩, [승인] [거절(사유 입력)] 또는 [배정]·[취소], [로그인 창 열기]. 처리하면 사라지고, 다른 곳(CLI·다른 탭)에서 처리된 것도 사라진다. 같은 내용이면 다시 그리지 않아 읽던 상세·쓰던 거절 사유·포커스가 남는다.
- 멤버 상세 모달은 그대로다.

### 9.3 승인 상세

- `approvals.jsonl` 의 요청 줄에 선택 필드: `details`(마크다운 4000자), `files`(경로 100개), `diff`(SQL·git diff, **20KB 이하**, 바이트로 잼), `commands`(명령 10개), `risk`(low·medium·high = 낮음·보통·높음), `rollback`(1000자). 검증은 `validateApprovalDetails`(순수 함수).
- CLI: `approve request ... --details-file 설명.md --diff-file 변경.sql --files a,b --cmd "명령" [--cmd ...] --risk 높음 --rollback "..."`. 멤버 실행 규칙에 "승인 요청 시 details·files·diff(또는 SQL)·commands·rollback 을 채운다"가 들어간다.
- 카드의 [상세 보기]를 누르면 패널 안에서 펼치고 패널이 넓어진다(최대 600px, 화면의 44%). 설명(마크다운), 실행할 명령(고정폭), 파일 목록, diff·SQL(`renderDiff`: 줄 번호, git diff 처럼 보일 때만 +/- 색 — SQL 의 `--` 주석은 지움 줄이 아니다, 고정폭, 칸 안에서만 스크롤, 모든 글자 이스케이프), 되돌리는 방법, 요청한 멤버의 관련 작업(누르면 작업 탭에서 그 카드를 강조).
- 상세를 열지 않고도 승인할 수 있다. 위험도 "높음"이면 상세를 한 번 펼쳐야 [승인]이 켜진다(`canApprove`).

### 9.4 토큰 예산

- `squad.config.json` 의 `budget: {daily, memberDaily, task, warn}` — 하루 전체, 멤버별 하루, 작업당 상한(토큰, 0 은 없음), 경고 비율(기본 0.8). MEMBER.md frontmatter `budget: <토큰>` 이 그 멤버의 하루 상한을 덮어쓴다. 토큰은 보드와 같이 입력·출력·캐시 읽기·캐시 쓰기 합.
- 실행 전 확인(`budgetGate`, 판단은 순수 함수 `checkBudget`): 하루 전체와 그 멤버의 하루 중 비율이 큰 쪽으로 정한다. 80% 이상이면 승인 대기 `action: budget` 을 하나 남기고(이미 대기 중이면 그것), 결정을 기다린다(CLI 는 최대 10분, 보드의 지시 창은 409 를 받고 확인 패널의 예산 카드를 승인하면 지시를 다시 보낸다). 그날 한 번 승인하면 100% 전까지 다시 묻지 않는다. 100% 이상이면 실행하지 않는다(보드는 429).
- `run`·`order`·`run-queue`·`review`·`report --ai`·보드 지시가 이 확인을 거친다.
- 실행 중: claude stream-json 의 assistant 줄마다 붙는 `message.usage` 를 메시지 id 별 마지막 값으로 누적(`usageMeter`)해, 작업 상한을 넘으면 프로세스 트리를 끝내고(Windows 는 `taskkill /T /F`) 작업을 `blocked`, `blockedReason: "예산 초과"`, 요약에 "예산 초과: ..."·오더에게 메모. 그때까지의 사용량을 남긴다.
- 보드: 상단 토큰 칩에 오늘 사용량/상한 막대(80% 노랑, 100% 빨강), 멤버 카드에 그 멤버의 오늘 사용률 막대(상한이 없으면 이번 작업 토큰).

### 9.5 작업 의존과 대기열

- 작업에 `dependsOn: [taskId]`(10개 이하). `task add ... --after T-a,T-b`. 메인 오더 계획 JSON 은 항목마다 `key` 와 `dependsOn: [key]` 를 낼 수 있고, `cleanDeps` 가 모르는 key·자기 자신을 빼며, `validatePlan` 이 고리를 거부한다. 저장할 때 key 를 새 작업 id 로 바꾼다.
- `squad run-queue <project> [--max 2]`: `pickRunnable`(순수 함수)이 검수 대기(검수 멤버가)와 선행이 모두 끝난 todo 를 step·생성 순으로 고른다. 한 멤버는 한 번에 하나, 담당 경로가 지금 도는 멤버와 겹치면(`ownsOverlap`: glob 고정 부분 앞부분 비교, 보수적) 기다린다. 동시 실행 수 기본 2(1~8). 하나가 끝날 때마다 다시 고른다. 한 작업은 한 번 실행에서 두 번까지만(반려가 되풀이되면 멈춤), 예산 100% 면 새로 시작하지 않는다.
- 동시에 돌 때 맡은 경로 밖 감시: 그 작업이 도는 동안 같이 돈 멤버의 owns 와 그 멤버 폴더는 이 멤버 탓으로 보지 않는다.
- 보드 칸반 카드: "선행: <제목들>"(끝난 것은 줄 긋기), 선행이 남으면 자물쇠 아이콘과 점선 테두리. `squad run` 도 선행이 남은 작업은 실행하지 않는다.

### 9.6 검수(review)

- MEMBER.md `reviewer: <memberId>` 가 있거나 config `review.default` 가 있으면(자기 자신 제외) 작업이 끝났을 때 done 대신 `review` 로 두고, 담당 → 검수 멤버 handoff 메시지를 남긴다. 실행 전 HEAD 와 지금을 비교해 이 멤버 owns 안의 바뀐 파일·줄 수(`diffStat`, `.squad` 기록 파일 제외)를 작업에 남긴다.
- 검수 멤버 실행(`squad review <project> <taskId>`, `run-queue`, 또는 할 일이 없는 검수 멤버의 `squad run`)은 파일을 열지 않고 diff 요약(파일 목록과 줄 수, `review.maxFiles` 기본 30개 상한, `summarizeDiff`)과 작업 요약만 받아 `{"verdict": "pass"|"reject", "note"}` 를 낸다(`parseVerdict`, 못 읽으면 반려). 통과 → done, 반려 → 원래 멤버에게 handoff(사유)와 todo, `reviewNote`.
- 칸반에 "검수" 칸(할 일 · 진행 중 · 검수 · 막힘 · 완료).

### 9.7 일일 보고

- `squad report <project> [--date YYYY-MM-DD] [--ai] [--demo]`: `buildReport`(순수 함수)가 그날의 작업·메시지·승인·토큰으로 한 장을 만든다 — 한 일, 막힌 일(막힌 작업 + 승인 대기), 내일 할 일(todo·검수·진행 중, 선행 대기 표시), 토큰(합·상한 비율·멤버 상위 5), 커뮤니케이션(메시지 종류별, 승인 결정). 목록은 15개 상한.
- `--ai` 는 예산 확인을 거쳐 메인 AI 에게 같은 구조로 문장만 다듬게 한다. 실패하면 규칙 기반 보고를 쓴다.
- `<project>/.squad/reports/YYYY-MM-DD.md` 에 쓴다(시연은 `data/demo/<project>/reports/`). config `report.copyTo` 가 있으면 `<copyTo>/<project>-<날짜>.md` 로도 복사한다. 기본은 비어 있다.
- 보드 "보고" 탭(`#report`): 날짜 고르기, 렌더한 보고, [오늘 보고 만들기](규칙 기반, `POST /api/report`).

### 9.8 화면 캡처

- `squad capture <project> <url> [--member id] [--task T-..] [--width 1440] [--height 900] [--demo]`: 시스템에 설치된 Chrome/Edge(`SQUAD_CHROME` 로 경로 지정 가능)를 `--headless=new --remote-debugging-port=0` 과 임시 프로필로 띄우고, DevTools 프로토콜을 Node 22 표준 `WebSocket` 으로 직접 다룬다(Target.createTarget → attach → Emulation.setDeviceMetricsOverride → Page.navigate → loadEventFired + 1.2초 → Page.captureScreenshot). 추가 패키지 없음. 못 찾으면 "Chrome 이나 Edge 를 찾지 못했습니다 ..." 오류.
- PNG 는 `data/captures/<project>-<member|human>-<YYYYMMDD-HHMMSS>.png`(git 제외). 작업에 `attachments`, 메시지(멤버 → 오더 메모)에 첨부를 남긴다. 메시지에 남기는 주소에서 보드 접속 토큰(`t=`)은 지운다.
- 보드는 `GET /api/capture?name=` 으로 정해진 이름 모양만 내준다(접속 토큰 필요). 칸반 카드·대화·멤버 상세에 썸네일, 누르면 새 탭에 원본.

### 9.9 대화형 세션 다리(inbox)

- 지시 창에서 받는 사람을 "메인 AI(자동)" 또는 "데스크톱 Claude 세션"으로 고른다(localStorage `squad.orderTo`). 데스크톱이면 `POST /api/inbox` → `<project>/.squad/inbox.jsonl`(시연은 `data/demo/<project>/inbox.jsonl`), 덧붙이기만.
- 상태: 대기(pending) → 처리 중(taking) → 끝(done). 거꾸로 가거나 건너뛰는 줄은 무시한다(`inboxStep`·`foldInbox`, 순수 함수).
- 데스크톱 세션: `squad inbox <project> --take`(가장 오래된 대기를 처리 중으로 바꾸고 내용을 출력), `squad inbox done <id> "<결과>" [--project p]`, 목록은 `squad inbox <project>`, 넣기는 `squad inbox add <project> "<지시>"`.
- 보드: 지시 창 오른쪽 "데스크톱 n" 칩(대기 수, 처리 중이 있으면 함께), 누르면 최근 20건의 상태·결과. Claude 설정 훅은 쓰지 않는다.

### 9.10 시연

`scripts/demo-events.mjs` 가 v0.3 시연에 더해 만든다: 오늘 사용량을 하루 상한의 82% 쯤으로(시연 값) + 메인 오더의 예산 확인 카드, 선행이 남은 작업(대시보드 부서 범주 필터 ← 백엔드 집계 API), 검수 대기 작업과 검수 통과, 상세(시연용 예시 SQL·파일·명령·되돌리기, 위험 높음)가 붙은 DB 마이그레이션 승인 요청, 오늘 보고(`data/demo/<project>/reports/`, "시연 데이터로 만든 보고" 표시), 데스크톱 inbox 대기 1·끝 1. 모두 `data/demo/` 에만 쓰고 상세·보고에 "시연" 표시를 남긴다.
