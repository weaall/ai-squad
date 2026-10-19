// 입력 요청 API(/api/input/request·answer) 를 실제 보드 서버로 확인한다.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { startBoard } from '../server/index.mjs';

test('입력 요청 API: 토큰·자기 작업만·검증·중복·답하면 todo + answer 메시지', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'squad-input-'));
  const proj = path.join(root, 'proj');
  for (const id of ['order', 'site']) {
    fs.mkdirSync(path.join(proj, '.squad', 'members', id), { recursive: true });
    fs.writeFileSync(path.join(proj, '.squad', 'members', id, 'MEMBER.md'), `---\nid: ${id}\nname: ${id}\n---\n\n## 역할\n\n본문\n`);
  }
  fs.writeFileSync(path.join(root, 'projects.json'), JSON.stringify({ p: { name: 'P', path: proj } }));
  const port = 5300 + Math.floor(Math.random() * 500);
  const board = await startBoard({ root, port, quiet: true, token: 'tok-in', statuses: async () => [] });
  const base = `http://127.0.0.1:${port}`;
  const cookie = `${board.cookieName}=tok-in`;
  const post = (p, body, c = cookie) =>
    fetch(base + p, { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: c }, body: JSON.stringify(body) });
  try {
    const t = await (await post('/api/tasks', { project: 'p', title: '시안', member: 'site' })).json();
    const ask = {
      project: 'p', taskId: t.id, from: 'site', kind: 'choice', title: '시안 고르기',
      options: [{ id: 'a', label: 'A안', capture: 'site-t1-20261019-120000.png' }, { id: 'b', label: 'B안', capture: 'site-t1-20261019-120001.png' }],
    };
    assert.equal((await post('/api/input/request', ask, '')).status, 401);
    assert.equal((await post('/api/input/request', { ...ask, taskId: 'T-none' })).status, 404);
    assert.equal((await post('/api/input/request', { ...ask, from: 'order' })).status, 403);
    assert.equal((await post('/api/input/request', { ...ask, options: [] })).status, 400);
    assert.equal((await post('/api/input/answer', { project: 'p', taskId: t.id, choice: 'a' })).status, 409);

    const asked = await post('/api/input/request', ask);
    assert.equal(asked.status, 201);
    const waiting = (await asked.json()).task;
    assert.equal(waiting.status, 'input');
    assert.equal(waiting.input.kind, 'choice');
    assert.equal((await post('/api/input/request', ask)).status, 409);
    assert.equal((await post('/api/tasks/update', { project: 'p', id: t.id, patch: { status: 'input' } })).status, 400, '수동으로 input 으로 못 바꾼다');

    assert.equal((await post('/api/input/answer', { project: 'p', taskId: t.id, choice: 'zz' })).status, 400);
    const ans = await post('/api/input/answer', { project: 'p', taskId: t.id, choice: 'b', note: '파란 쪽' });
    assert.equal(ans.status, 200);
    const done = (await ans.json()).task;
    assert.equal(done.status, 'todo');
    assert.equal(done.input, undefined);
    assert.deepEqual(done.inputs.at(-1).answer, { choice: 'b', note: '파란 쪽' });

    const st = await (await fetch(`${base}/api/state?project=p`, { headers: { Cookie: cookie } })).json();
    assert.ok(st.messages.some((m) => m.from === 'human' && m.to === 'site' && m.kind === 'answer' && m.taskId === t.id));
  } finally {
    await board.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});
