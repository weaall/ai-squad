import test from 'node:test';
import assert from 'node:assert/strict';
import { claudeArgs } from './claude.mjs';

const allowed = (tools) => {
  const a = claudeArgs({ mode: 'member', tools });
  return a[a.indexOf('--allowedTools') + 1].split(',');
};

test('claudeArgs: 멤버 도구에 git add·commit 이 늘 들어가고 push 는 없음', () => {
  for (const tools of [undefined, ['Read', 'Bash(node *)'], ['Bash(git add *)']]) {
    const a = allowed(tools);
    assert.ok(a.includes('Bash(git add *)') && a.includes('Bash(git commit *)'), String(tools));
    assert.equal(a.filter((t) => t === 'Bash(git add *)').length, 1);
    assert.ok(!a.some((t) => /push/.test(t)));
  }
  assert.ok(!claudeArgs({ mode: 'plan' }).includes('--allowedTools'));
});
