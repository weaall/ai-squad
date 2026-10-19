# AI Squad — 설계 (v0.1, 2026-10-19)

AI 에이전트를 "직원"처럼 파트별로 나눠 일을 맡기고, 누가 무엇을 하는지·서로 무슨 말을 주고받는지를 한 화면에서 보는 코워커 관리 시스템. 첫 적용 프로젝트는 QUGO(`C:\Users\weaal\qugo`).

## 1. 원칙

1. **메인 오더(Main Order)** 가 지시를 받아 파트(스쿼드 멤버)에게 나눠 준다. 파트가 잘 나뉘면 멤버마다 맥락이 좁게 유지돼 전문성이 높아지고 토큰이 준다. 그래서 메인 오더의 문서(`ORDER.md`)와 각 멤버 문서(`MEMBER.md`) 관리가 핵심이다.
2. 스쿼드는 화면 단위(메인 페이지·대시보드·문진)만이 아니라 IR·PoC 같은 사업 문서 파트도 포함하는, 프로젝트마다 전형적이지만 전문적인 구성이다.
3. **커뮤니케이션이 가장 중요하다.** 지시·인계·질문·완료 보고가 모두 메시지로 남고 보드에 보인다.
4. 멤버마다 쓰는 AI(모델)·플러그인·스킬·MCP·도구가 문서에 적혀 있어야 하고, 메인 오더는 그것을 보고 일을 배정한다. 지금은 Claude(Claude Code CLI)만 쓰고, 나중에 다른 AI 에이전트(예: 모두의창업 지원 솔루션)를 멤버로 붙인다 → 멤버의 `runner` 값으로 구분한다.
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
  logs/<project>/<member>/<taskId>.log   # 멤버 실행 원본 로그 (git 제외)
  docs/SPEC.md

<프로젝트>\.squad\                       # 예: C:\Users\weaal\qugo\.squad
  SQUAD.md                               # 프로젝트 개요, 멤버 목록·경계, 공용 규칙 링크(각 저장소 CLAUDE.md)
  tasks.jsonl                            # 작업: {id, title, detail, member, status: todo|doing|done|blocked, createdBy, createdAt, updatedAt, summary}
  messages.jsonl                         # 대화: {id, at, from, to, kind: order|handoff|question|answer|report|note, taskId?, text}
  members\<id>\MEMBER.md                 # 멤버 문서 (아래 형식)
  members\<id>\NOTES.md                  # 멤버가 스스로 남기는 작업 메모·인계 (짧게 유지)
```

## 3. MEMBER.md 형식

```markdown
---
id: org-dashboard
name: 기업 대시보드
emoji: (쓰지 않음 — 이모지 금지. 화면은 이니셜 아바타)
runner: claude            # claude | external (사람이 붙인 다른 AI — CLI 가 실행하지 않고 보드에만 표시)
model: claude-opus-5-5    # claude -p --model 값 (비우면 기본)
owns:                     # 이 멤버가 고치는 경로 — 다른 멤버는 손대지 않는다
  - qugo_fe_web/app/organization/**
reads:                    # 참고만 하는 경로
  - qugo_fe_web/CLAUDE.md
tools:                    # claude -p --allowedTools 로 넘길 도구 (없으면 기본 Read·Edit·Write·Glob·Grep)
  - Read
  - Edit
  - "Bash(npx tsc *)"
plugins: [design:design-critique]   # 쓰는 플러그인·스킬·MCP 이름 (보드 표시 + 오더가 배정할 때 참고)
initials: OD              # 아바타 이니셜 (비우면 id 에서 만든다)
headroom: false           # true 면 run 이 headroom wrap claude 로 감싼다 (선택)
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
| `order <project> "<지시>" [--dry] [--headroom]` | 메인 오더 실행: ORDER.md + SQUAD.md + 멤버 frontmatter 요약(본문 전체가 아님 — 토큰 절약)을 넣어 `claude -p --output-format json` 으로 계획(JSON: `[{member, title, detail, why}]`)을 받고, 작업을 tasks.jsonl 에, 지시 메시지를 messages.jsonl 에 남긴다. `--dry` 는 계획만 출력 |
| `run <project> <member> [taskId] [--headroom]` | 그 멤버의 가장 오래된 todo(또는 지정 작업)를 실행: 프롬프트 = MEMBER.md + NOTES.md + 작업 + 실행 규칙. `claude -p <프롬프트> --output-format stream-json --verbose --permission-mode acceptEdits --allowedTools ...` 를 프로젝트 경로에서 띄우고(`--headroom` 이나 MEMBER.md `headroom: true` 면 `headroom wrap claude -- ...` 로 감싼다), stream-json 을 읽어 도구 사용(도구 이름·파일 경로만, 내용 없이)을 events.jsonl 에 올리고 원본은 logs/ 에. 끝나면 결과 요약을 작업 summary 와 `report` 메시지로, MEMBER.md "지금 작업"을 비운다. headroom 이 켜져 있는데 설치돼 있지 않으면 경고만 하고 `claude` 로 실행 |
| `msg <project> <from> <to> "<내용>" [--kind handoff] [--task T]` | 메시지 남기기 (사람·다른 세션·멤버 공용) |
| `log <project> <member> "<내용>" [--status working|idle|blocked]` | 대화형 세션(이 Claude Code 창 등)이 지금 하는 일을 보드에 보고 |
| `task <project> add|done|block <...>` | 작업 직접 다루기 |
| `board [--port 4777]` | 보드 서버 실행 |

실행 규칙(멤버 프롬프트에 붙는 것): 자기 `owns` 밖 파일은 고치지 않는다 → 필요하면 `node <ai-squad>/bin/squad.mjs msg ... --kind handoff` 로 그 멤버에게 넘긴다 / 끝나면 NOTES.md 인계 3줄 / 커밋은 그 저장소 CLAUDE.md 규칙대로, push 는 하지 않는다(사람·오더 결정) / 비밀값 출력 금지.

## 5. 보드 화면 (`http://localhost:4777`)

**한 화면 배치**(사용자 요청 2026-10-19): 위에서부터 머리(프로젝트·현황 수·탭) → 명령 창 → 탭 내용. 탭 내용은 화면 높이(100vh, 위 머리 제외)를 채우고, 넘치는 목록은 그 칸 안에서만 스크롤한다. 1440×900·1280×720 에서 페이지 스크롤이 없다. 폭 960px 미만이나 높이 560px 미만이면 고정을 풀고 페이지 스크롤로 바꾼다.

- **상단 탭** [스쿼드] [작업] [대화] — 선택은 주소의 `#squad` / `#tasks` / `#chat` 으로 남는다.
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

## 7. 하지 않는 것 (v0.1)

- Claude Code 설정(`~/.claude/settings.json`) 훅 자동 등록 — 사람이 결정. 대신 `run` 이 stream-json 으로 이벤트를 얻고, 대화형 세션은 `squad log` 로 보고한다. 훅 연결 방법은 README 에 "선택"으로 적는다.
- 외부 배포, 인증, 여러 PC 동기화(나중에 드라이브·클라우드).
- `--dangerously-skip-permissions` 사용.
