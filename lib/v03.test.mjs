// v0.3 에서 새로 생긴 순수 함수들: 설정, 승인, owns 감시, frontmatter 한 값 고치기, runner 템플릿.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { normalizeConfig } from './config.mjs';
import { decideApproval, foldApprovals, loadApprovals, requestApproval, validateApprovalRequest } from './approvals.mjs';
import { diffSnapshots, globToRegExp, outsideOwns, parsePorcelainZ } from './owns.mjs';
import { parseFrontmatter, setFrontmatterFlag, setFrontmatterValue } from './md.mjs';
import { flags } from './store.mjs';
import { fillArgs } from './runners/command.mjs';
import { parseAuthStatus } from './runners/claude.mjs';

test('설정: 잘못된 runner 는 빼고, claude 는 늘 있다', () => {
  const c = normalizeConfig({
    mainAi: { runner: 'ext', model: 'm' },
    runners: { ext: { type: 'command', cmd: 'x', args: ['{prompt}'], secret: 'EXT_KEY' }, 'Bad Name': { type: 'claude' }, bad: { type: 'command' }, env: { type: 'command', cmd: 'y', secret: 'lower' } },
    stale: { answerMinutes: 10 },
  });
  assert.deepEqual(Object.keys(c.runners).sort(), ['claude', 'ext']);
  assert.deepEqual(c.mainAi, { runner: 'ext', model: 'm' });
  assert.deepEqual(c.stale, { answerMinutes: 10, idleMinutes: 30 });
  assert.equal(c.errors.length, 3);
  assert.equal(normalizeConfig({ mainAi: { runner: 'ghost' } }).mainAi.runner, 'claude');
  assert.equal(normalizeConfig(null).runners.claude.type, 'claude');
});

test('runner 템플릿: {prompt}·{model} 채우기, 없으면 stdin', () => {
  assert.deepEqual(fillArgs(['--prompt', '{prompt}', '-m={model}'], { prompt: 'a "b" & c', model: 'x' }), { args: ['--prompt', 'a "b" & c', '-m=x'], usesPrompt: true });
  assert.equal(fillArgs(['run'], { prompt: 'p' }).usesPrompt, false);
  assert.equal(parseAuthStatus('{"loggedIn": true, "email": "x"}'), 'ok');
  assert.equal(parseAuthStatus('{"loggedIn": false}'), 'login');
  assert.equal(parseAuthStatus('oops'), 'login');
});

