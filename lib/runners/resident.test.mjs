import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { extractBrief, memberBrief, memberResume, ownsKeys, saveMemberSession, SESSION_CAP, startContextStats } from './resident.mjs';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'squad-resident-'));

test('memberResume: 같은 멤버·runner 세션을 잇고, 맥락이 상한을 넘으면 새 세션', () => {
  const f = path.join(tmp(), 'sessions.json');
  assert.equal(memberResume(f, 'ui', 'claude'), '');
  saveMemberSession(f, 'ui', 'claude', 's-1', { base: 40000, output: 2000 });
  assert.equal(memberResume(f, 'ui', 'claude'), 's-1');
  assert.equal(memberResume(f, 'ui', 'antigravity'), '');
  assert.equal(memberResume(f, 'server', 'claude'), '');
  saveMemberSession(f, 'ui', 'claude', 's-1', { base: SESSION_CAP, output: 10 });
  assert.equal(memberResume(f, 'ui', 'claude'), '');
  saveMemberSession(f, 'ui', 'claude', '', { base: 1 });
  assert.equal(memberResume(f, 'ui', 'claude'), '');
});

test('ownsKeys: 글롭·저장소 prefix 를 떼고, 긴 마지막 폴더 이름도', () => {
  assert.deepEqual(ownsKeys(['bin/**', 'lib/runners/**', 'scripts/**']), ['bin', 'lib/runners', 'runners', 'scripts']);
  assert.deepEqual(ownsKeys(['fe/src/components/**', 'be/api/**'], 'fe/'), ['src/components', 'components']);
});

test('extractBrief: 첫 덩어리와 맡은 경로를 말하는 절만, 상한 안에', () => {
  const md = '# 공통\n커밋은 한국어\n## 서버\nserver/ 는 express\n## 러너\nlib/runners 는 spawn\n## 기타\nbinary 파일\n';
  const b = extractBrief(md, ['lib/runners', 'bin']);
  assert.match(b, /커밋은 한국어/);
  assert.match(b, /spawn/);
  assert.doesNotMatch(b, /express/);
  assert.doesNotMatch(b, /binary/);
  assert.equal(extractBrief(md, ['lib/runners'], 30), '# 공통\n커밋은 한국어');
});

test('memberBrief: CLAUDE.md 없으면 빈 값, 원문이 같으면 다시 만들지 않는다', () => {
  const root = tmp();
  const proj = tmp();
  const member = { id: 'runner', owns: ['bin/**'] };
  const args = { root, projectId: 'p', projectPath: proj, member };
  assert.equal(memberBrief(args), '');
  fs.writeFileSync(path.join(proj, 'CLAUDE.md'), '# 규칙\n테스트 먼저\n## bin\nbin/ 은 CLI\n## ui\nui 는 React\n');
  const b = memberBrief(args);
  assert.match(b, /bin\/ 은 CLI/);
  assert.doesNotMatch(b, /React/);
  const f = path.join(root, 'data', 'p', 'briefs', 'runner.md');
  fs.writeFileSync(f, fs.readFileSync(f, 'utf8').replace('CLI', 'CACHED'));
  assert.match(memberBrief(args), /CACHED/);
  fs.appendFileSync(path.join(proj, 'CLAUDE.md'), '\n## bin 추가\nbin 새 규칙\n');
  assert.match(memberBrief(args), /bin 새 규칙/);
});

test('startContextStats: 멤버별 전후 평균 시작 맥락', () => {
  const s = startContextStats([
    { member: 'ui', usage: { base: 40000 } },
    { member: 'ui', usage: { base: 30000 } },
    { member: 'ui', usage: { base: 8000, brief: true } },
    { member: 'ui', usage: { base: 4000, resumed: true } },
    { member: 'ui', usage: {} },
  ]);
  assert.deepEqual(s.ui, { before: { n: 2, avg: 35000 }, after: { n: 2, avg: 6000 } });
});
