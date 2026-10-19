import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { claudeArgs, mcpConfig, modelFor } from './claude.mjs';

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

test('claudeArgs: push·배포·마이그레이션 명령과 그것을 덮는 넓은 Bash 규칙은 빠진다', () => {
  const risky = ['Bash', 'Bash(*)', 'Bash(git *)', 'Bash(git push *)', 'Bash(git:*)', 'Bash(bash deploy/manual/*)', 'Bash(gcloud *)', 'Bash(npx *)', 'Bash(npx prisma migrate deploy)'];
  const a = allowed(['Read', 'Bash(node *)', 'Bash(npm test*)', 'Bash(npx prisma generate)', ...risky]);
  for (const t of risky) assert.ok(!a.includes(t), t);
  for (const t of ['Read', 'Bash(node *)', 'Bash(npm test*)', 'Bash(npx prisma generate)']) assert.ok(a.includes(t), t);
});

test('claudeArgs: 멤버는 --max-turns 기본 40, mcp 설정 파일이면 strict', () => {
  const a = claudeArgs({ mode: 'member' });
  assert.equal(a[a.indexOf('--max-turns') + 1], '40');
  assert.equal(claudeArgs({ mode: 'member', maxTurns: 7 }).at(-1), '7');
  const p = claudeArgs({ mode: 'plan', mcpFile: 'x.json' });
  assert.deepEqual(p.slice(-3), ['--mcp-config', 'x.json', '--strict-mcp-config']);
  assert.ok(!p.includes('--max-turns'));
});

test('modelFor: 난이도별 모델, hard 는 멤버 모델, config 로 덮어쓰기', () => {
  assert.equal(modelFor({ difficulty: 'easy' }), 'claude-haiku-5-5');
  assert.equal(modelFor({ difficulty: 'normal', memberModel: 'opus' }), 'claude-sonnet-5-5');
  assert.equal(modelFor({ difficulty: 'hard', memberModel: 'opus' }), 'opus');
  assert.equal(modelFor({ difficulty: 'hard' }), '');
  assert.equal(modelFor({ difficulty: 'easy', models: { easy: 'h' } }), 'h');
  assert.equal(modelFor({ memberModel: 'opus' }), 'opus');
});

test('mcpConfig: 켠 이름만, 사용자·프로젝트·.mcp.json 에서 찾음', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-'));
  const cwd = path.join(dir, 'proj');
  fs.mkdirSync(cwd);
  fs.writeFileSync(path.join(dir, '.claude.json'), JSON.stringify({ mcpServers: { a: { command: 'a' }, big: { command: 'b' } }, projects: { [cwd]: { mcpServers: { p: { command: 'p' } } } } }));
  fs.writeFileSync(path.join(cwd, '.mcp.json'), JSON.stringify({ mcpServers: { l: { command: 'l' } } }));
  assert.deepEqual(Object.keys(mcpConfig(['a', 'p', 'l', 'design:ux-copy'], cwd, dir).mcpServers), ['a', 'p', 'l']);
  assert.deepEqual(mcpConfig([], cwd, dir), { mcpServers: {} });
  fs.rmSync(dir, { recursive: true, force: true });
});

test('claudeArgs: 링크된 스쿼드 폴더를 --add-dir 로 넘긴다', async () => {
  const { claudeArgs } = await import('./claude.mjs');
  const a = claudeArgs({ mode: 'member', tools: ['Read'], addDirs: ['G:/drive/squad'] });
  const i = a.indexOf('--add-dir');
  assert.equal(a[i + 1], 'G:/drive/squad');
});
