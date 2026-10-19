// 보드 화면의 판단 함수(server/public/logic.js): 확인 패널 열기, 확인 순서, diff 렌더, 승인 가능 여부.
import test from 'node:test';
import assert from 'node:assert/strict';
import { budgetLevel, canApprove, confirmItems, looksLikeDiff, orderOutcome, panelDecision, renderDiff } from './public/logic.js';

test('지시 결과: 자동 배정은 알림, needsConfirm 만 확인 패널(사유 포함)', () => {
  assert.deepEqual(orderOutcome({ plan: [{}], tasks: [{}, {}], needsConfirm: false }), { kind: 'auto', count: 2 });
  assert.deepEqual(orderOutcome({ plan: [{}], needsConfirm: true, reasons: ['위험 작업: server · 배포'] }), { kind: 'confirm', reasons: ['위험 작업: server · 배포'] });
  // 서버가 reasons 를 안 주면(이전 서버) 오더가 단 reason 으로
  assert.deepEqual(orderOutcome({ plan: [{ member: 'ui', title: 'a', needsConfirm: true, reason: '색이 모호' }, { member: 'ui', title: 'b' }] }), { kind: 'confirm', reasons: ['오더 판단: ui · 색이 모호'] });
});

test('확인 순서: 승인 → 예산 → 계획 → 로그인', () => {
  const items = confirmItems({
    approvals: [{ id: 'A-b', action: 'budget' }, { id: 'A-m', action: 'migrate' }],
    plan: { instruction: '지시' },
    runners: [{ name: 'claude', canLogin: true }, { name: 'x', canLogin: false }],
  });
  assert.deepEqual(items.map((i) => i.type), ['approval', 'budget', 'plan', 'login']);
  assert.deepEqual(items.map((i) => i.key), ['ap:A-m', 'ap:A-b', 'plan:지시', 'login:claude']);
});

test('확인 패널: 첫 상태에 대기가 있으면 닫혀 있어도 펼친다', () => {
  const items = [{ key: 'ap:A-1' }];
  const first = panelDecision({ items, seen: new Set(), open: false });
  assert.equal(first.open, true, '첫 진입 버그: 처음 받은 상태의 승인 대기도 새것으로 본다');
  assert.deepEqual(first.fresh, ['ap:A-1']);
  // 사람이 닫은 뒤 같은 상태가 다시 오면 닫힌 채로
  const again = panelDecision({ items, seen: first.seen, open: false });
  assert.equal(again.open, false);
  assert.deepEqual(again.fresh, []);
  // SSE 로 새 승인이 들어오면 다시 펼친다
  const next = panelDecision({ items: [...items, { key: 'ap:A-2' }], seen: again.seen, open: false });
  assert.equal(next.open, true);
  assert.deepEqual(next.fresh, ['ap:A-2']);
  // 열려 있으면 열린 채로, 처리된 것은 seen 에서도 빠진다
  const done = panelDecision({ items: [{ key: 'ap:A-2' }], seen: next.seen, open: true });
  assert.equal(done.open, true);
  assert.deepEqual([...done.seen], ['ap:A-2']);
  assert.equal(panelDecision({ items: [], seen: new Set(), open: false }).open, false);
});

test('diff 렌더: 이스케이프, 줄 번호, +/- 색, SQL 주석은 지움 줄이 아니다', () => {
  const html = renderDiff('diff --git a/x b/x\n@@ -1 +1 @@\n-<b>old</b>\n+"new" & \'q\'\n same');
  assert.doesNotMatch(html, /<b>old/);
  assert.match(html, /&lt;b&gt;old&lt;\/b&gt;/);
  assert.match(html, /&quot;new&quot; &amp; &#39;q&#39;/);
  assert.match(html, /<tr class="d-del"><td class="ln">3<\/td>/);
  assert.match(html, /<tr class="d-add"><td class="ln">4<\/td>/);
  assert.match(html, /class="d-hunk"/);
  assert.match(html, /class="d-meta"/);
  const sql = renderDiff('-- 설명\nALTER TABLE x;');
  assert.equal(looksLikeDiff('-- 설명\nALTER TABLE x;'), false);
  assert.doesNotMatch(sql, /d-del/);
  assert.match(renderDiff('a\nb\nc', 2), /1줄 더/);
  assert.match(renderDiff('<script>alert(1)</script>'), /&lt;script&gt;/);
});

test('위험도 높음은 상세를 펼쳐야 승인, 예산 단계', () => {
  assert.equal(canApprove({ risk: 'high' }, false), false);
  assert.equal(canApprove({ risk: 'high' }, true), true);
  assert.equal(canApprove({ risk: 'low' }, false), true);
  assert.equal(canApprove({}, false), true);
  assert.equal(budgetLevel(0.5), 'ok');
  assert.equal(budgetLevel(0.85), 'warn');
  assert.equal(budgetLevel(1.2), 'over');
});
