## 인계 메모

- T-mveq67y2-71b3: 지시 받는 사람 드롭다운(`#order-to`)·sendDesktop 제거, 지시는 늘 /api/order. '데스크톱 n' 칩은 desktop 멤버 inbox 대기 건수(counts.inbox). init 템플릿·오더 프롬프트·SPEC 은 server, inbox 라우팅은 runner 에 handoff.
- T-mveqjipp-a717: 상단 토큰 칩은 '오늘 사용 n'(tokensToday.total), 툴팁에 예산 기준(budgetTokens)·전체·비용·남은 한도 안내. 막대는 budget.daily 있을 때만.
- T-mveq2ab2-5f36: 카드·팝오버 headroom 은 API 실효값 m.headroom(store resolveHeadroom, 기본 켜짐) 그대로 씀. 스위치 라벨만 '기본 켜짐' 안내로.
- 화면 확인: 임시 HTML+style.css 를 headless Chrome --screenshot 으로 찍으면 빠름. 라이트 테마는 미확인(색 변수만 씀).
