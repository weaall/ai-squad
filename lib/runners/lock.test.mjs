import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { QUEUE_LOCK, lockTask, queueRunning, wakeQueue, withTaskLock } from './lock.mjs';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'squad-lock-'));

test('queueRunning·wakeQueue: 대기열 잠금이 살아 있으면 돈다고 보고 띄우지 않는다', () => {
  const squad = tmp();
  const dir = path.join(squad, 'locks');
  assert.equal(queueRunning(dir), false);
  const release = lockTask(dir, QUEUE_LOCK);
  assert.equal(queueRunning(dir), true);
  assert.equal(wakeQueue({ cli: 'x', root: squad, paths: { id: 'p', squad } }), false);
  release();
  assert.equal(queueRunning(dir), false);
  fs.writeFileSync(path.join(dir, `${QUEUE_LOCK}.lock`), '999999999'); // 죽은 pid
  assert.equal(queueRunning(dir), false);
});

test('lockTask: 잡혀 있으면 null, 풀면 다시 잡힌다', () => {
  const dir = tmp();
  const release = lockTask(dir, 'T-1');
  assert.ok(release);
  assert.equal(lockTask(dir, 'T-1'), null);
  assert.ok(lockTask(dir, 'T-2'));
  release();
  assert.ok(lockTask(dir, 'T-1'));
});

test('lockTask: 죽은 pid 의 잠금은 넘겨받는다', () => {
  const dir = tmp();
  fs.writeFileSync(path.join(dir, 'T-1.lock'), '999999999');
  assert.ok(lockTask(dir, 'T-1'));
});

test('withTaskLock: 잠겨 있으면 건너뛰고, 던져도 잠금을 푼다', async () => {
  const dir = tmp();
  let ran = 0;
  const inner = await withTaskLock(dir, 'T-1', () => withTaskLock(dir, 'T-1', () => ran++));
  assert.deepEqual(inner, { locked: true });
  assert.equal(ran, 0);
  await assert.rejects(withTaskLock(dir, 'T-1', () => { throw new Error('boom'); }));
  assert.equal(fs.existsSync(path.join(dir, 'T-1.lock')), false);
  assert.equal(await withTaskLock(dir, 'T-1', () => 7), 7);
});
