import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { checkPlugin, expandPath, isPortable, isTrusted, mergedProjects, migrate, migrateFiles, readInstalled, resolveProject } from './setup.mjs';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'squad-setup-'));
const write = (f, s) => (fs.mkdirSync(path.dirname(f), { recursive: true }), fs.writeFileSync(f, s));

test('expandPath: 환경변수·~·상대 경로를 이 PC 의 절대 경로로', () => {
  const env = { USERPROFILE: path.resolve('/home/u'), HOME: path.resolve('/home/h'), WORK: path.resolve('/w') };
  assert.equal(expandPath('%USERPROFILE%\\qugo', '/r', env), path.resolve('/home/u', 'qugo'));
  assert.equal(expandPath('%userprofile%/qugo', '/r', env), path.resolve('/home/u', 'qugo'));
  assert.equal(expandPath('$WORK/a', '/r', env), path.resolve('/w', 'a'));
  assert.equal(expandPath('${WORK}/a', '/r', env), path.resolve('/w', 'a'));
  assert.equal(expandPath('~/x', '/r', env), path.resolve('/home/u', 'x'));
  assert.equal(expandPath('../qugo', path.resolve('/r/ai-squad'), env), path.resolve('/r/qugo'));
  assert.equal(expandPath('%NOPE%/a', path.resolve('/r'), env), path.resolve('/r', '%NOPE%/a'));
  assert.ok(isPortable('../qugo') && isPortable('%USERPROFILE%\\qugo') && isPortable('~/q'));
  assert.ok(!isPortable(path.resolve('/abs/qugo')));
});

test('mergedProjects: projects.local.json 이 프로젝트별로 덮어쓰고 resolveProject 가 squadDir 을 저장소 기준으로', () => {
  const root = tmp();
  write(path.join(root, 'projects.json'), JSON.stringify({ qugo: { name: 'QUGO', path: '%USERPROFILE%/qugo', squadDir: 'squads/qugo' }, a: { name: 'A', path: '../a' } }));
  write(path.join(root, 'projects.local.json'), JSON.stringify({ qugo: { path: 'D:/work/qugo' } }));
  const p = mergedProjects(root);
  assert.deepEqual(p.qugo, { name: 'QUGO', path: 'D:/work/qugo', squadDir: 'squads/qugo' });
  assert.equal(p.a.path, '../a');
  assert.equal(resolveProject(root, p.qugo).squad, path.join(root, 'squads', 'qugo'));
  assert.equal(resolveProject(root, p.a).squad, path.join(path.resolve(root, '../a'), '.squad'));
  // local 파일이 없어도 그대로
  fs.rmSync(path.join(root, 'projects.local.json'));
  assert.equal(mergedProjects(root).qugo.path, '%USERPROFILE%/qugo');
});

test('readInstalled·checkPlugin: 직접 설치·동기화 플러그인과 스킬, 없는 것은 설치 안내', () => {
  const home = tmp();
  write(path.join(home, '.claude/plugins/installed_plugins.json'), JSON.stringify({ version: 2, plugins: { 'superpowers@dev': [{}] } }));
  write(path.join(home, '.claude/plugins/synced/b1/x1/.claude-plugin/plugin.json'), JSON.stringify({ name: 'design' }));
  write(path.join(home, '.claude/skills/my-skill/SKILL.md'), '');
  write(path.join(home, '.claude/skills/synced/b1/docx/SKILL.md'), '');
  const inst = readInstalled(home);
  assert.equal(checkPlugin('superpowers:writing-plans', inst).state, 'ok');
  assert.equal(checkPlugin('design:design-critique', inst).state, 'ok');
  assert.equal(checkPlugin('my-skill', inst).state, 'ok');
  assert.equal(checkPlugin('anthropic-skills:docx', inst).state, 'ok');
  assert.equal(checkPlugin('anthropic-skills:pdf', inst).state, 'unknown');
  const miss = checkPlugin('unity:ui', inst);
  assert.equal(miss.state, 'missing');
  assert.match(miss.hint, /\/plugin install unity/);
  assert.equal(checkPlugin('Claude_Browser', inst).state, 'unknown');
  // ~/.claude 가 없어도 죽지 않는다
  assert.equal(checkPlugin('a:b', readInstalled(path.join(home, 'none'))).state, 'missing');
});

test('isTrusted: ~/.claude.json 의 hasTrustDialogAccepted, 경로 표기 차이 무시(Windows)', () => {
  const home = tmp();
  const dir = path.resolve('/proj/q');
  const key = process.platform === 'win32' ? dir.toLowerCase().replace(/\\/g, '/') : dir;
  write(path.join(home, '.claude.json'), JSON.stringify({ projects: { [key]: { hasTrustDialogAccepted: true }, [path.resolve('/other')]: {} } }));
  assert.equal(isTrusted(dir, home), true);
  assert.equal(isTrusted(path.resolve('/other'), home), false);
  assert.equal(isTrusted(path.resolve('/none'), home), false);
});

test('migrate: 문서·jsonl 복사(locks 제외), 원본 유지, squadDir 상대 경로, 이미 있으면 거절', () => {
  const root = tmp();
  const proj = tmp();
  const src = path.join(proj, '.squad');
  write(path.join(src, 'SQUAD.md'), '# Q');
  write(path.join(src, 'tasks.jsonl'), '{}\n');
  write(path.join(src, 'members/order/MEMBER.md'), '---\nid: order\n---\n');
  write(path.join(src, 'members/order/NOTES.md'), '');
  write(path.join(src, 'locks/T-1.lock'), '1');
  write(path.join(root, 'projects.json'), JSON.stringify({ qugo: { name: 'QUGO', path: proj } }));
  const dst = path.join(root, 'squads', 'qugo');
  assert.deepEqual(migrateFiles(src), ['SQUAD.md', path.join('members', 'order', 'MEMBER.md'), path.join('members', 'order', 'NOTES.md'), 'tasks.jsonl'].sort());
  const r = migrate({ root, id: 'qugo', src, dst });
  assert.equal(r.squadDir, 'squads/qugo');
  assert.equal(fs.readFileSync(path.join(dst, 'members/order/MEMBER.md'), 'utf8'), '---\nid: order\n---\n');
  assert.ok(!fs.existsSync(path.join(dst, 'locks')));
  assert.ok(fs.existsSync(path.join(src, 'SQUAD.md')), '원본은 지우지 않는다');
  assert.equal(JSON.parse(fs.readFileSync(path.join(root, 'projects.json'), 'utf8')).qugo.squadDir, 'squads/qugo');
  assert.equal(resolveProject(root, mergedProjects(root).qugo).squad, dst);
  assert.throws(() => migrate({ root, id: 'qugo', src, dst }), /이미 있습니다/);
  assert.throws(() => migrate({ root, id: 'qugo', src: path.join(proj, 'none'), dst: path.join(root, 'x') }), /스쿼드 문서가 없습니다/);
});
