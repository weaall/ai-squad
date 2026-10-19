import { test } from 'node:test';
import assert from 'node:assert/strict';
import { limitChip, limitLevel, resetText, topMembers, weekSlots } from './logic.js';

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