test('승인: 검증, 접기, 한 번만 결정', () => {
  const ids = ['order', 'ops'];
  assert.ok(validateApprovalRequest({ from: 'ghost', action: 'push', text: 'x' }, ids).error);
  assert.ok(validateApprovalRequest({ from: 'ops', action: 'rm', text: 'x' }, ids).error);
  assert.ok(validateApprovalRequest({ from: 'ops', action: 'push', text: ' ' }, ids).error);
  assert.ok(validateApprovalRequest({ from: 'ops', action: 'push', text: 'x', scope: 'y'.repeat(301) }, ids).error);
  assert.deepEqual(validateApprovalRequest({ from: 'ops', action: 'deploy', text: ' 배포 ', reason: '보안 패치', scope: 'qugo_be_api/deploy/**' }, ids), {
    from: 'ops', action: 'deploy', text: '배포', reason: '보안 패치', scope: 'qugo_be_api/deploy/**',
  });
  const rows = [
    { type: 'request', id: 'A-1', from: 'ops', action: 'push', text: 'x' },
    { type: 'decision', id: 'A-1', decision: 'rejected', note: '아직' },
    { type: 'decision', id: 'A-1', decision: 'approved' },
    { type: 'request', id: 'A-2', from: 'ops', action: 'send', text: 'y' },
  ];
  const f = foldApprovals(rows);
  assert.equal(f[0].status, 'rejected');
  assert.equal(f[0].note, '아직');
  assert.equal(f[1].status, 'pending');
  assert.ok(!('type' in f[0]));

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'squad-ap-'));
  try {
    const paths = { approvals: path.join(dir, 'approvals.jsonl') };
    const r = requestApproval(paths, { from: 'ops', action: 'push', text: 'push' });
    assert.equal(loadApprovals(paths)[0].status, 'pending');
    assert.equal(decideApproval(paths, r.id, 'approved').status, 'approved');
    assert.throws(() => decideApproval(paths, r.id, 'rejected'), /이미/);
    assert.throws(() => decideApproval(paths, 'A-none', 'approved'));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('owns 감시: glob, porcelain -z, 전후 비교', () => {
  assert.ok(globToRegExp('qugo_fe_web/app/**').test('qugo_fe_web/app/a/b.tsx'));
  assert.ok(globToRegExp('qugo_fe_web/app/**').test('qugo_fe_web/app/x'));
  assert.ok(!globToRegExp('qugo_fe_web/app/**').test('qugo_fe_web/application.ts'));
  assert.ok(globToRegExp('src/*.ts').test('src/a.ts'));
  assert.ok(!globToRegExp('src/*.ts').test('src/a/b.ts'));
  assert.ok(globToRegExp('**/*.md').test('README.md'));
  assert.ok(globToRegExp('docs/').test('docs/a/b'));
  assert.deepEqual(parsePorcelainZ(' M a.ts\0?? 새 파일.md\0R  new.ts\0old.ts\0', 'fe/'), [
    { xy: ' M', path: 'fe/a.ts' }, { xy: '??', path: 'fe/새 파일.md' }, { xy: 'R ', path: 'fe/new.ts' }, { xy: 'R ', path: 'fe/old.ts' },
  ]);
  const before = new Map([['fe/a.ts', ' M|1:1'], ['fe/gone.ts', ' M|1:1'], ['fe/same.ts', ' M|1:1']]);
  const after = new Map([['fe/a.ts', ' M|2:1'], ['fe/same.ts', ' M|1:1'], ['be/x.ts', '??|1:1']]);
  assert.deepEqual(diffSnapshots(before, after), ['be/x.ts', 'fe/a.ts', 'fe/gone.ts']);
  assert.deepEqual(outsideOwns(['fe/app/p.tsx', 'be/x.ts', '.squad/members/site/NOTES.md', '.squad/messages.jsonl', '.squad/members/ops/MEMBER.md'], ['fe/app/**'], 'site'), [
    'be/x.ts', '.squad/members/ops/MEMBER.md',
  ]);
});

const DOC = [
  '---',
  'id: site',
  'model: ',
  'headroom: false           # true 면 headroom 으로 감싼다',
  'owns:',
  '  - "app/**"',
  'plugins: [design:design-critique, "Claude Browser", dataviz]',
  'tools:',
  '  - Read',
  '---',
  '',
  '## 역할',
  '',
  'plugins: 라는 글자가 본문에 있어도 건드리지 않는다',
  '',
].join('\r\n');

test('frontmatter 값 하나만 고친다 — 나머지 줄·주석·본문·줄바꿈 보존', () => {
  const a = setFrontmatterValue(DOC, 'headroom', 'true');
  assert.equal(a, DOC.replace('headroom: false ', 'headroom: true '));
  assert.match(a, /# true 면 headroom 으로 감싼다/);

  const b = setFrontmatterFlag(DOC, 'plugins', 'dataviz', false);
  const { data, body } = parseFrontmatter(b);
  assert.deepEqual(data.plugins, { 'design:design-critique': true, 'Claude Browser': true, dataviz: false });
  assert.deepEqual(data.owns, ['app/**']);
  assert.deepEqual(data.tools, ['Read']);
  assert.equal(body, parseFrontmatter(DOC).body);
  assert.ok(b.includes('\r\n') && !/[^\r]\n/.test(b), 'CRLF 유지');
  // 바꾼 줄 말고는 같다
  const diff = (x, y) => x.split('\r\n').filter((l) => !y.split('\r\n').includes(l));
  assert.deepEqual(diff(DOC, b), ['plugins: [design:design-critique, "Claude Browser", dataviz]']);

  const c = setFrontmatterFlag(b, 'plugins', 'design:design-critique', false);
  assert.deepEqual(diff(b, c), ['  design:design-critique: true']);
  assert.equal(parseFrontmatter(c).data.plugins['design:design-critique'], false);
  const d = setFrontmatterFlag(c, 'plugins', 'design:design-critique', true);
  assert.equal(d, b);

  const e = setFrontmatterFlag('---\nid: x\n---\n본문\n', 'plugins', 'dataviz', true);
  assert.deepEqual(parseFrontmatter(e).data.plugins, { dataviz: true });
  assert.equal(parseFrontmatter(setFrontmatterValue('---\nid: x\n---\n', 'headroom', 'true')).data.headroom, 'true');
  assert.throws(() => setFrontmatterValue('본문만', 'headroom', 'true'));
});

test('플러그인 목록: 배열은 모두 켜짐, 맵은 그대로, 시연 덮어쓰기', () => {
  assert.deepEqual(flags(['a', 'b']), [{ name: 'a', on: true }, { name: 'b', on: true }]);
  assert.deepEqual(flags({ a: true, b: false }), [{ name: 'a', on: true }, { name: 'b', on: false }]);
  assert.deepEqual(flags({ a: true }, { a: false }), [{ name: 'a', on: false }]);
  assert.deepEqual(flags(''), []);
});

test('run: command runner 로 실행하고, git 으로만 보이는 owns 밖 수정은 막지 않고 확인 필요 경고', async () => {
  const { runMember } = await import('./runner.mjs');
  const { loadMembers, projectPaths, readJsonl, appendJsonl } = await import('./store.mjs');
  const { spawnSync } = await import('node:child_process');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'squad-runm-'));
  try {
    const proj = path.join(root, 'proj');
    fs.mkdirSync(path.join(proj, 'app'), { recursive: true });
    fs.mkdirSync(path.join(proj, '.squad', 'members', 'site'), { recursive: true });
    fs.writeFileSync(path.join(proj, '.squad', 'members', 'site', 'MEMBER.md'), '---\nid: site\nrunner: fake\nowns:\n  - app/**\n---\n\n## 지금 작업\n');
    if (spawnSync('git', ['init', '-q'], { cwd: proj }).status !== 0) return; // git 이 없으면 건너뛴다
    fs.writeFileSync(path.join(root, 'projects.json'), JSON.stringify({ p: { name: 'P', path: proj } }));
    const script = "require('fs').writeFileSync('app/ok.txt','1');require('fs').writeFileSync('other.txt','1');console.log('끝')";
    fs.writeFileSync(path.join(root, 'squad.config.json'), JSON.stringify({ runners: { fake: { type: 'command', cmd: process.execPath, args: ['-e', script] } } }));
    const paths = projectPaths(root, 'p');
    const task = appendJsonl(paths.tasks, { id: 'T-a-1', title: '시험', member: 'site', status: 'todo' });
    const m = loadMembers(paths).find((x) => x.id === 'site');
    const r = await runMember({ root, paths, member: m, task, out: () => {} });
    // 도구 이벤트가 없는 실행기(command)의 git 차이는 누가 고쳤는지 몰라 막지 않는다(2026-10-19 오탐 반복)
    assert.equal(r.ok, true);
    assert.deepEqual(r.outside, []);
    assert.equal(readJsonl(paths.tasks)[0].status, 'done');
    assert.match(r.summary, /확인 필요.*other.txt/s);
    const msgs = readJsonl(paths.messages);
    assert.ok(msgs.some((x) => x.kind === 'report' && /끝/.test(x.text)));
    assert.ok(fs.existsSync(path.join(proj, 'other.txt')), '되돌리지 않는다');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
