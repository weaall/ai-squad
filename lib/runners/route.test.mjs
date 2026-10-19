import test from 'node:test';
import assert from 'node:assert/strict';
import { routeTask, withRoute, BUSY_MODEL } from './route.mjs';
import { DEFAULT_MODEL } from './antigravity.mjs';

const on = ['claude', 'antigravity'];
const claude = { runner: 'claude' };

test('routeTask: 프로젝트에서 꺼져 있으면 MEMBER.md runner 그대로', () => {
  assert.equal(routeTask({ task: { difficulty: 'easy' }, member: claude }).runner, 'claude');
  assert.equal(routeTask({ task: { runner: 'antigravity' }, member: claude }).runner, 'claude');
});

test('routeTask: easy·가벼운 종류 → antigravity 기본 모델, hard·화면은 claude', () => {
  assert.deepEqual(routeTask({ task: { difficulty: 'easy' }, member: claude, projectRunners: on }), { runner: 'antigravity', model: DEFAULT_MODEL, reason: '쉬운 작업' });
  assert.equal(routeTask({ task: { kind: 'review', difficulty: 'normal' }, member: claude, projectRunners: on }).runner, 'antigravity');
  assert.equal(routeTask({ task: { difficulty: 'hard', kind: 'review' }, member: claude, projectRunners: on }).runner, 'claude');
  assert.equal(routeTask({ task: { difficulty: 'easy', kind: 'screen' }, member: claude, projectRunners: on }).runner, 'claude');
  assert.equal(routeTask({ task: { difficulty: 'easy' }, member: { runner: 'command' }, projectRunners: on }).runner, 'command');
});

test('routeTask: Claude 5시간 70% 넘으면 normal → antigravity claude-sonnet-4-6', () => {
  assert.equal(routeTask({ task: { difficulty: 'normal' }, member: claude, projectRunners: on, limits: { fiveHour: { used: 0.7 } } }).runner, 'claude');
  const r = routeTask({ task: { difficulty: 'normal' }, member: claude, projectRunners: on, limits: { fiveHour: { used: 0.71 } } });
  assert.equal(r.model, BUSY_MODEL);
  assert.equal(routeTask({ task: { difficulty: 'hard' }, member: claude, projectRunners: on, limits: { fiveHour: { used: 0.99 } } }).runner, 'claude');
});

test('routeTask: 작업 runner·model 이 MEMBER.md 보다 우선', () => {
  assert.deepEqual(routeTask({ task: { runner: 'antigravity', model: 'gemini-3.8-flash-high', difficulty: 'hard' }, member: claude, projectRunners: on }), { runner: 'antigravity', model: 'gemini-3.8-flash-high', reason: '작업 지정' });
  assert.equal(routeTask({ task: { runner: 'claude', difficulty: 'easy' }, member: claude, projectRunners: on }).runner, 'claude');
});

const fake = (results) => {
  const calls = [];
  return { calls, get: (name) => ({ name, exec: async (o) => (calls.push({ name, model: o.model }), results[name]) }) };
};

test('withRoute: antigravity 실패 → 한 번 claude 로 대체, 모델은 원래 것', async () => {
  const f = fake({ antigravity: { code: 1, isError: true, text: 'not logged in' }, claude: { code: 0, isError: false, text: 'ok' } });
  const seen = [];
  const r = withRoute(f.get, { runner: 'antigravity', model: DEFAULT_MODEL }, { onFallback: (x) => seen.push(x) });
  const res = await r.exec({ model: 'claude-haiku-4-5' });
  assert.deepEqual(f.calls, [{ name: 'antigravity', model: DEFAULT_MODEL }, { name: 'claude', model: 'claude-haiku-4-5' }]);
  assert.deepEqual(res.fallback, { from: 'antigravity', reason: '로그인 필요' });
  assert.deepEqual(seen, [{ from: 'antigravity', to: 'claude', reason: '로그인 필요' }]);
});

test('withRoute: 성공·시간 초과·예산 초과는 대체하지 않는다', async () => {
  for (const res of [{ code: 0, isError: false }, { code: 1, isError: true, timedOut: true }, { code: 0, isError: true, stopped: true }]) {
    const f = fake({ antigravity: res });
    await withRoute(f.get, { runner: 'antigravity', model: DEFAULT_MODEL }).exec({});
    assert.equal(f.calls.length, 1);
  }
});
