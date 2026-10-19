import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createWorktree, finishWorktree } from './worktree.mjs';

const g = (cwd, ...a) => {
  const r = spawnSync('git', a, { cwd, encoding: 'utf8', windowsHide: true });
  assert.equal(r.status, 0, r.stderr);
  return r.stdout.trim();
};
const write = (f, s) => (fs.mkdirSync(path.dirname(f), { recursive: true }), fs.writeFileSync(f, s));
function repo() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'squad-wt-'));
  g(root, 'init', '-q', '-b', 'master');
  g(root, 'config', 'user.name', 't');
  g(root, 'config', 'user.email', 't@t');
  g(root, 'config', 'core.autocrlf', 'false');
  write(path.join(root, '.gitignore'), 'node_modules/\n.squad-worktrees/\n');
  write(path.join(root, '.squad/members/a/NOTES.md'), 'a\n');
  write(path.join(root, 'src/x.js'), 'one\ntwo\n');
  write(path.join(root, 'node_modules/dep/index.js'), 'keep\n');
  g(root, 'add', '-A');
  g(root, 'commit', '-qm', 'init');
  return root;
}
const commit = (wt, file, text) => (write(path.join(wt.dir, file), text), g(wt.dir, 'add', '-A'), g(wt.dir, 'commit', '-qm', file));

test('worktree: 두 멤버가 동시에 고치고 차례로 병합 — .squad 는 원래 트리에, node_modules 는 살아 있다', () => {
  const root = repo();
  const a = createWorktree({ root, member: 'a', taskId: 'T-1' });
  const b = createWorktree({ root, member: 'b', taskId: 'T-2' });
  assert.equal(a.base, 'master');
  assert.equal(fs.readFileSync(path.join(a.dir, 'node_modules/dep/index.js'), 'utf8'), 'keep\n');
  // .squad 는 정션 → 원래 트리 파일에 쓰이고 worktree git 에는 안 보인다
  fs.appendFileSync(path.join(a.dir, '.squad/members/a/NOTES.md'), 'note\n');
  assert.equal(fs.readFileSync(path.join(root, '.squad/members/a/NOTES.md'), 'utf8'), 'a\nnote\n');
  commit(a, 'src/a.js', 'A\n');
  commit(b, 'src/b.js', 'B\n');
  assert.equal(g(a.dir, 'status', '--porcelain'), '');

  assert.equal(finishWorktree({ root, ...a }).status, 'merged');
  const rb = finishWorktree({ root, ...b });
  assert.equal(rb.status, 'merged', rb.text);
  assert.ok(fs.existsSync(path.join(root, 'src/a.js')) && fs.existsSync(path.join(root, 'src/b.js')));
  assert.equal(g(root, 'rev-list', '--count', 'HEAD'), '3');
  assert.equal(g(root, 'rev-list', '--merges', '--count', 'HEAD'), '0'); // 일직선
  assert.ok(!fs.existsSync(a.dir) && !fs.existsSync(b.dir));
  assert.equal(g(root, 'branch', '--list', 'squad/*'), '');
  assert.equal(fs.readFileSync(path.join(root, 'node_modules/dep/index.js'), 'utf8'), 'keep\n');
  assert.equal(fs.readFileSync(path.join(root, '.squad/members/a/NOTES.md'), 'utf8'), 'a\nnote\n');
});

test('worktree: 같은 줄 충돌이면 conflict 로 worktree 를 남기고, 커밋 없으면 정리, 안 커밋한 변경은 남긴다', () => {
  const root = repo();
  const a = createWorktree({ root, member: 'a', taskId: 'T-1' });
  const b = createWorktree({ root, member: 'b', taskId: 'T-2' });
  commit(a, 'src/x.js', 'ONE\ntwo\n');
  commit(b, 'src/x.js', 'uno\ntwo\n');
  assert.equal(finishWorktree({ root, ...a }).status, 'merged');
  const rb = finishWorktree({ root, ...b });
  assert.equal(rb.status, 'conflict');
  assert.match(rb.text, /병합 충돌/);
  assert.ok(fs.existsSync(b.dir));
  assert.equal(g(b.dir, 'status', '--porcelain'), ''); // rebase 는 되돌려 둔다
  assert.equal(fs.readFileSync(path.join(root, 'src/x.js'), 'utf8'), 'ONE\ntwo\n');

  const c = createWorktree({ root, member: 'c', taskId: 'T-3' });
  assert.equal(finishWorktree({ root, ...c }).status, 'empty');
  assert.ok(!fs.existsSync(c.dir));

  const d = createWorktree({ root, member: 'd', taskId: 'T-4' });
  write(path.join(d.dir, 'src/d.js'), 'wip\n');
  assert.equal(finishWorktree({ root, ...d }).status, 'dirty');
  assert.ok(fs.existsSync(path.join(d.dir, 'src/d.js')));
  // 다시 돌리면 남은 worktree 를 이어 쓴다
  assert.equal(createWorktree({ root, member: 'd', taskId: 'T-4' }).dir, d.dir);
  assert.equal(fs.readFileSync(path.join(root, 'node_modules/dep/index.js'), 'utf8'), 'keep\n');
});
