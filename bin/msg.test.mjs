import { test } from 'node:test';
import assert from 'node:assert/strict';
import { afterMessage } from './msg.mjs';

const ctx = { workers: ['ui', 'server'], squadRoot: '/sq', project: 'p' };

test('msg: 멤버에게 온 question 은 답변 작업(easy)을 만든다', () => {
  const r = afterMessage({ from: 'ui', to: 'server', kind: 'question', text: 'API 모양?', taskId: 'T-1' }, ctx);
  assert.equal(r.task.member, 'server');
  assert.equal(r.task.difficulty, 'easy');
  assert.match(r.task.detail, /msg p server ui "<답>" --kind answer --task T-1/);
  assert.equal(afterMessage({ from: 'ui', to: 'order', kind: 'question', text: 'x' }, ctx).task, undefined);
});

test('msg: 멤버에게 온 handoff 는 인계 작업(제목=첫 줄, detail=전문·원래 작업)', () => {
  const r = afterMessage({ from: 'runner', to: 'server', kind: 'handoff', text: 'API 추가 필요\n자세히는 이렇다', taskId: 'T-1' }, ctx);
  assert.equal(r.task.member, 'server');
  assert.equal(r.task.title, '인계: API 추가 필요');
  assert.match(r.task.detail, /원래 작업 T-1[\s\S]*자세히는 이렇다/);
  assert.equal(afterMessage({ from: 'ui', to: 'order', kind: 'handoff', text: 'x' }, ctx).task, undefined);
});

test('msg: answer 는 기다리던 원래 작업만 다시 todo', () => {
  const tasks = [
    { id: 'T-1', member: 'ui', status: 'input' },
    { id: 'T-2', member: 'ui', status: 'input', input: { kind: 'fields' } },
    { id: 'T-3', member: 'ui', status: 'doing' },
  ];
  const ans = (taskId, to = 'ui') => afterMessage({ from: 'server', to, kind: 'answer', text: '이렇게', taskId }, { ...ctx, tasks });
  assert.equal(ans('T-1').resume, 'T-1');
  assert.equal(ans('T-2').resume, undefined); // 사람 입력 대기
  assert.equal(ans('T-3').resume, undefined);
  assert.equal(ans('T-1', 'server').resume, undefined); // 남의 작업
});
