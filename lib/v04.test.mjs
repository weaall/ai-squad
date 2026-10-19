// v0.4 순수 함수: 예산, 의존·동시 실행 선택, 보고 조립, inbox 상태 전이, 검수, 승인 상세.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { checkBudget, memberLimit, overTaskCap, usageMeter, usageOn } from './budget.mjs';
import { findCycle, ownsOverlap, pickRunnable, waitingOn } from './queue.mjs';
import { buildReport, dateKey, isDateKey } from './report.mjs';
import { foldInbox, inboxStep } from './inbox.mjs';
import { parseNumstat, parseVerdict, reviewerFor, summarizeDiff } from './review.mjs';
import { budgetApproved, foldApprovals, validateApprovalDetails, validateApprovalRequest } from './approvals.mjs';
import { cleanDeps, parsePlan, readStreamLine } from './claude.mjs';
import { validatePlan, validateTask } from './validate.mjs';
import { normalizeConfig } from './config.mjs';
import { saveOrder } from './runner.mjs';
import { readJsonl } from './store.mjs';

const B = { daily: 1000, memberDaily: 400, task: 300, warn: 0.8 };

test('예산: 80% 경고, 100% 초과, 상한 없음, 멤버 덮어쓰기', () => {
  assert.equal(checkBudget({ budget: B, used: 500, memberUsed: 100, memberCap: 400 }).level, 'ok');
  assert.equal(checkBudget({ budget: B, used: 810, memberUsed: 0, memberCap: 400 }).level, 'warn');
  const m = checkBudget({ budget: B, used: 100, memberUsed: 400, memberCap: 400 });
  assert.equal(m.level, 'over', '멤버 하루 상한이 먼저 차면 그것으로 판단');
  assert.match(m.reason, /이 멤버/);
  assert.equal(checkBudget({ budget: { daily: 0, memberDaily: 0, task: 0, warn: 0.8 }, used: 1e9 }).level, 'ok');
  assert.equal(memberLimit(B, { budget: 50 }), 50);
  assert.equal(memberLimit(B, { budget: 0 }), 400);
  assert.equal(overTaskCap(B, 301), true);
  assert.equal(overTaskCap({ ...B, task: 0 }, 1e9), false);
  const now = Date.parse('2026-10-19T12:00:00');
  const u = usageOn([
    { at: '2026-10-19T09:00:00', member: 'a', usage: { input: 10, output: 5 } },
    { at: '2026-10-18T09:00:00', member: 'a', usage: { input: 999 } },
    { at: '2026-10-19T10:00:00', member: 'b', usage: { cacheRead: 20 } },
  ], now);
  assert.deepEqual(u, { total: 35, byMember: { a: 15, b: 20 } });
});

test('실행 중 사용량: 같은 메시지 id 는 마지막 값만', () => {
  const m = usageMeter();
  assert.equal(m.add('m1', { input: 10, output: 1 }), 11);
  assert.equal(m.add('m1', { input: 10, output: 5 }), 15);
  assert.equal(m.add('m2', { input: 3 }), 18);
  assert.equal(m.usage().input, 13);
  const line = JSON.stringify({ type: 'assistant', message: { id: 'x', content: [{ type: 'text', text: 'hi' }], usage: { input_tokens: 7, output_tokens: 2 } } });
  assert.deepEqual(readStreamLine(line), { tools: [], usage: { input: 7, output: 2, cacheRead: 0, cacheWrite: 0 }, msgId: 'x' });
});

test('설정: budget·review·report 기본값과 검증', () => {
  const c = normalizeConfig({ budget: { daily: 100, memberDaily: -1, warn: 3 }, review: { default: 'Bad Id' }, report: { copyTo: ' G:/x ' } });
  assert.deepEqual(c.budget, { daily: 100, memberDaily: 0, task: 0, warn: 0.8 });
  assert.equal(c.review.default, '');
  assert.equal(c.report.copyTo, 'G:/x');
});

