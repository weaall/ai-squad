// 보드 /api/order 자동 배정: 확인이 필요 없으면 바로 저장하고 대기열을 백그라운드로, 필요하면 확인 대기
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { startBoard } from '../server/index.mjs';
import { readJsonl } from './store.mjs';
import { buildRunPrompt } from './claude.mjs';

test('/api/order: 평범한 계획은 바로 배정·대기열 시작, 위험하면 확인 대기', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'squad-auto-'));
  const proj = path.join(root, 'proj');
  for (const id of ['order', 'site']) {
    fs.mkdirSync(path.join(proj, '.squad', 'members', id), { recursive: true });
    fs.writeFileSync(path.join(proj, '.squad', 'members', id, 'MEMBER.md'), `---\nid: ${id}\nname: ${id}\n---\n\n## 역할\n\n본문\n`);
  }
  fs.writeFileSync(path.join(root, 'projects.json'), JSON.stringify({ p: { name: 'P', path: proj } }));
  const tasksFile = path.join(proj, '.squad', 'tasks.jsonl');
  const port = 6200 + Math.floor(Math.random() * 400);
  let finish;
  const runs = [];
  const board = await startBoard({
    root, port, quiet: true, token: 't', statuses: async () => [],
    planner: async ({ instruction }) => ({ plan: [{ member: 'site', title: instruction, detail: '', why: '', step: 1 }], usage: null }),
    queue: (o) => (runs.push(o), new Promise((r) => (finish = r))),
  });
  const post = (body) =>
    fetch(`http://127.0.0.1:${port}/api/order`, { method: 'POST', headers: { Cookie: `${board.cookieName}=t`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  try {
    let r = await (await post({ project: 'p', instruction: '메인 문구 손보기' })).json();
    assert.equal(r.needsConfirm, false);
    assert.equal(r.queue, 'started');
    assert.equal(r.tasks.length, 1);
    assert.equal(readJsonl(tasksFile).length, 1);
    assert.equal(runs.length, 1);
    assert.equal(await runs[0].gate('site', '실행 · x', r.tasks[0].id), true);

    r = await (await post({ project: 'p', instruction: '푸터 고치기' })).json();
    assert.equal(r.queue, 'running', '이미 도는 대기열은 다시 띄우지 않는다');
    assert.equal(runs.length, 1);
    finish({ ran: 2, blocked: 0, stoppedBy: '' });
    await new Promise((res) => setTimeout(res, 20));
    assert.ok(readJsonl(path.join(root, 'data', 'events.jsonl')).some((e) => e.type === 'queue' && /실행 2건/.test(e.text)));

    r = await (await post({ project: 'p', instruction: '운영 서버에 배포' })).json();
    assert.equal(r.needsConfirm, true);
    assert.match(r.reasons[0], /위험/);
    assert.equal(r.tasks, undefined);
    assert.equal(readJsonl(tasksFile).length, 2, '확인 대기 계획은 저장하지 않는다');
  } finally {
    await board.close();
  }
});

test('멤버 실행 프롬프트에 모호할 때 ask 입력 요청 안내', () => {
  const p = buildRunPrompt({ memberMd: '', notesMd: '', task: { id: 'T-a', title: 'x' }, squadRoot: '/s', project: 'qugo', member: 'site' });
  assert.match(p, /ask qugo site form/);
});
