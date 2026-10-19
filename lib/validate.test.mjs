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

test('오더 지시·계획 검증', async () => {
  const { validateOrder, validatePlan, ORDER_MAX, PLAN_MAX } = await import('./validate.mjs');
  assert.deepEqual(validateOrder({ instruction: ' SEO 손보기 ' }), { instruction: 'SEO 손보기' });
  assert.ok(validateOrder({ instruction: '   ' }).error);
  assert.ok(validateOrder({}).error);
  assert.ok(validateOrder({ instruction: 3 }).error);
  assert.ok(validateOrder({ instruction: 'a'.repeat(ORDER_MAX + 1) }).error);
  assert.deepEqual(validatePlan([{ member: 'site', title: ' 제목 ', why: '이유' }], ids), { plan: [{ member: 'site', title: '제목', detail: '', why: '이유' }] });
  assert.ok(validatePlan([], ids).error);
  assert.ok(validatePlan([{ member: 'order', title: 'x' }], ids).error);
  assert.ok(validatePlan([{ member: 'site', title: 'x', why: 5 }], ids).error);
  assert.ok(validatePlan(Array(PLAN_MAX + 1).fill({ member: 'site', title: 'x' }), ids).error);
  assert.ok(validatePlan('x', ids).error);
});