test('owns 겹침: 고정 부분 앞부분 비교', () => {
  assert.equal(ownsOverlap(['fe/app/**'], ['fe/app/org/**']), true);
  assert.equal(ownsOverlap(['fe/app/org/**'], ['fe/app/admin/**']), false);
  assert.equal(ownsOverlap(['fe/app/page.tsx'], ['fe/app/**']), true);
  assert.equal(ownsOverlap(['fe/app/page.tsx'], ['fe/app/sitemap.ts']), false);
  assert.equal(ownsOverlap(['be/src/**'], ['fe/**']), false);
  assert.equal(ownsOverlap([], ['fe/**']), false);
});

test('의존·고리', () => {
  const byId = new Map([['T-a', { id: 'T-a', status: 'done' }], ['T-b', { id: 'T-b', status: 'todo' }]]);
  assert.deepEqual(waitingOn({ dependsOn: ['T-a', 'T-b', 'T-ghost'] }, byId), ['T-b']);
  assert.equal(findCycle(new Map([['a', ['b']], ['b', ['c']], ['c', []]])), null);
  assert.ok(findCycle(new Map([['a', ['b']], ['b', ['a']]])));
});

test('대기열 고르기: 의존이 풀린 것, owns 안 겹치는 멤버끼리, 상한, 검수 먼저', () => {
  const members = [
    { id: 'order', owns: ['.squad/**'] },
    { id: 'fe-a', owns: ['fe/app/a/**'] },
    { id: 'fe-all', owns: ['fe/app/**'] },
    { id: 'be', owns: ['be/src/**'] },
    { id: 'ext', owns: ['x/**'], runner: 'external' },
    { id: 'rev', owns: [] },
  ];
  const t = (id, member, extra = {}) => ({ id, member, status: 'todo', createdAt: id, ...extra });
  const tasks = [
    t('T-1', 'fe-a'),
    t('T-2', 'fe-all'), // fe-a 와 겹친다 → 기다림
    t('T-3', 'be', { dependsOn: ['T-1'] }), // 선행 남음
    t('T-4', 'be'),
    t('T-5', 'ext'),
    t('T-6', 'fe-a'), // 같은 멤버 → 하나만
  ];
  let picks = pickRunnable({ tasks, members, max: 3 });
  assert.deepEqual(picks.map((p) => p.task.id), ['T-1', 'T-4']);
  picks = pickRunnable({ tasks, members, max: 1 });
  assert.deepEqual(picks.map((p) => p.task.id), ['T-1'], '동시 실행 상한');
  picks = pickRunnable({ tasks, members, running: [{ member: 'be', kind: 'run' }], max: 2 });
  assert.deepEqual(picks.map((p) => p.task.id), ['T-1']);
  // 검수 대기는 검수 멤버가, 먼저
  const rv = [{ id: 'T-9', member: 'fe-a', status: 'review', reviewer: 'rev' }, ...tasks];
  picks = pickRunnable({ tasks: rv, members, max: 2 });
  assert.deepEqual(picks.map((p) => [p.kind, p.member]), [['review', 'rev'], ['run', 'fe-a']]);
  // 선행이 끝나면 풀린다
  const done = tasks.map((x) => (x.id === 'T-1' ? { ...x, status: 'done' } : x));
  assert.ok(pickRunnable({ tasks: done, members, max: 4 }).some((p) => p.task.id === 'T-3'));
});

test('계획 의존: key 정리, 고리 거부, 저장 때 작업 id 로', () => {
  const plan = cleanDeps([{ key: 'a', dependsOn: ['b', 'a', 'zz'] }, { key: 'b' }, { key: 'a' }]);
  assert.deepEqual(plan.map((p) => [p.key, p.dependsOn]), [['a', ['b']], ['b', []], ['k3', []]]);
  const parsed = parsePlan(JSON.stringify([{ key: 'x', member: 's', title: 'A' }, { key: 'y', member: 's', title: 'B', dependsOn: ['x'] }]), ['s']);
  assert.deepEqual(parsed[1].dependsOn, ['x']);
  assert.match(validatePlan([{ key: 'a', member: 's', title: 'A', dependsOn: ['b'] }, { key: 'b', member: 's', title: 'B', dependsOn: ['a'] }], ['order', 's']).error, /고리/);
  assert.match(validateTask({ title: 'a', member: 's', dependsOn: ['nope'] }, ['s']).error, /선행/);

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'squad-v04-'));
  const paths = { tasks: path.join(dir, 't.jsonl'), messages: path.join(dir, 'm.jsonl') };
  const saved = saveOrder({ paths, members: [{ id: 'order' }, { id: 's' }], instruction: '지시', plan: validatePlan(parsed, ['order', 's']).plan });
  assert.deepEqual(saved[1].dependsOn, [saved[0].id]);
  assert.equal(readJsonl(paths.tasks).length, 2);
});

