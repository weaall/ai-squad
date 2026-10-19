import { test } from 'node:test';
import assert from 'node:assert/strict';
import { todoCounts, viewStatus } from './logic.js';

test('todoCounts: todo 만 세고 선행이 남은 것은 잠김', () => {
  const tasks = [{ status: 'todo' }, { status: 'todo', waitingOn: ['a'] }, { status: 'todo', waitingOn: [] }, { status: 'doing' }];
  assert.deepEqual(todoCounts(tasks), { todo: 3, locked: 1 });
  assert.deepEqual(todoCounts(), { todo: 0, locked: 0 });
});

test('viewStatus: 입력·승인 대기를 쉬는 중·막힘과 나눈다', () => {
  const d = {
    tasks: [{ member: 'a', status: 'input', input: { at: '1' } }],
    approvals: [{ from: 'b', status: 'pending' }, { from: 'c', status: 'approved' }],
  };
  assert.equal(viewStatus({ id: 'a', status: 'blocked' }, d), 'input');
  assert.equal(viewStatus({ id: 'b', status: 'blocked' }, d), 'approval');
  assert.equal(viewStatus({ id: 'c', status: 'blocked' }, d), 'blocked');
  assert.equal(viewStatus({ id: 'c', status: 'idle' }, d), 'idle');
  assert.equal(viewStatus({ id: 'a', status: 'working' }, d), 'working');
});
