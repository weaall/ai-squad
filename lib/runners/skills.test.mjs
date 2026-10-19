import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { outputStyleFile, skillList, systemAppend } from './skills.mjs';
import { claudeArgs } from './claude.mjs';

function fakeHome() {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'squad-skills-'));
  const put = (rel, text) => {
    const f = path.join(home, '.claude', rel);
    fs.mkdirSync(path.dirname(f), { recursive: true });
    fs.writeFileSync(f, text);
  };
  const fk = 'plugins/cache/fluent-korean/fluent-korean';
  put(`${fk}/1.0.0/output-styles/fluent-korean.md`, 'old');
  put(`${fk}/1.10.0/output-styles/fluent-korean.md`, '---\r\nname: fluent-korean\r\n---\r\n\r\n새 지침');
  put(`${fk}/1.9.0/output-styles/fluent-korean.md`, 'mid');
  put('plugins/cache/m/design/2.0.0/skills/ux-copy/SKILL.md', '---\nname: ux-copy\ndescription: "Write UI copy. More text here."\n---\n');
  put('plugins/cache/m/design/2.0.0/skills/critique/SKILL.md', '---\nname: critique\ndescription: >\n  Give design feedback.\n---\n');
  put('skills/artifact-design/SKILL.md', '---\ndescription: Make artifacts\n---\n');
  return home;
}

test('outputStyleFile: 가장 높은 버전 폴더, 없으면 빈 문자열', () => {
  const home = fakeHome();
  assert.match(outputStyleFile('fluent-korean', home), /1\.10\.0/);
  assert.equal(outputStyleFile('fluent-korean-not-coding', home), '');
  assert.equal(outputStyleFile('../x', home), '');
  fs.rmSync(home, { recursive: true, force: true });
});

test('skillList: 플러그인:스킬·플러그인 전체·사용자 스킬, headroom 빼고 설명 한 줄', () => {
  const home = fakeHome();
  assert.deepEqual(skillList(['design:ux-copy', 'artifact-design', 'headroom', 'cloud-only'], home), [
    { name: 'design:ux-copy', desc: 'Write UI copy.' },
    { name: 'artifact-design', desc: 'Make artifacts' },
    { name: 'cloud-only', desc: '' },
  ]);
  assert.deepEqual(skillList(['design'], home).map((k) => k.name).sort(), ['design:critique', 'design:ux-copy']);
  assert.equal(skillList(['design'], home).find((k) => k.name === 'design:critique').desc, 'Give design feedback.');
  fs.rmSync(home, { recursive: true, force: true });
});

test('systemAppend: 스타일 본문(frontmatter 뺌) + 켜진 기술 절, 둘 다 없으면 빈 문자열', () => {
  const home = fakeHome();
  const t = systemAppend({ outputStyle: 'fluent-korean', plugins: ['design:ux-copy'] }, home);
  assert.ok(t.startsWith('새 지침'));
  assert.match(t, /# 켜진 기술\n.*Skill 도구[\s\S]*- design:ux-copy — Write UI copy\./);
  assert.equal(systemAppend({ plugins: ['headroom'] }, home), '');
  fs.rmSync(home, { recursive: true, force: true });
});

test('claudeArgs: 켠 기술이면 Skill 허용, 덧붙일 파일이면 --append-system-prompt-file', () => {
  const a = claudeArgs({ mode: 'member', skills: true, appendFile: 'x.md' });
  assert.ok(a[a.indexOf('--allowedTools') + 1].split(',').includes('Skill'));
  assert.deepEqual(a.slice(-2), ['--append-system-prompt-file', 'x.md']);
  assert.ok(!claudeArgs({ mode: 'member' }).join(' ').includes('Skill'));
});
