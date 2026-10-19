너는 AI Squad 저장소(C:\Users\weaal\ai-squad)를 처음부터 구현하는 개발자다. 답과 문서·주석·커밋 메시지는 한국어로 쓴다.

1. `docs/SPEC.md`를 끝까지 읽고 v0.1을 구현한다: ORDER.md, projects.json, bin/squad.mjs(CLI 전 명령), lib/*(순수 함수 + node:test 테스트), server/(보드 서버 + 정적 화면 index.html·app.js·style.css), README.md, .gitignore(data/, logs/ 제외), package.json(의존성 없음, "test": "node --test", "board": "node bin/squad.mjs board").
2. Node 22 표준 모듈만 쓴다. npm 패키지를 설치하지 않는다. puppeteer·playwright 금지.
3. QUGO 스쿼드를 만든다: `node bin/squad.mjs init qugo C:\Users\weaal\qugo` 로 뼈대를 만들고 SPEC 6절 표대로 C:\Users\weaal\qugo\.squad\SQUAD.md 와 members\<id>\MEMBER.md 8개(order, site, org-dashboard, admin-dashboard, survey-report, backend, biz-docs, ops)를 채운다. 각 멤버의 "하지 말 것"은 C:\Users\weaal\qugo\qugo_fe_web\CLAUDE.md·qugo_be_api\CLAUDE.md 에서 그 파트에 걸리는 절대 규칙만 2~5줄로 옮기고 원문 위치를 적는다. plugins 에는 이 PC에서 실제 쓰는 것만(예: design 계열 스킬, dataviz, artifact-design, Claude_Browser 내장 브라우저, headroom MCP). QUGO 저장소 안의 코드는 한 줄도 고치지 않는다. .squad 폴더만 만든다.
4. 테스트: `node --test` 통과. 보드 서버를 잠깐 띄워 `/api/state?project=qugo` 가 멤버 8명을 돌려주는지, SSE `/api/stream` 이 이벤트를 밀어 주는지 curl 로 확인하고 끈다. `squad msg`·`squad log`·`squad task add` 를 한 번씩 실행해 보드 상태에 반영되는지 확인한 뒤 그 시험 기록은 지운다. `squad order --dry` 는 claude 를 부르므로 실행하지 말고, 프롬프트 조립 함수만 단위 테스트한다.
5. git init 후 커밋(한국어 conventional 메시지, 끝줄 "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"). 원격 저장소는 만들지 않는다.
6. 하지 말 것: ~/.claude 설정 파일 수정, .env·비밀값 읽기·출력, C:\c 폴더 접근, 외부 서비스 가입, push.
7. 끝나면 마지막 출력으로 10줄 이내 요약: 만든 파일 목록(폴더 단위), 테스트 결과, 보드 실행 방법, 남은 일.
