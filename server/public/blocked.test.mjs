import { test } from 'node:test';
import assert from 'node:assert/strict';
import { askItems, blockedAction, confirmItems, humanQuestions, inputPayload } from './logic.js';

test('confirmItems: 승인 다음에 막힘, 그다음 오래 답 없는 멤버끼리 질문', () => {
  const items = confirmItems({
    approvals: [{ id: 'A1', action: 'budget' }, { id: 'A2', action: 'push' }],
    tasks: [{ id: 'T-1', status: 'blocked', updatedAt: 'u1' }, { id: 'T-2', status: 'todo' }],
    messages: [
      { id: 'M1', kind: 'question', from: 'a', to: 'b' },
      { id: 'M2', kind: 'question', from: 'a', to: 'human' },
      { id: 'M3', kind: 'question', from: 'a', to: 'c' },
    ],
    unanswered: ['M1', 'M2'],
  });
  assert.deepEqual(items.map((i) => i.key), ['ap:A2', 'bl:T-1|u1', 'q:M1', 'ap:A1']);
  // 사람이 대신 답하거나 넘기면(질문한 멤버에게 메시지) 카드가 내려간다
  const after = confirmItems({ messages: [{ id: 'M1', kind: 'question', from: 'a', to: 'b' }, { kind: 'note', from: 'human', to: 'a' }], unanswered: ['M1'] });
  assert.deepEqual(after, []);
});

test('humanQuestions: 사람이 그 멤버에게 같은 작업으로 답하면 빠진다', () => {
  const ms = [
    { id: 'M1', kind: 'question', from: 'a', to: 'human', taskId: 'T-1', at: '2' },
    { id: 'M2', kind: 'question', from: 'b', to: 'human', at: '1' },
    { id: 'M3', kind: 'answer', from: 'human', to: 'a', taskId: 'T-9' },
  ];
  assert.deepEqual(humanQuestions(ms).map((m) => m.id), ['M1', 'M2']);
  assert.deepEqual(humanQuestions([...ms, { kind: 'answer', from: 'human', to: 'a', taskId: 'T-1' }]).map((m) => m.id), ['M2']);
});

test('askItems: 입력 요청과 사람에게 온 질문을 먼저 온 순으로, 질문은 답 칸 하나', () => {
  const tasks = [{ id: 'T-1', title: '일', status: 'input', input: { kind: 'form', at: '3', fields: [] } }];
  const list = askItems(tasks, [{ id: 'M1', kind: 'question', from: 'a', to: 'human', taskId: 'T-1', text: '왜?', at: '1' }]);
  assert.deepEqual(list.map((t) => t.id), ['T-1', 'T-1']);
  assert.equal(list[0].input.msg.id, 'M1');
  assert.equal(list[0].title, '일');
  assert.deepEqual(inputPayload(list[0], { values: { answer: ' 이래서 ' } }).body.values, { answer: '이래서' });
  assert.ok(inputPayload(list[0], { values: {} }).error);
});

test('blockedAction: 경로와 본문, 넘기기는 멤버가 있어야', () => {
  assert.deepEqual(blockedAction('retry', 'T-1', { note: ' 다시 ' }), { url: '/api/task/T-1/retry', body: { note: '다시' } });
  assert.deepEqual(blockedAction('reassign', 'T-1', { member: 'b' }), { url: '/api/task/T-1/reassign', body: { member: 'b' } });
  assert.ok(blockedAction('reassign', 'T-1').error);
  assert.ok(blockedAction('rm', 'T-1').error);
});
