## 인계 메모

- T-mvemvifb-da25(2a8f2f2): 입력 요청 모달 `#ask`(app.js syncAsk·renderAsk, logic.js inputPayload). 한 번 닫은 요청은 저절로 다시 뜨지 않고 상단 [입력 대기 n] 으로 연다. push 안 함.
- 화면 확인: 임시 root 에 projects.json+tasks.jsonl 을 만들고 startBoard({root, token}) + lib/capture 로 1440·1280 캡처(다크). 라이트는 미확인(색 변수만 씀).
- server 에 handoff: logic 시험 추가, TASK_STATUSES 에 'input' 넣기(그 뒤 칸반 열 추가 필요).
