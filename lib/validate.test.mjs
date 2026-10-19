import test from 'node:test';
import assert from 'node:assert/strict';
import { validateMessage, validateTask, validateTaskPatch } from './validate.mjs';

const ids = ['order', 'site'];

test('메시지 검증', () => {
  assert.deepEqual(validateMessage({ from: 'human', to: 'order', text: ' 안녕 ' }, ids), { from: 'human', to: 'order', kind: 'note', text: '안녕' });
  assert.ok(validateMessage({ from: 'x', to: 'order', text: 'a' }, ids).error);
  assert.ok(validateMessage({ from: 'order', to: 'site', text: 'a', kind: 'shout' }, ids).error);
  assert.ok(validateMessage({ from: 'order', to: 'site', text: 'a'.repeat(2001) }, ids).error);
  assert.ok(validateMessage({ from: 'order', to: 'site', text: 'a', taskId: '../x' }, ids).error);
  assert.ok(validateMessage(null, ids).error);
});

test('작업 검증', () => {
  assert.equal(validateTask({ title: '할 일', member: 'site' }, ids).status, 'todo');
  assert.ok(validateTask({ title: '', member: 'site' }, ids).error);
  assert.ok(validateTask({ title: 'a', member: 'nobody' }, ids).error);
  assert.ok(validateTask({ title: 1, member: 'site' }, ids).error);
  assert.deepEqual(validateTaskPatch({ status: 'done' }, ids), { status: 'done' });
  assert.ok(validateTaskPatch({ status: 'gone' }, ids).error);
  assert.ok(validateTaskPatch({}, ids).error);
});
