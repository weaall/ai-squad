import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { orderPrompt, runOrder, saveOrder } from './runner.mjs';
import { readJsonl } from './store.mjs';

const members = [
  { id: 'order', name: '메인 오더', runner: 'claude', model: '', owns: [], plugins: [], role: '분배' },
  { id: 'site', name: '사이트', runner: 'claude', model: '', owns: ['app/page.tsx'], plugins: [], role: '사이트 담당' },
];

function tmp() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'squad-run-'));
  const squad = path.join(root, 'proj', '.squad');
  fs.mkdirSync(squad, { recursive: true });
  fs.writeFileSync(path.join(root, 'ORDER.md'), '# 오더 규칙');
  fs.writeFileSync(path.join(squad, 'SQUAD.md'), '# 시험 스쿼드');
  const paths = { id: 'p', path: path.join(root, 'proj'), squad, tasks: path.join(squad, 'tasks.jsonl'), messages: path.join(squad, 'messages.jsonl') };
  return { root, paths };
}

test('dry 경로의 프롬프트 조립: 파일을 읽고 대기 작업 수를 센다', () => {
  const { root, paths } = tmp();
  try {
    fs.writeFileSync(paths.tasks, [{ member: 'site', status: 'todo' }, { member: 'site', status: 'done' }].map((t) => JSON.stringify(t)).join('\n'));
    const p = orderPrompt({ root, paths, members, instruction: '메인 페이지 손보기' });
    assert.match(p, /# 오더 규칙/);
    assert.match(p, /# 시험 스쿼드/);
    assert.match(p, /대기 작업: 1/);
    assert.match(p, /메인 페이지 손보기/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('계획 저장: 지시 1 + 작업·지시 메시지, 검증에 걸리면 아무것도 쓰지 않는다', () => {
  const { root, paths } = tmp();
  try {
    assert.throws(() => saveOrder({ paths, members, instruction: '지시', plan: [{ member: 'order', title: 'x' }] }));
    assert.equal(readJsonl(paths.messages).length, 0);
    const tasks = saveOrder({ paths, members, instruction: '지시', plan: [{ member: 'site', title: '제목', detail: '', why: '이유' }] });
    assert.equal(tasks.length, 1);
    const msgs = readJsonl(paths.messages);
    assert.deepEqual(msgs.map((m) => `${m.from}>${m.to}`), ['human>order', 'order>site']);
    assert.equal(msgs[1].taskId, tasks[0].id);
    assert.equal(msgs[1].text, '제목 — 이유');
    assert.equal(tasks[0].step, 1);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('실행 순서: step 오름차순, 같으면 들어온 순서', () => {
  const r = runOrder([{ t: 'a', step: 2 }, { t: 'b' }, { t: 'c', step: 1 }, { t: 'd', step: 2 }]);
  assert.deepEqual(r.map((x) => x.t), ['b', 'c', 'a', 'd']);
});
