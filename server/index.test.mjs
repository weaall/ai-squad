import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { startBoard } from './index.mjs';
import { appendJsonl } from '../lib/store.mjs';

test('보드 서버: 상태·POST·SSE·보안', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'squad-srv-'));
  const proj = path.join(root, 'proj');
  for (const id of ['order', 'site']) {
    fs.mkdirSync(path.join(proj, '.squad', 'members', id), { recursive: true });
    fs.writeFileSync(path.join(proj, '.squad', 'members', id, 'MEMBER.md'), `---\nid: ${id}\nname: ${id}\n---\n`);
  }
  fs.writeFileSync(path.join(root, 'projects.json'), JSON.stringify({ p: { name: 'P', path: proj } }));
  const port = 4800 + Math.floor(Math.random() * 500);
  const board = await startBoard({ root, port, quiet: true });
  const base = `http://127.0.0.1:${port}`;
  try {
    const st = await (await fetch(`${base}/api/state?project=p`)).json();
    assert.equal(st.members.length, 2);
    assert.match(await (await fetch(base + '/')).text(), /AI Squad/);
    assert.equal((await fetch(`${base}/api/state?project=..`)).status, 404);
    assert.equal((await fetch(`${base}/..%2F..%2Fpackage.json`)).status, 404);

    const post = (p, body, headers = {}) =>
      fetch(base + p, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) });
    assert.equal((await post('/api/messages', { project: 'p', from: 'human', to: 'site', text: '안녕' })).status, 201);
    assert.equal((await post('/api/messages', { project: 'p', from: 'evil', to: 'site', text: 'x' })).status, 400);
    assert.equal((await post('/api/messages', { project: 'p', from: 'human', to: 'site', text: 'x' }, { Origin: 'http://evil.test' })).status, 403);
    const t = await (await post('/api/tasks', { project: 'p', title: '할 일', member: 'site' })).json();
    assert.equal((await post('/api/tasks/update', { project: 'p', id: t.id, patch: { status: 'doing' } })).status, 200);

    // SSE: 이벤트 파일이 바뀌면 change 를 민다
    const got = await new Promise((resolve, reject) => {
      let appended = false;
      const req = http.get(`${base}/api/stream?project=p`, (res) => {
        let buf = '';
        res.on('data', (c) => {
          buf += c;
          if (buf.includes('event: hello') && !appended) {
            appended = true;
            appendJsonl(path.join(root, 'data', 'events.jsonl'), { at: new Date().toISOString(), project: 'p', member: 'site', type: 'log', text: '시험' });
          }
          if (buf.includes('event: change')) {
            clearTimeout(timer);
            req.destroy();
            resolve(true);
          }
        });
      });
      req.on('error', () => {});
      const timer = setTimeout(() => reject(new Error('SSE change 가 오지 않음')), 5000);
    });
    assert.ok(got);
  } finally {
    await board.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});
