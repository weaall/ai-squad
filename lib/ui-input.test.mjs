// 화면 입력 모달 순수 함수(server/public/logic.js) 시험 — 모달이 만든 본문을 서버 검증(validateInputAnswer)이 받는지까지.
import test from 'node:test';
import assert from 'node:assert/strict';
import { inputKey, inputPayload, pendingInputs } from '../server/public/logic.js';
import { validateInputAnswer } from './input.mjs';

const preview = { kind: 'preview', at: '2026-10-19T02:00:00Z', body: '본문' };
const choice = { kind: 'choice', at: '2026-10-19T01:00:00Z', options: [{ id: 'a', label: 'A안' }, { id: 'b', label: 'B안' }] };
const fields = { kind: 'fields', at: '2026-10-19T03:00:00Z', fields: [{ name: 'url', label: '주소', required: true }, { name: 'memo', label: '메모' }] };
const task = (id, input, status = 'input') => ({ id, status, input });

test('pendingInputs: 입력 대기만, 먼저 요청한 순', () => {
  const tasks = [task('T-1', preview), task('T-2', choice), task('T-3', fields, 'todo'), task('T-4', null)];
  assert.deepEqual(pendingInputs(tasks).map((t) => t.id), ['T-2', 'T-1']);
  assert.deepEqual(pendingInputs(), []);
});

test('inputKey: 같은 요청이면 같고, 다시 요청하면 바뀐다', () => {
  assert.equal(inputKey(task('T-1', preview)), inputKey(task('T-1', { ...preview })));
  assert.notEqual(inputKey(task('T-1', preview)), inputKey(task('T-1', { ...preview, at: '2026-10-19T04:00:00Z' })));
});

test('inputPayload: preview 는 approve 가 있어야 한다', () => {
  assert.ok(inputPayload(task('T-1', preview), {}).error);
  const { body } = inputPayload(task('T-1', preview), { approve: false, note: '  다음에 ' });
  assert.deepEqual(body, { taskId: 'T-1', approve: false, note: '다음에' });
  assert.ok(validateInputAnswer(preview, body).answer);
});

test('inputPayload: choice 는 있는 안만', () => {
  assert.ok(inputPayload(task('T-2', choice), { choice: 'z' }).error);
  const { body } = inputPayload(task('T-2', choice), { choice: 'b' });
  assert.deepEqual(body, { taskId: 'T-2', choice: 'b' });
  assert.ok(validateInputAnswer(choice, body).answer);
});

test('inputPayload: fields 는 필수 칸을 알려 주고, 값은 다듬어 보낸다', () => {
  const miss = inputPayload(task('T-3', fields), { values: { url: '  ' } });
  assert.deepEqual(miss.missing, ['url']);
  const { body } = inputPayload(task('T-3', fields), { values: { url: ' https://x ' } });
  assert.deepEqual(body.values, { url: 'https://x', memo: '' });
  assert.ok(validateInputAnswer(fields, body).answer);
});
