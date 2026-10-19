import test from 'node:test';
import assert from 'node:assert/strict';
import { retryOnce } from './retry.mjs';

const seq = (...rs) => {
  let i = 0;
  const fn = async () => rs[Math.min(i++, rs.length - 1)];
  fn.calls = () => i;
  return fn;
};
const fail = { ok: false, outside: [] };

test('retryOnce: 꺼져 있으면 실패해도 한 번만', async () => {
  const fn = seq(fail, { ok: true });
  assert.equal((await retryOnce(fn)).ok, false);
  assert.equal(fn.calls(), 1);
});

test('retryOnce: 켜져 있으면 실패 뒤 한 번만 더 (계속 실패해도 두 번까지)', async () => {
  const ok = seq(fail, { ok: true });
  let told = 0;
  assert.equal((await retryOnce(ok, { retry: true, onRetry: () => told++ })).ok, true);
  assert.equal(ok.calls(), 2);
  assert.equal(told, 1);
  const bad = seq(fail);
  assert.equal((await retryOnce(bad, { retry: true })).ok, false);
  assert.equal(bad.calls(), 2);
});

test('retryOnce: 성공·시간 초과·잠금 충돌·예산 초과·경로 밖 수정은 재시도하지 않음', async () => {
  for (const r of [{ ok: true }, { ...fail, timedOut: true }, { locked: true }, { ...fail, stopped: true }, { ok: false, outside: ['x'] }]) {
    const fn = seq(r, { ok: true });
    await retryOnce(fn, { retry: true });
    assert.equal(fn.calls(), 1, JSON.stringify(r));
  }
});
