import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { mapFor, mapFresh, outline, refreshMap } from './map.mjs';

test('outline: owns 안 파일만, 넘치면 깊은 폴더부터 접는다', () => {
  const files = ['fe/app/a.ts', 'fe/app/b.ts', 'fe/app/x/c.ts', 'fe/lib/d.ts', 'be/e.ts'];
  assert.deepEqual(outline(files, ['fe/**']), ['fe/app/a.ts', 'fe/app/b.ts', 'fe/app/x/c.ts', 'fe/lib/d.ts']);
  assert.deepEqual(outline(files, ['fe/**'], 3), ['fe/app/ (3개)', 'fe/lib/ (1개)']);
  assert.deepEqual(outline(files, ['fe/**'], 1), ['fe/ (4개)']);
});

test('mapFor·mapFresh: 자기 구역만, HEAD 같으면 새것', () => {
  const t = '<!-- heads: h1 -->\n## ui\nserver/public/ — 화면\n\n## server-x\ns\n## server\nlib/ — 저장\n';
  assert.equal(mapFor(t, 'ui'), 'server/public/ — 화면');
  assert.equal(mapFor(t, 'server'), 'lib/ — 저장');
  assert.equal(mapFor(t, 'none'), '');
  assert.ok(mapFresh(t, 'h1'));
  assert.ok(!mapFresh(t, 'h2'));
  assert.ok(!mapFresh(t, ''));
});

test('refreshMap: 커밋이 같으면 다시 만들지 않고, 실패하면 경로만 남긴다', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'squad-map-'));
  const g = (...a) => spawnSync('git', ['-C', dir, ...a], { windowsHide: true });
  g('init', '-q');
  fs.mkdirSync(path.join(dir, 'src'));
  fs.writeFileSync(path.join(dir, 'src', 'a.js'), '1');
  g('add', '.');
  g('-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-qm', 'x');
  let calls = 0;
  const o = { root: dir, projectId: 'p', projectPath: dir, members: [{ id: 'm', owns: ['src/**'] }, { id: 'n', owns: [] }] };
  const r1 = await refreshMap({ ...o, exec: async () => (calls++, { text: 'src/a.js — 시작점', isError: false }) });
  assert.deepEqual(r1.members, ['m']);
  assert.equal(mapFor(fs.readFileSync(r1.file, 'utf8'), 'm'), 'src/a.js — 시작점');
  const r2 = await refreshMap({ ...o, exec: async () => (calls++, { text: '', isError: true }) });
  assert.equal(r2.fresh, false);
  assert.equal(calls, 1);
  const r3 = await refreshMap({ ...o, force: true, exec: async () => ({ text: 'x', isError: true }) });
  assert.equal(mapFor(fs.readFileSync(r3.file, 'utf8'), 'm'), 'src/a.js');
  fs.rmSync(dir, { recursive: true, force: true });
});
