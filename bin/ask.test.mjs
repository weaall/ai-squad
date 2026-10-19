import { test } from 'node:test';
import assert from 'node:assert/strict';
import { askRequest } from './ask.mjs';
import { validateInputRequest } from '../lib/input.mjs';

const ids = ['runner'];
const cap = 'ai-squad-runner-20261019-120000.png';

test('ask: choice 는 캡처 경로에서 파일 이름만 쓴다', () => {
  const v = validateInputRequest(askRequest('runner', 'choice', '시안 고르기', { option: [`a|안 A|data/captures/${cap}`, `b|안 B|${cap}`] }), ids);
  assert.deepEqual(v.options.map((o) => o.capture), [cap, cap]);
  assert.equal(v.options[0].label, '안 A');
});

test('ask: form 은 fields 로, * 는 필수', () => {
  const v = validateInputRequest(askRequest('runner', 'form', '정보', { field: ['email*|받는 메일', 'memo|메모'] }), ids);
  assert.equal(v.kind, 'fields');
  assert.deepEqual(v.fields[0], { name: 'email', label: '받는 메일', required: true });
  assert.equal(v.fields[1].required, undefined);
});

test('ask: 비밀값 칸·미리보기 비밀값은 거부', () => {
  assert.ok(validateInputRequest(askRequest('runner', 'form', '키', { field: ['apiKey|API 키'] }), ids).error);
  assert.ok(validateInputRequest(askRequest('runner', 'preview', '메일', { body: 'sk-abcdefghijklmnopqrstuvwx' }), ids).error);
  assert.equal(validateInputRequest(askRequest('runner', 'preview', '메일', { to: 'a@b.c', body: '안녕하세요' }), ids).preview.body, '안녕하세요');
});
