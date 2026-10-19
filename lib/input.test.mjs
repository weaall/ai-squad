// 입력 요청: 검증, 비밀값 칸 거부, 입력 대기↔todo 전환.
import test from 'node:test';
import assert from 'node:assert/strict';
import { answerInput, answerText, looksSecret, requestInput, validateInputRequest } from './input.mjs';

const M = ['site', 'ui'];
const AT = '2026-10-19T10:00:00.000Z';
const CAP = 'ai-squad-ui-20261019-100000.png';
const task = { id: 'T-a', title: '랜딩', member: 'site', status: 'doing' };

test('입력 요청 검증: 세 종류와 잘못된 값', () => {
  const p = validateInputRequest({ from: 'site', kind: 'preview', title: ' 메일 확인 ', preview: { to: 'a@b.c', body: '안녕하세요\r\n' } }, M);
  assert.deepEqual(p, { from: 'site', kind: 'preview', title: '메일 확인', preview: { to: 'a@b.c', body: '안녕하세요' } });
  const c = validateInputRequest({ from: 'ui', kind: 'choice', title: '안 고르기', options: [{ id: 'a', label: 'A', capture: CAP }, { id: 'b', label: 'B', capture: CAP }] }, M);
  assert.equal(c.options.length, 2);
  assert.match(validateInputRequest({ ...c, options: [{ id: 'a', label: 'A', capture: '../x.png' }, { id: 'b', label: 'B', capture: CAP }] }, M).error, /캡처/);
  assert.match(validateInputRequest({ ...c, options: [c.options[0]] }, M).error, /2~/);
  assert.match(validateInputRequest({ from: 'x', kind: 'preview', title: 't' }, M).error, /멤버/);
  assert.match(validateInputRequest({ from: 'site', kind: 'nope', title: 't' }, M).error, /종류/);
  const f = validateInputRequest({ from: 'site', kind: 'fields', title: '회사 정보', fields: [{ name: 'company', label: '회사 이름', required: true }, { name: 'phone', label: '대표 번호' }] }, M);
  assert.deepEqual(f.fields[0], { name: 'company', label: '회사 이름', required: true });
});

test('비밀값으로 보이는 칸·내용은 거부', () => {
  for (const [name, label] of [['pw', '비밀번호'], ['apiKey', 'API 키'], ['gh', 'GitHub token'], ['card', '카드 번호'], ['otp', '인증 코드']]) {
    const r = validateInputRequest({ from: 'site', kind: 'fields', title: 't', fields: [{ name, label }] }, M);
    assert.match(r.error || '', /비밀값/, `${name}/${label}`);
  }
  assert.equal(looksSecret('여권 번호(passport)'), false);
  assert.equal(looksSecret('shipping address'), false);
  assert.match(validateInputRequest({ from: 'site', kind: 'preview', title: 't', preview: { body: 'key sk-abcdefghijklmnopqrstuv' } }, M).error, /비밀값/);
});

test('입력 대기로 멈추고, 답을 붙여 todo 로', () => {
  const req = validateInputRequest({ from: 'site', kind: 'fields', title: '정보', fields: [{ name: 'company', label: '회사 이름', required: true }] }, M);
  const w = requestInput(task, req, AT);
  assert.equal(w.status, 'input');
  assert.equal(w.input.kind, 'fields');
  assert.throws(() => requestInput(w, req, AT), /이미/);
  assert.throws(() => requestInput({ ...task, status: 'done' }, req, AT), /끝난/);

  assert.match(answerInput(w, { values: {} }, AT).error, /회사 이름/);
  assert.match(answerInput(w, { values: { company: 'ghp_abcdefghijklmnopqrstuvwxyz' } }, AT).error, /비밀값/);
  const { task: t } = answerInput(w, { values: { company: ' 마인즈 ', extra: 'x' }, note: '확인' }, '2026-10-19T11:00:00.000Z');
  assert.equal(t.status, 'todo');
  assert.equal(t.input, undefined);
  assert.deepEqual(t.inputs[0].answer, { values: { company: '마인즈' }, note: '확인' });
  assert.equal(t.inputs[0].answeredBy, 'human');
  assert.match(answerInput(t, { values: {} }, AT).error, /기다리는/);

  const ch = requestInput(task, validateInputRequest({ from: 'ui', kind: 'choice', title: '안', options: [{ id: 'a', label: 'A', capture: CAP }, { id: 'b', label: 'B', capture: CAP }] }, M), AT);
  assert.match(answerInput(ch, { choice: 'z' }, AT).error, /안이 없/);
  assert.equal(answerInput(ch, { choice: 'b' }, AT).task.inputs[0].answer.choice, 'b');
  const pv = requestInput(task, validateInputRequest({ from: 'site', kind: 'preview', title: '메일', preview: { body: 'hi' } }, M), AT);
  assert.match(answerInput(pv, {}, AT).error, /approve/);
  assert.equal(answerInput(pv, { approve: false, note: '문구 수정' }, AT).task.inputs[0].answer.approve, false);
});

test('답 알림 한 줄', () => {
  const base = { title: '확인', answeredAt: AT };
  assert.equal(answerText({ ...base, kind: 'preview', answer: { approve: false, note: '내일' } }), '입력 답(발송 미리보기): 확인 — 보내지 말 것 (메모: 내일)');
  assert.equal(answerText({ ...base, kind: 'choice', options: [{ id: 'a', label: 'A안', capture: CAP }], answer: { choice: 'a' } }), '입력 답(디자인안 선택): 확인 — 고른 안: A안 (a)');
  assert.equal(answerText({ ...base, kind: 'fields', answer: { values: { company: '마인즈' } } }), '입력 답(필수 정보): 확인 — company=마인즈');
});
