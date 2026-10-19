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

test('collect: 자식이 끝났는데 손자가 stdout 을 쥐고 있어도 기다리지 않는다', async () => {
  // 자식은 손자 pid 를 찍고 바로 끝난다. 손자는 같은 stdout 파이프를 물려받아 60초 버틴다(막힘·예산 메시지 뒤 남은 프로세스 재현).
  const code = "const c=require('child_process').spawn(process.execPath,['-e','setTimeout(()=>{},60000)'],{stdio:'inherit',detached:true});c.unref();console.log(c.pid)";
  const child = spawn(process.execPath, ['-e', code], { windowsHide: true });
  const started = Date.now();
  const r = await collect(child, { keepOut: true });
  const pid = Number(r.out.trim());
  try {
    process.kill(pid);
  } catch {}
  assert.equal(r.code, 0);
  assert.ok(pid > 0);
  assert.ok(Date.now() - started < 10000, `${Date.now() - started}ms 기다림`);
});
