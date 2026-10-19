import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { readCookie, startBoard } from './index.mjs';
import { appendJsonl } from '../lib/store.mjs';
import { requestApproval } from '../lib/approvals.mjs';

test('쿠키 읽기', () => {
  assert.equal(readCookie('a=1; squad_t_1=x%3Dy; b=2', 'squad_t_1'), 'x=y');
  assert.equal(readCookie('', 'a'), '');
  assert.equal(readCookie('a=%E0%A4%A', 'a'), '');
});

test('보드 서버: 토큰·상태·POST·승인·켜기끄기·SSE·보안', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'squad-srv-'));
  const proj = path.join(root, 'proj');
  for (const id of ['order', 'site']) {
    fs.mkdirSync(path.join(proj, '.squad', 'members', id), { recursive: true });
    fs.writeFileSync(path.join(proj, '.squad', 'members', id, 'MEMBER.md'), `---\nid: ${id}\nname: ${id}\nheadroom: false\nplugins: [dataviz, design:ux-copy]\n---\n\n## 역할\n\n본문\n`);
  }
  fs.writeFileSync(path.join(root, 'projects.json'), JSON.stringify({ p: { name: 'P', path: proj } }));
  const port = 4800 + Math.floor(Math.random() * 500);
  let release;
  const planner = async ({ instruction }) => {
    if (instruction === '실패') throw new Error('claude 없음');
    await new Promise((r) => (release = r));
    return { plan: [{ member: 'site', title: '메인 손보기', detail: '', why: '사이트 담당', step: 1 }], usage: { input: 10, output: 5, cacheRead: 0, cacheWrite: 0 } };
  };
  let logins = 0;
  const board = await startBoard({
    root, port, quiet: true, planner, token: 'tok-123', openLogin: () => logins++,
    statuses: async () => [{ name: 'claude', state: 'login', canLogin: true }],
  });
  const base = `http://127.0.0.1:${port}`;
  const cookie = `${board.cookieName}=tok-123`;
  const get = (p, headers = {}) => fetch(base + p, { headers: { Cookie: cookie, ...headers }, redirect: 'manual' });
  const post = (p, body, headers = {}) =>
    fetch(base + p, { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: cookie, ...headers }, body: JSON.stringify(body) });
  try {
    // 토큰: 없으면 401, ?t= 가 맞으면 HttpOnly 쿠키 + 주소에서 지운 곳으로, 틀리면 401
    assert.equal((await fetch(`${base}/api/state?project=p`)).status, 401);
    assert.equal((await fetch(`${base}/api/stream?project=p`)).status, 401);
    assert.equal((await fetch(`${base}/api/messages`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })).status, 401);
    assert.equal((await fetch(`${base}/?t=wrong`, { redirect: 'manual' })).status, 401);
    const first = await fetch(`${base}/?t=tok-123#x`, { redirect: 'manual' });
    assert.equal(first.status, 302);
    assert.equal(first.headers.get('location'), '/');
    assert.match(first.headers.get('set-cookie'), /HttpOnly/);
    assert.match(first.headers.get('set-cookie'), /SameSite=Strict/);
    assert.equal((await fetch(base + '/')).status, 200, '화면 파일은 토큰 없이도 받는다(안내를 보여 주려고)');
    const logo = await fetch(base + '/brand/logo.png');
    assert.equal(logo.status, 200, '로고·파비콘도 토큰 없이');
    assert.equal(logo.headers.get('content-type'), 'image/png');

    const st = await (await get('/api/state?project=p')).json();
    assert.equal(st.members.length, 2);
    assert.deepEqual(st.members[1].pluginList, [{ name: 'dataviz', on: true }, { name: 'design:ux-copy', on: true }]);
    assert.match(await (await get('/')).text(), /AI Squad/);
    assert.equal((await get('/api/state?project=..')).status, 404);
    assert.equal((await get('/..%2F..%2Fpackage.json')).status, 404);
    // fetch 는 Host 를 못 바꾼다 → http.get 으로 DNS 리바인딩 막기 확인
    const hostStatus = await new Promise((r) => http.get(`${base}/api/state?project=p`, { headers: { Host: 'evil.test', Cookie: cookie } }, (res) => (res.resume(), r(res.statusCode))));
    assert.equal(hostStatus, 403);

    assert.equal((await post('/api/messages', { project: 'p', from: 'human', to: 'site', text: '안녕' })).status, 201);
    assert.equal((await post('/api/messages', { project: 'p', from: 'evil', to: 'site', text: 'x' })).status, 400);
    assert.equal((await post('/api/messages', { project: 'p', from: 'human', to: 'site', text: 'x' }, { Origin: 'http://evil.test' })).status, 403);
    const t = await (await post('/api/tasks', { project: 'p', title: '할 일', member: 'site' })).json();
    assert.equal((await post('/api/tasks/update', { project: 'p', id: t.id, patch: { status: 'doing' } })).status, 200);

    // 오더: 빈 지시 400("지시를 입력하세요"), 진행 중 409, 실패 502, 확인하면 작업·지시 저장, 계획 사용량은 이벤트로
    const empty = await post('/api/order', { project: 'p', instruction: '  ' });
    assert.equal(empty.status, 400);
    assert.equal((await empty.json()).error, '지시를 입력하세요');
    assert.equal((await post('/api/order', { project: 'p', instruction: 'x'.repeat(1001) })).status, 400);
    const pending = post('/api/order', { project: 'p', instruction: '메인 손보기' });
    while (!release) await new Promise((r) => setTimeout(r, 10));
    assert.equal((await post('/api/order', { project: 'p', instruction: '또' })).status, 409);
    release();
    const planRes = await pending;
    assert.equal(planRes.status, 200);
    const { plan } = await planRes.json();
    assert.equal(plan[0].member, 'site');
    const fail = await post('/api/order', { project: 'p', instruction: '실패' });
    assert.equal(fail.status, 502);
    assert.match((await fail.json()).error, /claude 없음/);
    assert.equal((await post('/api/order/confirm', { project: 'p', instruction: '메인 손보기', plan: [{ member: 'order', title: 'x' }] })).status, 400);
    assert.equal((await post('/api/order/confirm', { project: 'p', instruction: '메인 손보기', plan })).status, 201);
    const after = await (await get('/api/state?project=p')).json();
    assert.ok(after.tasks.some((x) => x.title === '메인 손보기' && x.createdBy === 'order' && x.step === 1));
    assert.ok(after.messages.some((m) => m.from === 'order' && m.to === 'site' && m.kind === 'order'));
    assert.equal(after.members.find((m) => m.id === 'order').tokens.today, 15);
    assert.equal(after.tokensToday.total, 15);

    // 승인 대기: 요청 → 상태에 보임 → 거절(사유) → 요청한 멤버에게 answer, 두 번째 결정은 409
    const req = requestApproval({ approvals: path.join(proj, '.squad', 'approvals.jsonl') }, { from: 'site', action: 'push', text: 'dev 에 push', scope: 'qugo_fe_web' });
    const st2 = await (await get('/api/state?project=p')).json();
    assert.equal(st2.counts.approvals, 1);
    assert.equal(st2.approvals[0].scope, 'qugo_fe_web');
    assert.equal((await post('/api/approvals/decide', { project: 'p', id: req.id, decision: 'maybe' })).status, 400);
    const dec = await post('/api/approvals/decide', { project: 'p', id: req.id, decision: 'rejected', note: '테스트 먼저' });
    assert.equal(dec.status, 200);
    assert.equal((await post('/api/approvals/decide', { project: 'p', id: req.id, decision: 'approved' })).status, 409);
    const st3 = await (await get('/api/state?project=p')).json();
    assert.equal(st3.counts.approvals, 0);
    assert.ok(st3.messages.some((m) => m.from === 'human' && m.to === 'site' && m.kind === 'answer' && /거절.*테스트 먼저/.test(m.text)));

    // 켜기·끄기: MEMBER.md frontmatter 의 그 값만 바뀐다
    const mdFile = path.join(proj, '.squad', 'members', 'site', 'MEMBER.md');
    assert.equal((await post('/api/member/toggle', { project: 'p', id: 'site', kind: 'plugin', name: 'ghost', on: false })).status, 400);
    assert.equal((await post('/api/member/toggle', { project: 'p', id: 'site', kind: 'model', on: false })).status, 400);
    const tg = await (await post('/api/member/toggle', { project: 'p', id: 'site', kind: 'plugin', name: 'dataviz', on: false })).json();
    assert.deepEqual(tg.pluginList, [{ name: 'dataviz', on: false }, { name: 'design:ux-copy', on: true }]);
    assert.equal((await post('/api/member/toggle', { project: 'p', id: 'site', kind: 'headroom', on: true })).status, 200);
    const md = fs.readFileSync(mdFile, 'utf8');
    assert.match(md, /headroom: true/);
    assert.match(md, /  dataviz: false/);
    assert.match(md, /## 역할\n\n본문\n$/);

    // runner 상태·로그인 창
    const rs = await (await get('/api/runners')).json();
    assert.equal(rs.runners[0].state, 'login');
    assert.equal((await post('/api/runners/login', { runner: 'claude' })).status, 200);
    assert.equal(logins, 1);
    assert.equal((await post('/api/runners/login', { runner: 'nope' })).status, 404);
    assert.equal((await post('/api/runners/login', { runner: 'claude' }, { Cookie: '' })).status, 401);

    // SSE: 이벤트 파일이 바뀌면 change 를 민다
    const got = await new Promise((resolve, reject) => {
      let appended = false;
      const req2 = http.get(`${base}/api/stream?project=p`, { headers: { Cookie: cookie } }, (res) => {
        let buf = '';
        res.on('data', (c) => {
          buf += c;
          if (buf.includes('event: hello') && !appended) {
            appended = true;
            appendJsonl(path.join(root, 'data', 'events.jsonl'), { at: new Date().toISOString(), project: 'p', member: 'site', type: 'log', text: '시험' });
          }
          if (buf.includes('event: change')) {
            clearTimeout(timer);
            req2.destroy();
            resolve(true);
          }
        });
      });
      req2.on('error', () => {});
      const timer = setTimeout(() => reject(new Error('SSE change 가 오지 않음')), 5000);
    });
    assert.ok(got);
  } finally {
    await board.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});
