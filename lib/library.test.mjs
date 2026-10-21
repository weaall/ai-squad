import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { baseFile, isBase, listLibrary, readBase } from './library.mjs';
import { buildRunPrompt } from './claude.mjs';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'squad-lib-'));

test('기반 경로는 소문자 조각 2개 이상, 상위 이동·역슬래시 거부', () => {
  assert.ok(isBase('agency/testing/accessibility-auditor'));
  for (const b of ['agency', '../x/y', 'agency/../etc', 'agency\\x', 'Agency/x', '/agency/x', '']) assert.ok(!isBase(b), b);
  assert.throws(() => baseFile('/r', '../x'));
});

test('목록은 요약 파일·대문자 파일을 빼고, 요약 크기를 함께 준다', () => {
  const root = tmp();
  const d = path.join(root, 'library', 'agency', 'testing');
  fs.mkdirSync(d, { recursive: true });
  fs.writeFileSync(path.join(d, 'qa.md'), '---\nname: QA\ndescription: 증거\n---\n원문 본문');
  fs.writeFileSync(path.join(d, 'qa.brief.md'), '요약 본문');
  fs.writeFileSync(path.join(root, 'library', 'agency', 'SOURCE.md'), '출처');
  const items = listLibrary(root);
  assert.equal(items.length, 1);
  assert.equal(items[0].base, 'agency/testing/qa');
  assert.equal(items[0].name, 'QA');
  assert.ok(items[0].brief && items[0].briefChars > 0);
  // 요약이 있으면 요약, 없으면 원문 본문(frontmatter 제외), 없는 경로·빈 값은 ''
  assert.equal(readBase(root, 'agency/testing/qa'), '요약 본문');
  fs.rmSync(path.join(d, 'qa.brief.md'));
  assert.equal(readBase(root, 'agency/testing/qa'), '원문 본문');
  assert.equal(readBase(root, 'agency/testing/none'), '');
  assert.equal(readBase(root, ''), '');
  assert.equal(readBase(root, '../x'), '');
});

test('기반이 있으면 멤버 문서보다 먼저 넣고, 없으면 프롬프트가 그대로다', () => {
  const p = { memberMd: '---\nid: qa\n---\n## 역할\n검수', notesMd: '', task: { id: 'T-1', title: 't' }, squadRoot: '/s', project: 'qugo', member: 'qa' };
  const without = buildRunPrompt(p);
  assert.doesNotMatch(without, /기반 직무/);
  assert.equal(buildRunPrompt({ ...p, base: 'agency/testing/qa', baseMd: '' }), without);
  const withBase = buildRunPrompt({ ...p, base: 'agency/testing/qa', baseMd: '증거 먼저' });
  assert.ok(withBase.indexOf('# 기반 직무 (agency/testing/qa)') < withBase.indexOf('# 멤버 문서'));
  assert.match(withBase, /증거 먼저/);
});

test('저장소에 들어 있는 agency 라이브러리는 모두 요약과 MIT 사본을 갖는다', () => {
  const root = path.resolve(import.meta.dirname, '..');
  const items = listLibrary(root).filter((i) => i.base.startsWith('agency/'));
  assert.ok(items.length >= 8);
  for (const i of items) assert.ok(i.brief, `${i.base} 요약 없음`);
  assert.match(fs.readFileSync(path.join(root, 'library', 'agency', 'LICENSE'), 'utf8'), /^MIT License/);
});
