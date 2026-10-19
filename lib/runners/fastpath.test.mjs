import test from 'node:test';
import assert from 'node:assert/strict';
import { fastPlan } from './fastpath.mjs';

const members = [
  { id: 'order', name: '오더', owns: [], role: '' },
  { id: 'ui', name: '화면', owns: ['server/public/**'], role: '보드 화면(헤더·드롭다운·탭)과 스타일.' },
  { id: 'server', name: '서버', owns: ['server/**', 'lib/**'], role: '보드 API 와 상태 계산.' },
  { id: 'runner', name: '러너', owns: ['bin/**', 'lib/runners/**'], role: 'squad CLI 와 runner 어댑터, 시연 스크립트.' },
];

test('fastPlan: 한 멤버 낱말만 걸리면 그 멤버 작업 1개', () => {
  const p = fastPlan('헤더에 프로젝트 드롭다운 추가', members);
  assert.equal(p.member, 'ui');
  assert.equal(p.difficulty, 'easy');
  assert.equal(p.step, 1);
  assert.equal(fastPlan('runner 어댑터에 재시도 넣기', members).member, 'runner');
});

test('fastPlan: 둘 이상·아무도 아님·여러 일·긴 지시는 null(계획으로)', () => {
  assert.equal(fastPlan('드롭다운 고치고 어댑터도 손보기', members), null);
  assert.equal(fastPlan('날씨 알려줘', members), null);
  assert.equal(fastPlan('드롭다운 추가 그리고 색 바꾸기', members), null);
  assert.equal(fastPlan('보드 고치기', members), null); // '보드'는 ui·server 둘 다 → 버림
  assert.equal(fastPlan('x'.repeat(301) + ' 드롭다운', members), null);
});

test('fastPlan: 영문 낱말은 단어 경계로만, 긴·큰 지시는 normal', () => {
  assert.equal(fastPlan('build 스크립트 보기', [members[1], { id: 'x', owns: [], role: '' }]), null); // ui ⊄ build
  assert.equal(fastPlan('드롭다운 구조 전체 설계 다시', members).difficulty, 'normal');
});
