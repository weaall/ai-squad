## 인계 메모

- T-mvet33lb-4d87: 확인 패널 순서 승인→막힘(bl:id|updatedAt)→답 없는 질문(data.unanswered, 멤버끼리)→예산. 막힘 카드 단추는 logic.js blockedAction → POST /api/task/:id/{retry,reassign,done,cancel}(서버 미구현, M-mveteynv-ea00 handoff).
  사람에게 온 question 은 askItems 로 입력 모달에 섞여 뜨고 답은 /api/messages answer(작업 todo 전환도 server 몫). 로그 10줄은 events taskId 로 대신.

- T-mves6pec-d27c: 연결 보기는 메시지마다 from→to 빛 하나(FLY 600ms) 뒤 선이 FADE 2.5s 동안 옅어짐. 굵기는 쌍별 최근 1시간 메시지 수(links.times). 파동·꼬리 입자·net.event 제거, 배경선은 오더↔멤버 0.035.

- T-mves5akf-2c54: 상단 '할 일 n · 잠김 m'(logic.js todoCounts, todo·waitingOn), 카드·행 '할 일 n'. 멤버 상태 이름은 data.statusLabels ?? STATUS_FALLBACK, 입력·승인 대기는 viewStatus(task input·approvals pending)로 가름, 색은 m.status 그대로.
- STATUS_LABEL 변경·statusLabels 응답은 server 에 handoff(M-mvesck01-9dc7). lib/v04 run-queue 동시 실행 테스트는 ui 와 무관하게 실패 중.

- T-mveq67y2-71b3: 지시 받는 사람 드롭다운(`#order-to`)·sendDesktop 제거, 지시는 늘 /api/order. '데스크톱 n' 칩은 desktop 멤버 inbox 대기 건수(counts.inbox). init 템플릿·오더 프롬프트·SPEC 은 server, inbox 라우팅은 runner 에 handoff.
- T-mveqjipp-a717: 상단 토큰 칩은 '오늘 사용 n'(tokensToday.total), 툴팁에 예산 기준(budgetTokens)·전체·비용·남은 한도 안내. 막대는 budget.daily 있을 때만.
- T-mveq2ab2-5f36: 카드·팝오버 headroom 은 API 실효값 m.headroom(store resolveHeadroom, 기본 켜짐) 그대로 씀. 스위치 라벨만 '기본 켜짐' 안내로.
- T-mveq2ab2-b79b: /api/order 응답을 logic.js orderOutcome 으로 가름 — tasks 있고 needsConfirm≠true 면 토스트만, 아니면 계획 카드에 '확인 이유'(reasons, 없으면 항목 reason). 응답 약속은 server(3688)에 handoff, 서버 반영 전엔 늘 확인 패널.
- 화면 확인: 임시 HTML+style.css 를 headless Chrome --screenshot 으로 찍으면 빠름. 라이트 테마는 미확인(색 변수만 씀).
