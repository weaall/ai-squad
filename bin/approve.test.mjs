import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runApproved, runBlocker } from './approve.mjs';

test('approve run: 승인됐고 명령이 있고 아직 안 돌린 것만', () => {
  const a = { id: 'A-1', status: 'approved', commands: ['echo hi'] };
  assert.equal(runBlocker(a, []), '');
  assert.match(runBlocker(undefined, []), /없습니다/);
  assert.match(runBlocker({ ...a, status: 'pending' }, []), /승인된/);
  assert.match(runBlocker({ ...a, commands: undefined }, []), /명령/);
  assert.match(runBlocker(a, [{ type: 'run', id: 'A-1' }]), /이미/);
});

test('approve run: 차례로 돌고 처음 실패에서 멈춘다', () => {
  const ok = runApproved(['node -e "console.log(1)"', 'node -e "console.log(2)"'], process.cwd());
  assert.equal(ok.ok, true);
  assert.match(ok.log, /1[\s\S]*2/);
  const bad = runApproved(['node -e "process.exit(3)"', 'node -e "console.log(9)"'], process.cwd());
  assert.deepEqual([bad.ok, bad.code], [false, 3]);
  assert.doesNotMatch(bad.log, /\n9\n/);
});
