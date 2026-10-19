import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { appendJsonl, loadMembers, memberFile, newId, projectPaths, readJsonl, updateTask } from './store.mjs';

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'squad-'));
  const proj = path.join(root, 'proj');
  for (const id of ['site', 'order']) fs.mkdirSync(path.join(proj, '.squad', 'members', id), { recursive: true });
  fs.writeFileSync(path.join(proj, '.squad', 'members', 'site', 'MEMBER.md'), '---\nid: site\nname: 사이트\nowns: [a/**]\nheadroom: true\n---\n\n## 역할\n\n사이트\n');
  fs.writeFileSync(path.join(proj, '.squad', 'members', 'order', 'MEMBER.md'), '---\nname: 오더\n---\n');
  fs.writeFileSync(path.join(root, 'projects.json'), JSON.stringify({ p: { name: 'P', path: proj } }));
  return { root, proj };
}

test('jsonl 읽기·쓰기·고치기', () => {
  const { root } = fixture();
  const f = path.join(root, 'x', 'a.jsonl');
  appendJsonl(f, { id: 'T-1', status: 'todo' });
  fs.appendFileSync(f, '{깨짐\n');
  appendJsonl(f, { id: 'T-2', status: 'todo' });
  assert.equal(readJsonl(f).length, 2);
  assert.equal(updateTask(f, 'T-2', { status: 'done' }).status, 'done');
  assert.equal(readJsonl(f)[1].status, 'done');
  assert.equal(updateTask(f, 'T-9', {}), null);
  assert.deepEqual(readJsonl(path.join(root, 'none.jsonl')), []);
  assert.match(newId('T'), /^T-[a-z0-9]+-[0-9a-f]{4}$/);
});

test('경로: 시연 데이터는 따로, 멤버 파일은 members 밖으로 못 나간다', () => {
  const { root, proj } = fixture();
  const real = projectPaths(root, 'p');
  const demo = projectPaths(root, 'p', { demo: true });
  assert.equal(real.tasks, path.join(proj, '.squad', 'tasks.jsonl'));
  assert.equal(demo.tasks, path.join(root, 'data', 'demo', 'p', 'tasks.jsonl'));
  assert.notEqual(real.events, demo.events);
  assert.throws(() => projectPaths(root, 'nope'));
  assert.throws(() => memberFile(real, '..'));
  assert.throws(() => memberFile(real, 'site', '../../x'));
  const ms = loadMembers(real);
  assert.deepEqual(ms.map((m) => m.id), ['order', 'site']);
  assert.deepEqual(ms[1].owns, ['a/**']);
  assert.equal(ms[1].role, '사이트');
  assert.equal(ms[1].headroom, true);
  assert.equal(ms[0].headroom, false);
});
