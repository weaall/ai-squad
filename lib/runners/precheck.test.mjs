import test from 'node:test';
import assert from 'node:assert/strict';
import { checkCommands, needsLlm, precheck } from './precheck.mjs';

const member = { tools: ['Read', 'Bash(node *)', 'Bash(npm test*)', 'Bash(npx tsc --noEmit)'] };
const small = [{ path: 'bin/a.mjs', add: 1, del: 0 }];

test('checkCommands: 확인 명령만, 와일드카드 일반 명령은 뺀다', () => {
  assert.deepEqual(checkCommands(member.tools), ['npm test', 'npx tsc --noEmit']);
});

test('needsLlm: 파일 10개+·화면·문구는 LLM', () => {
  assert.equal(needsLlm({ stats: small }), '');
  assert.match(needsLlm({ stats: Array.from({ length: 10 }, (_, i) => ({ path: `a${i}.js` })) }), /10개/);
  assert.equal(needsLlm({ stats: [{ path: 'server/public/app.css' }] }), '화면 변경');
  assert.match(needsLlm({ task: { title: '안내 문구 수정' }, stats: small }), /문구/);
});

test('precheck: 통과면 pass, 실패·명령 없음이면 LLM 으로', () => {
  const ok = precheck({ member, task: { diffStat: small }, run: () => ({ ok: true, out: '' }) });
  assert.equal(ok.pass, true);
  const bad = precheck({ member, task: { diffStat: small }, run: (c) => ({ ok: c !== 'npm test', out: 'x\nfail' }) });
  assert.match(bad.why, /npm test 실패/);
  assert.equal(precheck({ member: { tools: ['Read'] }, task: { diffStat: small } }).why, '확인 명령 없음');
});
