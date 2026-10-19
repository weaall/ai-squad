# AI Squad

AI 에이전트를 직원처럼 파트별로 나눠 일을 맡기고, 누가 무엇을 하는지와 서로 주고받는 말을 한 화면에서 보는 코워커 관리 시스템입니다. 설계는 [`docs/SPEC.md`](docs/SPEC.md), 메인 오더 운영 규칙은 [`ORDER.md`](ORDER.md)에 있습니다.

- Node 22 표준 모듈만 씁니다. `npm install` 이 필요 없습니다.
- v0.3: 메인 AI·실행기(runner) 설정, 접속 토큰, 승인 대기, 맡은 경로 밖 수정 감지, 토큰 사용량, 답 없는 인계·멈춤 표시, 확인 모달, 플러그인 켜기·끄기. 자세한 것은 [SPEC 8절](docs/SPEC.md#8-v03--분업토큰커뮤니케이션-2026-10-19).
- v0.4: 토큰 예산 상한, 작업 의존과 대기열(`run-queue`), 검수 멤버, 일일 보고, 화면 캡처(headless Chrome/Edge), 데스크톱 세션 inbox, 확인 모달 대신 오른쪽 확인 패널(승인 상세 포함), 한 줄 머리줄. 자세한 것은 [SPEC 9절](docs/SPEC.md#9-v04--예산의존검수보고캡처inbox-2026-10-19).
- 첫 적용 프로젝트는 QUGO(`C:\Users\weaal\qugo\.squad`)입니다. 멤버 8명: order, site, org-dashboard, admin-dashboard, survey-report, backend, biz-docs, ops.

## 빠른 시작

```powershell
cd C:\Users\weaal\ai-squad
npm test                                  # node --test
node bin/squad.mjs status qugo            # 멤버별 상태 표
node bin/squad.mjs board                  # 보드: 터미널에 찍힌 http://localhost:4777/?t=... 로 연다
node bin/squad.mjs auth status            # 실행기(runner) 연결 상태
```

보드 주소의 `?t=...` 는 실행할 때마다 바뀌는 접속 토큰입니다. 첫 방문에 쿠키로 바뀌고 주소창에서 지워집니다. 토큰 없이 열면 "터미널에 찍힌 주소로 다시 여세요" 가 뜹니다.

`npm link` 를 하면 `squad <명령>` 으로 줄여 쓸 수 있습니다.

## 명령

| 명령 | 하는 일 |
|---|---|
| `init <project> <path> [--name 이름]` | `.squad/` 뼈대와 `projects.json` 항목 만들기 (있는 파일은 건드리지 않음) |
| `status [project]` | 멤버별 상태·지금 작업·대기 작업·마지막 이벤트 |
| `order <project> "<지시>" [--dry] [--auto] [--headroom]` | 메인 AI(`squad.config.json` 의 `mainAi`)가 계획과 실행 순서(step)를 만들고, **터미널에서 y 로 승인해야** 배정. `--dry` 는 계획만, `--auto` 는 배정 뒤 한 번 더 승인하면 순서대로 실행 |
| `run <project> <member> [taskId] [--headroom]` | 멤버의 가장 오래된 todo(또는 지정 작업)를 그 멤버의 runner 로 실행. 도구 사용은 이름·경로만 이벤트로, 원본은 `logs/` 에. 끝나면 사용량을 남기고, 맡은 경로 밖을 고쳤으면 막힘 + 오더에게 경고 |
| `approve request <project> <from> <push\|deploy\|migrate\|send\|delete> "<무엇을>" [--reason ..] [--scope ..] [--task T-..]` | 위험 행위 승인 요청. 보드의 확인 패널에 카드가 뜬다. v0.4 상세: `--details-file 설명.md --diff-file 변경.sql --files a,b --cmd "명령" --risk 낮음\|보통\|높음 --rollback "..."` |
| `approve list\|yes\|no <project> [id] [--reason 사유]` | 승인 대기 보기·결정 |
| `auth status` / `auth set <runner>` / `auth clear <runner>` / `auth login` | 연결 상태 / 외부 AI 키 넣기(입력이 안 보임, `%APPDATA%\ai-squad\secrets.json`) / 지우기 / claude 로그인 |
| `msg <project> <from> <to> "<내용>" [--kind handoff] [--task T-..]` | 메시지 남기기. from/to 는 멤버 id 또는 `human` |
| `log <project> <member> "<내용>" [--status working\|idle\|blocked]` | 대화형 세션이 지금 하는 일을 보드에 보고 |
| `task add <project> <member> "<제목>" [--detail ..]` | 작업 추가 |
| `task done\|block <project> <taskId> [--summary ..\|--reason ..]` | 작업 끝내기·막힘 표시 |
| `task add <project> <member> "<제목>" --after T-a,T-b` | (v0.4) 선행 작업을 붙여 추가 — 선행이 끝나야 실행된다 |
| `run-queue <project> [--max 2]` | (v0.4) 선행이 풀린 할 일과 검수 대기를 골라, 담당 경로가 겹치지 않는 멤버끼리 동시에 실행 |
| `review <project> <taskId>` | (v0.4) 검수 대기 작업을 검수 멤버가 diff 요약만 보고 통과/반려 |
| `report <project> [--date YYYY-MM-DD] [--ai]` | (v0.4) 일일 보고 → `<project>/.squad/reports/<날짜>.md` (`--ai`: 메인 AI 로 문장 다듬기) |
| `capture <project> <url> [--member id] [--task T-..] [--width 1440] [--height 900]` | (v0.4) 설치된 Chrome/Edge 로 화면을 찍어 `data/captures/` 에 두고 작업·메시지에 첨부 |
| `inbox <project> [--take]` / `inbox add <project> "<지시>"` / `inbox done <id> "<결과>"` | (v0.4) 보드에서 "데스크톱 Claude 세션"으로 보낸 지시를 대화형 세션이 가져가고 끝내기 |
| `board [--port 4777] [--demo]` | 보드 서버 (127.0.0.1 에만 묶음) |

### Headroom (선택)

`run`·`order` 는 기본으로 `claude` 를 바로 실행합니다. 토큰을 줄이고 싶으면 `--headroom` 을 주거나 MEMBER.md frontmatter 에 `headroom: true` 를 두세요. 그러면 `headroom wrap claude -- ...` 로 감쌉니다. 켜져 있는데 headroom 이 설치돼 있지 않으면 경고만 하고 `claude` 로 실행합니다.

## 토큰 예산 (v0.4)

`squad.config.json` 의 `budget` 으로 하루 전체(`daily`), 멤버별 하루(`memberDaily`), 작업당(`task`) 토큰 상한을 둡니다(0 은 상한 없음). MEMBER.md frontmatter 에 `budget: 300000` 을 쓰면 그 멤버의 하루 상한을 덮어씁니다.

- `run`·`order`·`run-queue`·`review`·`report --ai`·보드 지시는 실행 전에 남은 예산을 봅니다. 80% 를 넘으면 승인 대기(예산 확인)를 남기고 보드 확인 패널이나 `approve yes` 결정을 기다립니다. 그날 한 번 승인하면 100% 전까지는 다시 묻지 않습니다. 100% 를 넘으면 실행하지 않습니다.
- 실행 중 누적 토큰이 작업 상한을 넘으면 프로세스를 끝내고 작업을 막힘(사유 "예산 초과")으로 둡니다.
- 보드 상단 토큰 칩에 오늘 사용량/상한 막대, 멤버 카드에 그 멤버의 오늘 사용률이 보입니다.

## 검수·의존·보고 (v0.4)

- **의존**: 계획 JSON 의 `dependsOn`(같은 계획 안의 key)이나 `task add --after` 로 선행 작업을 붙입니다. 칸반 카드에 "선행: ..." 와 자물쇠가 보이고, `run`·`run-queue` 는 선행이 끝난 것만 실행합니다.
- **검수**: MEMBER.md 에 `reviewer: <멤버id>` 를 두거나 config `review.default` 를 정하면, 끝난 작업이 "검수" 칸으로 갑니다. 검수 멤버는 바뀐 파일 목록·줄 수와 작업 요약만 보고 통과(완료)나 반려(담당에게 인계, 할 일로 되돌림)를 냅니다.
- **보고**: `squad report` 가 한 일·막힌 일·내일 할 일·토큰을 한 장으로 씁니다. config `report.copyTo` 에 폴더(예: 드라이브 HANDOFF 폴더)를 적으면 거기에도 복사합니다(기본은 비어 있음). 보드 "보고" 탭에서 날짜별로 보고 [오늘 보고 만들기]로 바로 만들 수 있습니다.

## 화면 캡처 (v0.4)

`squad capture` 는 시스템에 설치된 Chrome 이나 Edge 를 headless 로 띄워 DevTools 프로토콜을 Node 표준 WebSocket 으로 다룹니다(추가 패키지 없음). 브라우저를 못 찾으면 오류를 내고, `SQUAD_CHROME` 환경 변수로 경로를 줄 수 있습니다. 보드 주소를 찍을 때는 터미널에 찍힌 `?t=...` 주소를 그대로 넘기면 됩니다(메시지에 남는 주소에서 토큰은 지웁니다). 칸반 카드·대화·멤버 상세에 썸네일이 보입니다.

## 데스크톱 Claude 세션 (v0.4)

보드 지시 창에서 받는 사람을 "데스크톱 Claude 세션"으로 바꾸면 지시가 `<project>/.squad/inbox.jsonl` 에 쌓입니다. 대화형 세션은 이렇게 처리합니다. Claude 설정 훅은 쓰지 않습니다.

```powershell
node bin/squad.mjs inbox qugo --take                  # 가장 오래된 대기 지시를 가져오고 "처리 중"으로
node bin/squad.mjs inbox done I-... "여백 12mm 로 맞춤"   # 끝 표시와 결과
```

## 다른 AI 붙이기

`squad.config.json` 의 `runners` 에 넣고, 멤버 MEMBER.md 의 `runner:` 를 그 이름으로 바꿉니다. 메인 오더를 바꾸려면 `mainAi.runner` 를 바꿉니다.

```json
"startup-ai": { "type": "command", "label": "모두의창업 지원 솔루션", "cmd": "startup-ai", "args": ["--prompt", "{prompt}"], "secret": "STARTUP_AI_KEY" }
```

- `{prompt}`·`{model}`·`{cwd}` 를 채워 셸 없이 실행합니다. `{prompt}` 가 없으면 프롬프트를 stdin 으로 보냅니다. 출력은 텍스트 그대로 받습니다.
- `secret` 이 있으면 `node bin/squad.mjs auth set startup-ai` 로 키를 넣으세요. 실행할 때 그 이름의 환경 변수로만 넘깁니다. 웹 화면은 키를 받지 않습니다.
- 지금 들어 있는 `startup-ai` 는 예시라 보드에 "미설정" 으로 보입니다.

## 보드

`http://localhost:4777` — 어두운 테마가 기본이고 오른쪽 위 단추로 밝은 테마로 바꿀 수 있습니다. 화면 높이에 맞춘 한 화면 배치라 1440×900·1280×720 에서 페이지 스크롤이 없고, 긴 목록은 그 칸 안에서만 스크롤됩니다.

- **명령 창 "지시"**: 받는 사람을 "메인 AI(자동)" 또는 "데스크톱 Claude 세션"으로 고릅니다. 데스크톱으로 보낸 지시는 오른쪽 "데스크톱 n" 칩에서 상태를 봅니다. 메인 AI 는 지시를 쓰고 "계획 만들기"를 누르면 서버가 `squad order <project> "<지시>" --dry` 와 같은 계획을 받아 멤버별 작업 목록으로 보여 줍니다. "이대로 배정"을 눌러야 작업과 지시 메시지로 저장됩니다. 한 번에 한 건만 돌고(진행 중이면 409), claude 가 없거나 실패하면 원인 문구가 뜹니다.
- **상단 탭** [스쿼드] [작업] [대화] [보고] — 주소의 `#squad` / `#tasks` / `#chat` / `#report` 로 남습니다.
  - **스쿼드 · 연결 보기**: 왼쪽 캔버스(메인 오더를 가운데, 멤버를 둘레에 두고 메시지가 오갈 때마다 선과 빛 알갱이가 흐름), 오른쪽 멤버 카드.
  - **스쿼드 · 모니터 보기**: 멤버마다 한 줄(상태·지금 작업·마지막 이벤트·대기 수), 펼치면 사용 기술·담당 경로·대기 작업·최근 이벤트·인계 메모. 상태·멤버 필터.
  - **작업**: 칸반 할 일 · 진행 중 · 검수 · 막힘 · 완료(추가·담당·상태 변경, 선행·잠금·캡처 썸네일). **대화**: 대화 줄과 메시지 보내기. **보고**: 날짜별 일일 보고.
- **픽셀 캐릭터**: 멤버 id 로 정해지는 16×16 픽셀 캐릭터(옷 색·머리·헤드셋·안경·모자·노트북·서류철 등)를 코드로 그립니다. 일하는 중은 타이핑, 대기는 숨쉬기, 막힘은 머리 위 느낌표. 움직임 줄이기 설정이면 멈춥니다.
- **멤버 카드**: 맡은 작업은 늘 3줄 높이, 일하는 중은 초록·막힘은 빨강 테두리와 바탕, 멈춤은 점선. "멈춤"·"답 없는 인계 n" 표시와 "이번 작업 n토큰". "켜진 기술 n / 전체 m" 을 누르면 카드 밖에 팝오버가 떠서 플러그인·headroom 을 켜고 끕니다(MEMBER.md frontmatter 의 그 값만 바뀜).
- **상단(한 줄)**: 일하는 중·대기·막힘, 오늘 토큰과 상한 막대, 탭, "확인 대기 n" 배지, "연결 n/m" 칩(누르면 실행기별 연결됨 / 로그인 필요 / 미설정과 [로그인 창 열기] — 새 콘솔 창과 브라우저에서 직접 로그인), 효과 줄이기·테마 아이콘, 실시간 점.
- **확인 패널(오른쪽)**: 승인 요청·예산 확인·배정 기다리는 계획·로그인 필요를 급한 순서(승인 → 예산 → 계획 → 로그인)로 카드에 보여 줍니다. 덮지 않고 본문을 밀어냅니다. 새 확인이 오면 닫혀 있어도 펼치고 그 카드를 잠깐 강조합니다(모달은 띄우지 않음). [상세 보기]로 설명·실행할 명령·파일·diff/SQL(줄 번호와 +/- 색)·되돌리는 방법·관련 작업을 봅니다. 위험도 "높음"은 상세를 한 번 펼쳐야 [승인]이 켜집니다. 다른 곳에서 처리하면 저절로 사라지고, 탭이 뒤에 있으면 제목에 "(확인 n)". 배지로 열고 닫으며 열림 상태는 기억합니다.
- **상세 모달**: 이름이나 작업 내용을 누르면 역할·지금 작업 전문·대기 작업·인계 메모·최근 이벤트·담당 경로·사용 기술을 봅니다. Esc·바깥 클릭·닫기 단추로 닫힙니다.
- 기록이 하나도 없으면 "아직 기록이 없습니다 — 위 지시 창에 첫 지시를 입력하세요" 가 보입니다.
- 서버가 `.squad/*.jsonl`, `MEMBER.md`, `data/events.jsonl` 을 감시(fs.watch + 2초 폴링)해 SSE `/api/stream` 으로 밀어 줍니다.

## 시연

> **시연 데이터는 실제 기록이 아닙니다.** 처음 보드를 열었을 때 화면이 비어 보이지 않도록 만든 가짜 기록입니다.

```powershell
node bin/squad.mjs board --demo           # 창 1: 시연 데이터 파일로 보드 열기 (상단에 "시연 데이터" 표시)
node scripts/demo-events.mjs qugo         # 창 2: 2.5초마다 시연 메시지·이벤트 보내기 (Ctrl+C 로 멈춤)
node scripts/demo-events.mjs qugo --interval 1000 --count 30   # 빠르게, 30번만
node scripts/demo-events.mjs qugo --reset                      # 시연 데이터 지우기
```

v0.4 시연은 예산 경고(오늘 사용량을 상한의 82% 쯤으로 + 예산 확인 카드), 선행이 남은 작업, 검수 칸, 오늘 보고, 데스크톱 inbox, 상세(예시 SQL·파일·명령·되돌리기)가 붙은 DB 마이그레이션 승인 요청도 보여 줍니다. 상세와 보고에는 "시연" 표시가 붙습니다.

시연 기록은 `data/demo/` 아래 별도 파일(`events.jsonl`, `<project>/tasks.jsonl`, `<project>/messages.jsonl`)에만 쓰이고 모든 줄에 `"demo": true` 가 붙습니다. 실제 기록(`<프로젝트>/.squad/*.jsonl`, `data/events.jsonl`)과 섞이지 않으며, `--demo` 로 연 보드에서 보낸 메시지·작업도 시연 파일로 갑니다. 멤버 문서는 실제 `.squad` 것을 보여 줍니다.

## 저장 구조

```
ai-squad/
  ORDER.md  projects.json  bin/squad.mjs
  lib/            순수 함수(md·state·validate·claude·owns) + 저장소(store) + 설정(config) + 승인(approvals) + 키(secrets)
                  + 오더 계획·멤버 실행(runner) + runners/(claude·command 어댑터) + *.test.mjs
  squad.config.json  메인 AI·runner 목록 (비밀값 없음)
  server/         index.mjs(보드 서버) + public/(index.html·app.js·style.css·pixel.js 픽셀 캐릭터)
  scripts/        demo-events.mjs(시연)
  data/           events.jsonl, demo/, captures/ — git 제외
  logs/           <project>/<member>/<taskId>.log — git 제외
<프로젝트>/.squad/
  SQUAD.md  tasks.jsonl  messages.jsonl  approvals.jsonl  inbox.jsonl  reports/<날짜>.md  members/<id>/MEMBER.md·NOTES.md
```

## Claude Code 훅 연결 (선택)

AI Squad 는 `~/.claude/settings.json` 을 고치지 않습니다. 대화형 세션의 도구 사용도 보드에 올리고 싶다면 사람이 직접 PostToolUse 훅에 다음과 같은 명령을 걸 수 있습니다.

```
node C:\Users\weaal\ai-squad\bin\squad.mjs log qugo <member> "작업 중" --status working
```

훅 없이도 `run` 은 stream-json 으로 이벤트를 얻고, 대화형 세션은 `squad log` 로 직접 보고하면 됩니다.

## 보안

- 보드는 `127.0.0.1` 에만 묶고, Host·Origin 이 로컬이 아니면 거부합니다(DNS 리바인딩·CSRF 방지). POST 는 `application/json` 만, 본문 16KB·필드 길이 제한.
- `/api/*`(SSE 포함)는 실행마다 바뀌는 접속 토큰 쿠키(HttpOnly, SameSite=Strict)가 없으면 401 입니다.
- 웹 화면은 비밀번호·키를 받지 않습니다. 외부 AI 키는 터미널 `auth set` 으로만, 사용자 프로필 아래에 저장합니다.
- 위험 행위(push·배포·DB 마이그레이션·외부 발송·삭제)는 멤버가 직접 하지 않고 승인을 요청합니다. `run` 은 맡은 경로 밖 수정을 감지해 막힘으로 바꿉니다(되돌리지 않음).
- 멤버 파일은 등록된 프로젝트의 `.squad/members/<id>/` 안의 MEMBER.md·NOTES.md 만 읽습니다.
- 이벤트에는 도구 이름과 파일 경로만 남기고 내용·명령은 남기지 않습니다.
- `--dangerously-skip-permissions` 는 쓰지 않습니다. 멤버 실행은 `--permission-mode acceptEdits` + `--allowedTools`.
