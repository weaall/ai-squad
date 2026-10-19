import test from 'node:test';
import assert from 'node:assert/strict';
import { buildState, describeEvent, memberStatus } from './state.mjs';

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
  assert.deepEqual(s.counts, { working: 1, blocked: 1, pending: 1 });
});
