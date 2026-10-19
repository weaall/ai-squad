## 인계 메모

- T-mvey2es7-3045: 사용량 탭 멤버 표에 '시작 맥락 전→후' 열(ctxCell, startContextStats {before,after:{n,avg}}, 변화 %). 데이터는 d.startContext ?? d.usage.startContext[멤버id] 로 읽음 — 서버가 어디에 싣는지 정해지면 맞출 것. 없으면 '-'. 캡처·커밋 안 함.

- T-mvewtttd-b953: 서버 hello version 인계 확인 — app.js connect() 가 이미 처리(T-mvewn8pb-845c, 둘 다 null 아니고 다르면 reload). 코드 변경 없음.

- T-mvewgg91-c63f: 머리줄 #use-chip 은 'Claude 5h n% · 주 n%' 요약 하나(높은 쪽 lv 색) → 누르면 dialog#use-modal(fillUseModal: 반원 게이지 2·runner/Headroom 비율 SVG 막대·Headroom 절약·멤버 상위 5·#usage 링크). #use-pop 팝오버 삭제.
  headroomView 에 pct 없으면 saved/before, newPct(new_input_savings_percent) 추가. 1440·1280 데모 캡처 확인(데모는 Headroom '수집 전'). server/index.test.mjs 1개 실패는 ui 무관.

- T-mvevdfn6-2699: 머리줄 #use-chip 한 개(5시간·이번 주 limitChip 70/90%·stale 회색, 오늘 사용, runner 별 .more 는 넘치면 is-tight 로 숨김) → 누르면 #use-pop(리셋 시각·남음·runner 별 '한도 정보 없음').
  '이번 주 사용' 패널은 사용량 탭 #week-panel(renderWeek: 21시 경계 막대 runner 색·used 선·멤버 상위 5). 툴팁 USE_NOTE. 1440·1280 데모 캡처 확인, node --test 159 통과.

- T-mvewn8pb-845c: app.js connect() — SSE hello data.version 을 처음 값(bootVersion)과 비교해 다르면 location.reload(), version 없으면 무시. 503 등으로 EventSource 가 CLOSED 되면 3초 뒤 connect() 재시도.
  hello 에 version 싣기는 server handoff(T-mvewox3z-bf45). 커밋 안 함(git 권한 없음).

- T-mvewh021-eddc: 사용량 탭 '이번 주' KPI·아낀 양 막대·Antigravity 추정은 logic.js weekTotals(서버 week.days 의 tokens·total·costUsd·runners 합)로 교체, ≈·500개 경고 제거.
  멤버 표·비싼 작업 10 은 여전히 usageReport(이벤트 500개, 잘리면 '≈'). headroom 은 headroomView 가 {at,data}·404 둘 다 처리 — 손댈 것 없었음. 커밋 안 함(git 권한 없음).

- T-mvevocqu-f5d5: '사용량' 탭(#usage) — KPI 6칸·주간 runner 막대(renderWeek 를 보고 탭에서 옮김, 빠졌던 wk-/use-chip CSS 채움)·아낀 양(Antigravity 는 Claude 주간 단가로 환산한 '추정')·멤버 표·비싼 작업 10. 계산은 logic.js usageReport/headroomView.
  /api/usage/headroom({at,data}) 은 server handoff(T-mvewe718-3c80), 없으면 '수집 전'. 이번 주 raw 합·비용은 events 최근 500개 기준이라 잘리면 ≈ 표시 — 서버가 week 에 total·cost 주면 교체. 커밋 못 함(git commit 권한 거부) — server/public 전체가 미커밋.

- T-mvevc9t2-e9c8: 확인 패널은 .side position:fixed 360px 서랍(150ms side-in, 바깥 pointerdown·Esc·닫기로 닫힘, 자동 열림·배지 그대로). 카드 .cards 3열(≤1180 2열, ≤960 1열), net-layout 1fr:1.35fr.
  코드는 91a927f 에 섞여 이미 커밋됨. 1440·1280 데모 캡처로 3열·겹침 확인. 확인 화면은 startBoard({demo,token}) + lib/capture.mjs 로 찍음.

- T-mvew7340-0a96: 서버 m.runStats(최근 기록 전체)를 카드 토큰 칩 툴팁 둘째 줄, 상세 모달 '누적 실행' stat, 사용량 탭 표 '누적 실행' 열(runCell, 툴팁에 실행당 기본 맥락·작업당 토큰)로 표시. runs 0 이면 숨김/'-'.
  이번 주 값은 그대로 클라이언트 usageReport. 커밋 못 함(git 권한 없음, app.js 미커밋 변경 섞임).

- T-mvew200f-7c1d: 멤버 상세 모달에 '이번 주 사용'(작업·평균 기본 맥락·작업당 토큰·비용) stat 칩 — logic.js usageReport(이벤트 usage.base) 를 그대로 씀. 사용량 탭 멤버 표엔 이미 같은 열 있음.
  서버 집계 전이라 최근 이벤트 500개 기준. 커밋 못 함(git 권한 없음, 사용량 탭 미커밋 변경과 섞임).

- T-mveve0bj-db0d: 'outside-warn' 이벤트 — eventLabel '경로 밖 변경 · path (<멤버> 몫|누가 고쳤는지 모름)', 이벤트 목록 li.is-warn(노랑), 작업 카드엔 그 작업의 마지막 경고를 .tcard-review.is-warn 으로. 막힘 아님.
  커밋 못 함(git 권한 없음, app.js 에 이전 미커밋 변경 섞여 있음).

- T-mveva74d-5ef8: 'cancelled' 작업은 칸반 완료 칸에 회색·취소선(.tcard.is-cancelled), 상태 select·taskList 라벨 '취소', 멤버 대기 목록에서 제외. 막힘 단추는 이미 blockedAction → /api/task/:id/* 로 연결돼 있어 그대로 둠.

- T-mveukd5x-efd5: CI 적용 — 머리 로고(어두운 logo.png / 밝은 symbol+"AI SQUAD" 글자), 파비콘 png, 색 토큰 --brand-*·--brand-grad·--accent-text(어두운 테마 옅은 바탕 위 블루 글자용)·--done. 실행 중=시안, 지시 빛=시안, 질문=분홍(시안과 겹침 피함), 오더 노드 고리=conic 심볼 그라데이션.
  서버 TYPES 에 .png 없어 /brand/* 404 → server handoff(M-mveukzfe-d482). runner 별 막대 그래프는 화면에 없어 건너뜀.

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
