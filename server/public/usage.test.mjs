import { test } from 'node:test';
import assert from 'node:assert/strict';
import { headroomView, limitChip, usageReport, limitLevel, resetText, topMembers, weekSlots, weekTotals } from './logic.js';

test('weekTotals: 서버 week.days 를 합치고 Antigravity 를 Claude 단가로 환산', () => {
  const w = weekTotals({ days: [
    { tokens: 300, total: 1150, costUsd: 0.2, byRunner: { claude: 200, antigravity: 100 }, runners: { claude: { total: 1100, costUsd: 0.2 }, antigravity: { total: 50, costUsd: 0 } } },
    { tokens: 200, total: 10, costUsd: 0.2, byRunner: { claude: 200 }, runners: { claude: { total: 10, costUsd: 0.2 } } },
  ] });
  assert.equal(w.budget, 500);
  assert.equal(w.total, 1160);
  assert.ok(Math.abs(w.cost - 0.4) < 1e-9);
  assert.deepEqual(w.runner.antigravity, { budget: 100, total: 50, cost: 0 });
  assert.ok(Math.abs(w.agEstUsd - 0.1) < 1e-9); // 100 × (0.4 / 400)
  assert.equal(weekTotals(null).agEstUsd, null);
});

const KST = (s) => Date.parse(`${s}+09:00`);

test('limitChip: 사용률·남음·리셋(24시간 안은 시각만, 넘으면 요일)', () => {
  const now = KST('2026-10-19T10:00:00');
  assert.deepEqual(limitChip({ used: 0.553, resetsAt: KST('2026-10-19T13:00:00') }, now), { pct: 55, left: 45, reset: '13:00', lv: 'ok' });
  assert.equal(limitChip({ used: 0.22, resetsAt: KST('2026-10-25T21:00:00') }, now).reset, '일 21:00');
  assert.equal(limitChip(null), null);
  assert.equal(resetText(null), '');
});

test('limitLevel: 70% 노랑 90% 빨강', () => {
  assert.deepEqual([0.69, 0.7, 0.9].map(limitLevel), ['ok', 'warn', 'over']);
});

test('weekSlots: 시작부터 7칸, 21시 경계 날짜·빈 날은 future', () => {
  const start = KST('2026-10-18T21:00:00');
  const s = weekSlots({ start, days: [{ day: '2026-10-19', tokens: 5, byRunner: { claude: 5 }, byMember: {}, used: 0.2 }] });
  assert.equal(s.length, 7);
  assert.deepEqual([s[0].day, s[0].dow, s[0].tokens, s[0].used, s[0].future], ['2026-10-19', '월', 5, 0.2, false]);
  assert.deepEqual([s[6].day, s[6].dow, s[6].future], ['2026-10-25', '일', true]);
  assert.deepEqual(weekSlots(null), []);
});

test('topMembers: 주간 합계 상위 n', () => {
  const week = { days: [{ byMember: { a: 1, b: 5 } }, { byMember: { a: 7, c: 2 } }] };
  assert.deepEqual(topMembers(week, 2), [['a', 8], ['b', 5]]);
});

test('usageReport: 이번 주 합·runner 별·멤버 표·비싼 작업·Antigravity 추정 비용', () => {
  const since = Date.parse('2026-10-18T12:00:00Z');
  const ev = (member, taskId, usage, at = '2026-10-19T01:00:00Z') => ({ at, member, type: 'end', taskId, usage });
  const r = usageReport({
    events: [
      ev('ui', 'T1', { input: 100, output: 0, costUsd: 1 }, '2026-10-17T00:00:00Z'), // 주 시작 전
      ev('ui', 'T1', { input: 1000, output: 0, base: 400, costUsd: 2 }),
      ev('ui', 'T2', { input: 0, output: 0, cacheRead: 10000, base: 600, costUsd: 0.5 }),
      ev('qa', 'T3', { input: 3000, output: 0, runner: 'antigravity' }),
    ],
    tasks: [{ id: 'T1', title: '첫 작업' }],
    members: [{ id: 'ui', model: 'sonnet' }],
  }, since);
  assert.equal(r.week.total, 14000);
  assert.equal(r.week.budget, 5000);
  assert.equal(r.runner.claude.budget, 2000);
  assert.deepEqual(r.members.map((m) => [m.id, m.tasks, m.avgBase, m.perTask, m.runner, m.model]), [['qa', 1, null, 3000, 'antigravity', ''], ['ui', 2, 500, 5500, 'claude', 'sonnet']]);
  assert.deepEqual(r.top.map((t) => [t.id, t.title, t.cost]), [['T1', '첫 작업', 2], ['T2', 'T2', 0.5], ['T3', 'T3', null]]);
  assert.equal(r.agEstUsd, 3000 * (2.5 / 2000));
  assert.equal(r.truncated, false);
  assert.equal(usageReport({ events: [] }, since).agEstUsd, null);
});

test('headroomView: 감싼 응답·날것 모두, 없으면 null', () => {
  const raw = { windows: { today: { tokens_saved: 5, tokens_before: 20, savings_percent: 25, cost_usd: 0.1, calls: 3 }, last_7_days: { tokens_saved: 50 } } };
  assert.deepEqual(headroomView({ at: 1, data: raw }).today, { saved: 5, before: 20, pct: 25, newPct: null, usd: 0.1, calls: 3 });
  assert.equal(headroomView(raw).week.saved, 50);
  // savings_percent 가 없으면 saved/before 로, new_input_savings_percent 는 그대로
  const w = headroomView({ windows: { today: { tokens_saved: 1, tokens_before: 3, new_input_savings_percent: 42.5 } } }).today;
  assert.equal(w.pct, 33.3);
  assert.equal(w.newPct, 42.5);
  assert.equal(headroomView(null), null);
});

test('toolView: 주 합계·멤버·일별, graphify 글자÷4 토큰', async () => {
  const { toolView } = await import('./logic.js');
  const g = (saved) => ({ calls: 1, out: 100, src: saved + 100, saved });
  const v = toolView({
    days: [
      { day: '2026-10-20', runs: 1, on: { headroom: 1, ponytail: 1, graphify: 0 }, graphify: g(0) },
      { day: '2026-10-21', runs: 2, on: { headroom: 2, ponytail: 2, graphify: 2 }, graphify: g(4000) },
    ],
    members: { a: { runs: 1, on: { ponytail: 1 }, graphify: g(0) }, b: { runs: 2, on: { graphify: 2 }, graphify: g(4000) } },
  });
  assert.equal(v.week.runs, 3);
  assert.equal(v.week.on.ponytail, 3);
  assert.equal(v.week.tokens, 1000);
  assert.deepEqual(v.members.map((m) => m.id), ['b', 'a']);
  assert.equal(v.days[0].day, '2026-10-21');
  assert.equal(toolView(null), null);
});
