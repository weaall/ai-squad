import test from 'node:test';
import assert from 'node:assert/strict';
import { parseFrontmatter, getSection, setSection } from './md.mjs';

const DOC = `---
id: org-dashboard
name: 기업 대시보드   # 주석
runner: claude
model:
owns:
  - qugo_fe_web/app/organization/**
tools:
  - Read
  - "Bash(npx tsc *)"
plugins: [design:design-critique, "a, b"]
headroom: true
---

## 역할

기업 화면 담당.

## 지금 작업

## 인계 메모

- 하나
`;

test('frontmatter 를 읽는다', () => {
  const { data, body } = parseFrontmatter(DOC);
  assert.equal(data.id, 'org-dashboard');
  assert.equal(data.name, '기업 대시보드');
  assert.equal(data.model, '');
  assert.deepEqual(data.owns, ['qugo_fe_web/app/organization/**']);
  assert.deepEqual(data.tools, ['Read', 'Bash(npx tsc *)']);
  assert.deepEqual(data.plugins, ['design:design-critique', 'a, b']);
  assert.equal(data.headroom, 'true');
  assert.ok(body.startsWith('\n## 역할'));
});

test('frontmatter 가 없으면 빈 data', () => {
  assert.deepEqual(parseFrontmatter('# 제목').data, {});
});

test('절을 읽고 바꾼다', () => {
  assert.equal(getSection(DOC, '역할'), '기업 화면 담당.');
  assert.equal(getSection(DOC, '지금 작업'), '');
  const set = setSection(DOC, '지금 작업', '로그인 화면 손보기');
  assert.equal(getSection(set, '지금 작업'), '로그인 화면 손보기');
  assert.equal(getSection(set, '인계 메모'), '- 하나');
  const cleared = setSection(set, '지금 작업', '');
  assert.equal(getSection(cleared, '지금 작업'), '');
  assert.equal(getSection(cleared, '역할'), '기업 화면 담당.');
  assert.equal(getSection(setSection('# x\n', '새 절', '내용'), '새 절'), '내용');
});