test('일일 보고: 한 일·막힌 일·내일 할 일·토큰', () => {
  const day = '2026-10-19';
  const r = buildReport({
    project: { id: 'p', name: 'P' }, date: day, budget: { daily: 1000 },
    members: [{ id: 'a', name: '가' }, { id: 'b', name: '나' }],
    tasks: [
      { id: 'T-1', member: 'a', title: '끝낸 일', status: 'done', updatedAt: `${day}T10:00:00`, summary: '요약\n둘째 줄', usage: { input: 100 } },
      { id: 'T-0', member: 'a', title: '어제 끝낸 일', status: 'done', updatedAt: '2026-10-18T10:00:00' },
      { id: 'T-2', member: 'b', title: '막힌 일', status: 'blocked', summary: '예산 초과' },
      { id: 'T-3', member: 'b', title: '다음 일', status: 'todo', dependsOn: ['T-2'], step: 2 },
      { id: 'T-4', member: 'a', title: '검수 일', status: 'review' },
    ],
    messages: [{ at: `${day}T09:00:00`, kind: 'handoff' }, { at: `${day}T09:10:00`, kind: 'handoff' }, { at: '2026-10-18T09:00:00', kind: 'order' }],
    approvals: [{ status: 'pending', from: 'b', action: 'migrate', text: '로컬 DB' }],
    events: [{ at: `${day}T10:00:00`, member: 'a', usage: { input: 600 } }, { at: '2026-10-18T10:00:00', member: 'a', usage: { input: 5 } }],
  });
  const md = r.markdown;
  assert.match(md, /# P 일일 보고 — 2026-10-19/);
  assert.match(md, /## 한 일 \(1\)\n- 가: 끝낸 일 — 요약 \(100토큰\)/);
  assert.doesNotMatch(md, /어제 끝낸 일/);
  assert.match(md, /## 막힌 일 \(2\)/);
  assert.match(md, /승인 대기 · 나: DB 마이그레이션 — 로컬 DB/);
  assert.match(md, /\[2\] 나: 다음 일 \(선행 대기: 막힌 일\)/);
  assert.match(md, /검수 일 \(검수 대기\)/);
  assert.match(md, /오늘 600토큰 \/ 상한 1,000 \(60%\)/);
  assert.match(md, /메시지 2건 \(인계 2\)/);
  assert.deepEqual(r.counts, { done: 1, blocked: 2, next: 2, tokens: 600, messages: 2 });
  assert.equal(isDateKey('2026-02-30'), false);
  assert.equal(isDateKey(dateKey(Date.now())), true);
});

test('inbox 상태 전이: 대기 → 처리 중 → 끝, 거꾸로·건너뛰기는 무시', () => {
  const add = { type: 'add', id: 'I-1', at: 't0', text: '지시' };
  assert.equal(inboxStep({ status: 'pending' }, { type: 'done' }), null, '가져오지 않고 끝낼 수 없다');
  assert.equal(inboxStep({ status: 'taking' }, { type: 'take' }), null);
  const rows = [add, { type: 'done', id: 'I-1', at: 't1', result: 'x' }, { type: 'take', id: 'I-1', at: 't2' }, { type: 'take', id: 'I-1', at: 't3' }, { type: 'done', id: 'I-1', at: 't4', result: '결과' }, { type: 'take', id: 'I-ghost' }];
  assert.deepEqual(foldInbox(rows), [{ id: 'I-1', at: 't0', from: 'human', text: '지시', status: 'done', takenAt: 't2', doneAt: 't4', result: '결과' }]);
});

test('검수: numstat 읽기, diff 요약 상한, 판정 읽기, 검수 멤버 고르기', () => {
  const st = parseNumstat('3\t1\tapp/a.ts\n-\t-\timg.png\n5\t0\tsrc/{old => new}.ts\n', 'fe/');
  assert.deepEqual(st, [{ path: 'fe/app/a.ts', add: 3, del: 1 }, { path: 'fe/img.png', add: 0, del: 0 }, { path: 'fe/src/new.ts', add: 5, del: 0 }]);
  const s = summarizeDiff(st, 2);
  assert.match(s, /^파일 3개, \+8 -1/);
  assert.match(s, /외 1개 파일/);
  assert.equal(summarizeDiff([]), '(바뀐 파일 없음)');
  assert.deepEqual(parseVerdict('{"verdict":"pass","note":"좋음"}'), { pass: true, note: '좋음' });
  assert.deepEqual(parseVerdict(JSON.stringify({ result: '판단: {"verdict": "reject", "note": "테스트 없음"}' })), { pass: false, note: '테스트 없음' });
  assert.equal(parseVerdict('모르겠음').pass, false);
  assert.equal(reviewerFor({ id: 'a', reviewer: 'b' }, { default: 'c' }, ['a', 'b', 'c']), 'b');
  assert.equal(reviewerFor({ id: 'a' }, { default: 'c' }, ['a', 'b', 'c']), 'c');
  assert.equal(reviewerFor({ id: 'c' }, { default: 'c' }, ['c']), '', '자기 자신은 검수하지 않는다');
});

test('승인 상세: 길이·종류 검증, 위험도 한국어, 예산 승인은 그날만', () => {
  const ok = validateApprovalDetails({ details: ' 설명 ', files: ['a', 'b'], diff: '+x\r\n', commands: 'npm run x', risk: '높음', rollback: '되돌림' });
  assert.deepEqual(ok, { details: { details: '설명', diff: '+x', files: ['a', 'b'], commands: ['npm run x'], risk: 'high', rollback: '되돌림' } });
  assert.match(validateApprovalDetails({ diff: 'x'.repeat(20 * 1024 + 1) }).error, /20KB/);
  assert.match(validateApprovalDetails({ diff: '가'.repeat(7000) }).error, /20KB/, '바이트로 센다');
  assert.match(validateApprovalDetails({ risk: '매우' }).error, /위험도/);
  assert.match(validateApprovalDetails({ files: Array(101).fill('a') }).error, /파일 목록/);
  assert.match(validateApprovalDetails({ commands: [''] }).error, /명령/);
  assert.deepEqual(validateApprovalDetails({}), { details: {} });
  const v = validateApprovalRequest({ from: 'b', action: 'migrate', text: '로컬', risk: 'low', files: ['x'] }, ['b']);
  assert.equal(v.risk, 'low');
  assert.deepEqual(v.files, ['x']);
  assert.equal(validateApprovalRequest({ from: 'order', action: 'budget', text: '예산' }, ['order']).action, 'budget');
  const now = Date.parse('2026-10-19T12:00:00');
  const ap = foldApprovals([
    { type: 'request', id: 'A-1', from: 'order', action: 'budget', text: 'x' },
    { type: 'decision', id: 'A-1', at: '2026-10-19T11:00:00', decision: 'approved', by: 'human' },
    { type: 'request', id: 'A-2', from: 'site', action: 'budget', text: 'x' },
    { type: 'decision', id: 'A-2', at: '2026-10-18T11:00:00', decision: 'approved', by: 'human' },
  ]);
  assert.equal(budgetApproved(ap, 'order', now), true);
  assert.equal(budgetApproved(ap, 'site', now), false, '어제 승인은 오늘 쓰지 않는다');
});

test('run-queue: 의존 순서, 겹치지 않는 멤버 동시 실행, 검수 통과까지 (command runner)', async () => {
  const { runQueue } = await import('./runner.mjs');
  const { loadMembers, projectPaths, appendJsonl } = await import('./store.mjs');
  const { spawnSync } = await import('node:child_process');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'squad-queue-'));
  try {
    const proj = path.join(root, 'proj');
    const mem = (id, extra) => {
      fs.mkdirSync(path.join(proj, '.squad', 'members', id), { recursive: true });
      fs.writeFileSync(path.join(proj, '.squad', 'members', id, 'MEMBER.md'), `---\nid: ${id}\n${extra}\n---\n\n## 지금 작업\n`);
    };
    mem('order', 'runner: claude');
    mem('a', 'runner: fa\nowns:\n  - a/**');
    mem('b', 'runner: fb\nreviewer: r\nowns:\n  - b/**');
    mem('r', 'runner: fr');
    const git = (...args) => spawnSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', ...args], { cwd: proj });
    if (git('init', '-q').status !== 0) return; // git 이 없으면 건너뛴다
    fs.writeFileSync(path.join(proj, 'README'), 'x');
    git('add', 'README');
    git('commit', '-qm', 'init');
    fs.writeFileSync(path.join(root, 'projects.json'), JSON.stringify({ p: { name: 'P', path: proj } }));
    // 실행 기록을 남겨 순서를 본다: 각 runner 는 자기 폴더에 파일을 쓰고 잠깐 기다린다
    const NL = String.raw`\n`;
    const w = (dir) => `const fs=require('fs');fs.mkdirSync('${dir}',{recursive:true});fs.appendFileSync('${dir}/out.txt','x${NL}y${NL}');fs.appendFileSync('../order.log','${dir}+'+Date.now()+'${NL}');setTimeout(()=>{fs.appendFileSync('../order.log','${dir}-'+Date.now()+'${NL}');console.log('끝')},300)`;
    fs.writeFileSync(path.join(root, 'squad.config.json'), JSON.stringify({
      runners: {
        fa: { type: 'command', cmd: process.execPath, args: ['-e', w('a')] },
        fb: { type: 'command', cmd: process.execPath, args: ['-e', w('b')] },
        fr: { type: 'command', cmd: process.execPath, args: ['-e', 'console.log(JSON.stringify({verdict:"pass",note:"좋음"}))'] },
      },
    }));
    const paths = projectPaths(root, 'p');
    appendJsonl(paths.tasks, { id: 'T-1', title: 'A1', member: 'a', status: 'todo', createdAt: '1' });
    appendJsonl(paths.tasks, { id: 'T-2', title: 'B1', member: 'b', status: 'todo', createdAt: '2' });
    appendJsonl(paths.tasks, { id: 'T-3', title: 'A2', member: 'a', status: 'todo', createdAt: '3', dependsOn: ['T-2'] });
    const gates = [];
    const r = await runQueue({ root, paths, max: 2, out: () => {}, loadMembers: () => loadMembers(paths), gate: async (s) => (gates.push(s), true) });
    const tasks = readJsonl(paths.tasks);
    assert.deepEqual(tasks.map((t) => t.status), ['done', 'done', 'done'], JSON.stringify(tasks.map((t) => [t.id, t.status, t.summary])));
    assert.equal(r.blocked, 0);
    assert.equal(tasks[1].reviewer, 'r');
    assert.equal(tasks[1].reviewNote, '좋음');
    assert.deepEqual(tasks[1].diffStat, [{ path: 'b/out.txt', add: 2, del: 0 }]);
    assert.ok(gates.includes('r'), '검수도 예산 확인을 거친다');
    // a 와 b 는 겹치지 않아 동시에 돌았고, T-3 은 T-2 가 끝난 뒤(검수 통과 뒤)에 시작했다
    const log = fs.readFileSync(path.join(root, 'order.log'), 'utf8').trim().split('\n').map((l) => [l.slice(0, 2), Number(l.slice(2))]);
    const t = (k, n = 0) => log.filter((x) => x[0] === k)[n][1];
    assert.ok(t('b+') < t('a-'), 'a 와 b 가 동시에 돌았다');
    assert.ok(t('a+', 1) > t('b-'), '선행(T-2)이 끝난 뒤에 T-3');
    const msgs = readJsonl(paths.messages);
    assert.ok(msgs.some((m) => m.from === 'b' && m.to === 'r' && m.kind === 'handoff'), '검수 요청 인계');
    assert.ok(!msgs.some((m) => /경로 밖/.test(m.text)), '동시에 도는 다른 멤버의 변경은 경로 밖으로 보지 않는다');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
