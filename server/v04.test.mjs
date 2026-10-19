// v0.4 보드 API: 예산 확인(409·429), inbox, 보고, 캡처 이름 검사, 상태의 예산·잠금 정보.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { startBoard } from './index.mjs';
import { appendJsonl } from '../lib/store.mjs';

test('보드 v0.4: 예산·inbox·보고·캡처', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'squad-v04srv-'));
  const proj = path.join(root, 'proj');
  for (const id of ['order', 'site']) {
    fs.mkdirSync(path.join(proj, '.squad', 'members', id), { recursive: true });
    fs.writeFileSync(path.join(proj, '.squad', 'members', id, 'MEMBER.md'), `---\nid: ${id}\nname: ${id}\n${id === 'site' ? 'budget: 500\n' : ''}---\n\n## 역할\n\n본문\n`);
  }
  fs.writeFileSync(path.join(root, 'projects.json'), JSON.stringify({ p: { name: 'P', path: proj } }));
  fs.writeFileSync(path.join(root, 'squad.config.json'), JSON.stringify({ budget: { daily: 1000, memberDaily: 300, task: 100 } }));
  const events = path.join(root, 'data', 'events.jsonl');
  const tasks = path.join(proj, '.squad', 'tasks.jsonl');
  appendJsonl(tasks, { id: 'T-a', member: 'site', title: 'A', status: 'todo' });
  appendJsonl(tasks, { id: 'T-b', member: 'site', title: 'B', status: 'todo', dependsOn: ['T-a'] });
  let planned = 0;
  const port = 5400 + Math.floor(Math.random() * 400);
  const board = await startBoard({
    root, port, quiet: true, token: 't', statuses: async () => [],
    planner: async () => (planned++, { plan: [{ member: 'site', title: 'x', detail: '', why: '', step: 1 }], usage: null }),
  });
  const base = `http://127.0.0.1:${port}`;
  const H = { Cookie: `${board.cookieName}=t` };
  const get = (p) => fetch(base + p, { headers: H });
  const post = (p, body) => fetch(base + p, { method: 'POST', headers: { ...H, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  try {
    let st = await (await get('/api/state?project=p')).json();
    assert.deepEqual(st.tasks.find((t) => t.id === 'T-b').waitingOn, ['T-a']);
    assert.equal(st.members.find((m) => m.id === 'site').budgetLimit, 500, 'MEMBER.md budget 이 덮어쓴다');
    assert.equal(st.budget.daily, 1000);

    // 예산 82% → 409 + 예산 승인 대기, 승인하면 계획이 돈다, 100% 넘으면 429
    appendJsonl(events, { at: new Date().toISOString(), project: 'p', member: 'site', type: 'end', usage: { input: 820 } });
    let r = await post('/api/order', { project: 'p', instruction: '해 줘' });
    assert.equal(r.status, 409);
    const body = await r.json();
    assert.equal(body.budget, 'warn');
    st = await (await get('/api/state?project=p')).json();
    const ap = st.approvals.find((a) => a.id === body.approvalId);
    assert.equal(ap.action, 'budget');
    assert.equal(ap.from, 'order');
    assert.equal((await post('/api/order', { project: 'p', instruction: '또' })).status, 409);
    assert.equal((await (await get('/api/state?project=p')).json()).counts.approvals, 1, '대기 중이면 또 만들지 않는다');
    assert.equal((await post('/api/approvals/decide', { project: 'p', id: body.approvalId, decision: 'approved' })).status, 200);
    assert.equal((await post('/api/order', { project: 'p', instruction: '해 줘' })).status, 200);
    assert.equal(planned, 1);
    appendJsonl(events, { at: new Date().toISOString(), project: 'p', member: 'site', type: 'end', usage: { input: 300 } });
    r = await post('/api/order', { project: 'p', instruction: '해 줘' });
    assert.equal(r.status, 429);
    assert.match((await r.json()).error, /예산 초과/);

    // inbox
    assert.equal((await post('/api/inbox', { project: 'p', text: ' ' })).status, 400);
    const ib = await (await post('/api/inbox', { project: 'p', text: '데스크톱에서 해 줘' })).json();
    assert.match(ib.id, /^I-/);
    st = await (await get('/api/state?project=p')).json();
    assert.equal(st.counts.inbox, 1);
    assert.equal(st.inbox[0].status, 'pending');

    // 보고: 만들기 → 목록 → 읽기, 잘못된 날짜
    const rep = await (await post('/api/report', { project: 'p' })).json();
    assert.match(rep.markdown, /일일 보고/);
    const list = await (await get('/api/reports?project=p')).json();
    assert.deepEqual(list.dates, [rep.date]);
    assert.match((await (await get(`/api/report?project=p&date=${rep.date}`)).json()).markdown, /## 토큰/);
    assert.equal((await get('/api/report?project=p&date=../../x')).status, 400);
    assert.equal((await post('/api/report', { project: 'p', date: '2026-13-01' })).status, 400);
    assert.ok(fs.existsSync(path.join(proj, '.squad', 'reports', `${rep.date}.md`)));

    // 캡처: 정해진 이름 모양만, data/captures 안에서만
    fs.mkdirSync(path.join(root, 'data', 'captures'), { recursive: true });
    fs.writeFileSync(path.join(root, 'data', 'captures', 'p-human-20261019-101010.png'), Buffer.from([0x89, 0x50]));
    r = await get('/api/capture?name=p-human-20261019-101010.png');
    assert.equal(r.status, 200);
    assert.equal(r.headers.get('content-type'), 'image/png');
    assert.equal((await get('/api/capture?name=..%2F..%2Fprojects.json')).status, 400);
    assert.equal((await get('/api/capture?name=p-human-20261019-000000.png')).status, 404);
    assert.equal((await fetch(`${base}/api/capture?name=p-human-20261019-101010.png`)).status, 401, '캡처도 접속 토큰이 필요하다');
  } finally {
    await board.close();
  }
});
