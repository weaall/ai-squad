import test from 'node:test';
import assert from 'node:assert/strict';
import { buildState, describeEvent, findUnanswered, isStalled, memberStatus, runStats, sumUsage, tokenTotal } from './state.mjs';

test('runStats: 평균 기본 맥락·작업당 토큰', () => {
  const s = runStats([
    { type: 'end', taskId: 'T-1', usage: { input: 100, output: 50, base: 1000 } },
    { type: 'end', taskId: 'T-1', usage: { input: 100, output: 50, base: 3000 } },
    { type: 'end', taskId: 'T-2', usage: { input: 300 } },
    { type: 'tool', taskId: 'T-2', usage: { input: 999 } },
  ]);
  assert.deepEqual(s, { runs: 3, avgBase: 2000, perTask: 300 });
  assert.deepEqual(runStats([]), { runs: 0, avgBase: 0, perTask: 0 });
});

test('이벤트 설명', () => {
  assert.equal(describeEvent({ type: 'tool', tool: 'Edit', path: 'app/page.tsx' }), 'Edit · app/page.tsx');
  assert.equal(describeEvent({ type: 'tool', tool: 'Bash' }), 'Bash');
  assert.equal(describeEvent({ type: 'start', text: '작업' }), '작업 시작 · 작업');
  assert.equal(describeEvent({ type: 'log', text: '보는 중' }), '보는 중');
});

test('상태는 마지막 상태 이벤트를 따른다', () => {
  const ev = [
    { member: 'a', type: 'start' },
    { member: 'a', type: 'tool', tool: 'Read' },
    { member: 'b', type: 'log', status: 'blocked' },
  ];
  assert.equal(memberStatus('a', ev), 'working');
  assert.equal(memberStatus('b', ev), 'blocked');
  assert.equal(memberStatus('a', [...ev, { member: 'a', type: 'end', status: 'idle' }]), 'idle');
  assert.equal(memberStatus('c', ev), 'idle');
  assert.equal(memberStatus('c', [], [{ member: 'c', status: 'doing' }]), 'working');
});

test('보드 상태를 만든다', () => {
  const members = [{ id: 'order', name: '오더', current: '' }, { id: 'a', name: 'A', current: '' }];
  const tasks = [
    { id: 'T-1', member: 'a', status: 'doing', title: '하는 중' },
    { id: 'T-2', member: 'a', status: 'todo', title: '할 일' },
    { id: 'T-3', member: 'a', status: 'blocked', title: '막힘' },
  ];
  const events = [
    { project: 'p', member: 'a', type: 'tool', tool: 'Edit', path: 'x' },
    { project: 'q', member: 'a', type: 'end' },
  ];
  const s = buildState({ project: { id: 'p', name: 'P' }, members, tasks, messages: [], events });
  const a = s.members.find((m) => m.id === 'a');
  assert.equal(a.status, 'working');
  assert.equal(a.current, '하는 중');
  assert.equal(a.pending, 2);
  assert.equal(a.lastEvent.label, 'Edit · x');
  assert.equal(s.events.length, 1, '다른 프로젝트 이벤트는 뺀다');
  assert.deepEqual(s.counts, { working: 1, blocked: 1, pending: 1, approvals: 0, stalled: 0, unanswered: 0, review: 0, inbox: 0, inboxTaking: 0 });
});

const T0 = Date.parse('2026-10-19T03:00:00Z');
const ago = (min) => new Date(T0 - min * 60000).toISOString();

test('답 없는 인계: 오래됐고 받은 쪽이 보낸 쪽에게(또는 같은 작업으로) 답하지 않은 것만', () => {
  const msgs = [
    { id: 'M1', at: ago(60), from: 'a', to: 'b', kind: 'handoff', text: '' },
    { id: 'M2', at: ago(50), from: 'c', to: 'b', kind: 'question', text: '', taskId: 'T-1' },
    { id: 'M3', at: ago(40), from: 'b', to: 'order', kind: 'report', text: '', taskId: 'T-1' },
    { id: 'M4', at: ago(10), from: 'a', to: 'c', kind: 'handoff', text: '' },
    { id: 'M5', at: ago(90), from: 'a', to: 'd', kind: 'note', text: '' },
    { id: 'M6', at: ago(45), from: 'd', to: 'a', kind: 'question', text: '' },
    { id: 'M7', at: ago(44), from: 'a', to: 'd', kind: 'answer', text: '' },
  ];
  assert.deepEqual(findUnanswered(msgs, T0, 30 * 60000).map((m) => m.id), ['M1']);
});

test('멈춤: 할 일이 있는데 오래 움직이지 않은 멤버', () => {
  const lim = 30 * 60000;
  const todos = [{ createdAt: ago(120) }];
  assert.equal(isStalled({ status: 'idle', todos, lastEventAt: ago(90) }, T0, lim), true);
  assert.equal(isStalled({ status: 'idle', todos, lastEventAt: ago(5) }, T0, lim), false);
  assert.equal(isStalled({ status: 'working', todos, lastEventAt: ago(90) }, T0, lim), false);
  assert.equal(isStalled({ status: 'idle', todos: [], lastEventAt: ago(90) }, T0, lim), false);
  assert.equal(isStalled({ status: 'idle', todos: [{ createdAt: ago(10) }] }, T0, lim), false, '방금 받은 일은 멈춤이 아니다');
});

test('토큰: 합계·오늘 합계·이번 작업', () => {
  assert.equal(tokenTotal({ input: 1, output: 2, cacheRead: 3, cacheWrite: 4 }), 10);
  assert.deepEqual(sumUsage([{ input: 1, output: 1, costUsd: 0.1 }, null, { input: 2, output: 0, costUsd: 0.2 }]), { input: 3, output: 1, cacheRead: 0, cacheWrite: 0, total: 4, budgetTokens: 4, costUsd: 0.3 });
  const members = [{ id: 'a', name: 'A', current: '' }];
  const tasks = [{ id: 'T-1', member: 'a', status: 'doing', title: 'x', createdAt: ago(1), usage: { input: 5, output: 5 } }];
  const events = [
    { project: 'p', member: 'a', type: 'end', at: new Date(T0 - 2 * 86400000).toISOString(), usage: { input: 100, output: 0 } },
    { project: 'p', member: 'a', type: 'end', at: ago(1), usage: { input: 7, output: 3 } },
  ];
  const s = buildState({ project: { id: 'p', name: 'P' }, members, tasks, messages: [], events, now: T0 });
  assert.deepEqual(s.members[0].tokens, { task: 10, today: 10, all: 110 });
  assert.equal(s.tokensToday.total, 10);
});

test('budgetTokens: 캐시 읽기는 0.1배, 캐시 쓰기는 1.25배로 센다', async () => {
  const { budgetTokens, sumUsage } = await import('./state.mjs');
  assert.equal(budgetTokens({ input: 100, output: 50, cacheRead: 1000, cacheWrite: 80 }), 100 + 50 + 100 + 100);
  assert.equal(budgetTokens(null), 0);
  assert.equal(sumUsage([{ input: 10, cacheRead: 100 }, { output: 5 }]).budgetTokens, 25);
});
