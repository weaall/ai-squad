// 막힘 카드 단추 API(/api/task/:id/:act) 를 실제 보드 서버로 확인한다.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { startBoard } from '../server/index.mjs';

test('막힘 단추 API: 토큰·잘못된 동작 400·없는 작업 404·상태 전이·메시지·대기열', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'squad-blocked-'));
  const proj = path.join(root, 'proj');
  for (const id of ['order', 'site', 'ui']) {
    fs.mkdirSync(path.join(proj, '.squad', 'members', id), { recursive: true });
    fs.writeFileSync(path.join(proj, '.squad', 'members', id, 'MEMBER.md'), `---\nid: ${id}\nname: ${id}\n---\n\n## 역할\n\n본문\n`);
  }
  fs.writeFileSync(path.join(root, 'projects.json'), JSON.stringify({ p: { name: 'P', path: proj } }));
  const port = 5300 + Math.floor(Math.random() * 500);
  let ran = 0;
  const queue = async () => (ran++, { ran: 0, blocked: 0 });
  const board = await startBoard({ root, port, quiet: true, token: 'tok-b', statuses: async () => [], queue });
  const base = `http://127.0.0.1:${port}`;
  const cookie = `${board.cookieName}=tok-b`;
  const post = (p, body, c = cookie) =>
    fetch(base + p, { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: c }, body: JSON.stringify(body) });
  const newTask = async () => (await (await post('/api/tasks', { project: 'p', title: '로고', detail: '본문', member: 'site', status: 'blocked' })).json()).id;
  try {
    const id = await newTask();
    assert.equal((await post(`/api/task/${id}/retry`, { project: 'p' }, '')).status, 401);
    assert.equal((await post(`/api/task/${id}/rm`, { project: 'p' })).status, 400);
    assert.equal((await post('/api/task/T-none/retry', { project: 'p' })).status, 404);
    assert.equal((await post(`/api/task/${id}/reassign`, { project: 'p', member: 'ghost' })).status, 400);

    const re = await post(`/api/task/${id}/retry`, { project: 'p', note: '경로 바꿔서' });
    assert.equal(re.status, 200);
    const r = await re.json();
    assert.equal(r.task.status, 'todo');
    assert.equal(r.task.summary, '');
    assert.match(r.task.detail, /^본문\n\n\[재시도 메모\] 경로 바꿔서$/);
    assert.equal(r.queue, 'started');

    const ra = await (await post(`/api/task/${id}/reassign`, { project: 'p', member: 'ui', note: '화면 쪽' })).json();
    assert.equal(ra.task.member, 'ui');
    assert.equal(ra.task.status, 'todo');

    const dn = await (await post(`/api/task/${id}/done`, { project: 'p', note: '손으로 고침' })).json();
    assert.equal(dn.task.status, 'done');
    assert.equal(dn.task.summary, '사람이 완료 처리 — 손으로 고침');
    assert.equal(dn.queue, 'off');

    const cid = await newTask();
    const cc = await (await post(`/api/task/${cid}/cancel`, { project: 'p' })).json();
    assert.equal(cc.task.status, 'cancelled');

    const st = await (await fetch(`${base}/api/state?project=p`, { headers: { Cookie: cookie } })).json();
    const mine = st.messages.filter((m) => m.from === 'human' && m.taskId === id);
    assert.deepEqual(mine.map((m) => [m.to, m.kind]), [['site', 'note'], ['ui', 'handoff'], ['ui', 'note']]);
    assert.ok(ran >= 1);

    // 참고: done/cancel 시 멤버의 마지막 이벤트가 start면 end 이벤트가 추가된다.
    // 이 테스트에서는 start 이벤트가 없어서(task만 만들고 실행 안 함) end 이벤트가 안 만들어진다.
    // 통합 테스트는 server/index.test.mjs에서 확인한다.
  } finally {
    await board.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});
