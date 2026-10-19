import test from 'node:test';
import assert from 'node:assert/strict';
import { ownsOverlap, planNeedsConfirm } from './confirm.mjs';
import { normalizeConfig } from './config.mjs';
import { buildOrderPrompt, parsePlan } from './claude.mjs';

const members = [
  { id: 'server', owns: ['server/index.mjs', 'lib/**'] },
  { id: 'ui', owns: ['server/public/**'] },
  { id: 'runner', owns: ['lib/runners/**', 'bin/**'] },
];
const config = normalizeConfig({});

test('order.autoAssign 기본 true, false 만 끈다', () => {
  assert.equal(config.order.autoAssign, true);
  assert.equal(normalizeConfig({ order: { autoAssign: 'no' } }).order.autoAssign, true);
  assert.equal(normalizeConfig({ order: { autoAssign: false } }).order.autoAssign, false);
});

test('평범한 계획은 바로 배정, autoAssign 이 꺼지면 확인', () => {
  const plan = [{ member: 'server', title: 'API 추가', detail: 'deleteTask 함수 손보기', step: 1 }, { member: 'ui', title: '버튼', step: 1 }];
  assert.deepEqual(planNeedsConfirm({ plan, members, config }), { needsConfirm: false, reasons: [] });
  const off = planNeedsConfirm({ plan, members, config: normalizeConfig({ order: { autoAssign: false } }) });
  assert.equal(off.needsConfirm, true);
  assert.match(off.reasons[0], /autoAssign/);
});

test('push·배포·DB·발송·삭제가 들어가면 확인', () => {
  for (const title of ['main 에 push', '운영 배포', 'DB 컬럼 추가', 'run migrations', '메일 발송', '옛 파일 삭제', 'delete old rows']) {
    const r = planNeedsConfirm({ plan: [{ member: 'server', title, step: 1 }], members, config });
    assert.equal(r.needsConfirm, true, title);
  }
});

test('같은 step 의 owns 겹침만 확인, step 이 다르면 통과', () => {
  const same = planNeedsConfirm({ plan: [{ member: 'server', title: 'a', step: 1 }, { member: 'runner', title: 'b', step: 1 }], members, config });
  assert.deepEqual(same.reasons, ['같은 step 1 에서 owns 겹침: server · runner']);
  const later = planNeedsConfirm({ plan: [{ member: 'server', title: 'a', step: 1 }, { member: 'runner', title: 'b', step: 2 }], members, config });
  assert.equal(later.needsConfirm, false);
  assert.equal(ownsOverlap(['server/index.mjs'], ['server/public/**']), false);
  assert.equal(ownsOverlap(['*.md'], ['docs/a.md']), true);
});

test('오더가 단 needsConfirm·reason 은 파싱 뒤 그대로 이유가 된다', () => {
  const plan = parsePlan(JSON.stringify([{ member: 'ui', title: '색 바꾸기', needsConfirm: true, reason: '어느 색인지 모호' }, { member: 'ui', title: 'x', needsConfirm: 'yes' }]), ['ui']);
  assert.equal(plan[0].reason, '어느 색인지 모호');
  assert.equal('needsConfirm' in plan[1], false);
  assert.deepEqual(planNeedsConfirm({ plan, members, config }).reasons, ['오더 판단: ui · 어느 색인지 모호']);
  assert.match(buildOrderPrompt({ orderMd: '', squadMd: '', members, instruction: 'x' }), /"needsConfirm"/);
});
