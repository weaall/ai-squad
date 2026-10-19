import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { collect, killCommand } from './proc.mjs';

test('killCommand: win32 는 taskkill /T /F, 그 밖은 null', () => {
  assert.deepEqual(killCommand(1234, 'win32'), ['taskkill', ['/PID', '1234', '/T', '/F']]);
  assert.equal(killCommand(1234, 'linux'), null);
  assert.equal(killCommand(1234, 'darwin'), null);
});

test('collect: 시간 초과면 프로세스를 끝내고 timedOut', async () => {
  const child = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 60000)'], { windowsHide: true });
  const r = await collect(child, { timeoutMs: 200 });
  assert.equal(r.timedOut, true);
});
