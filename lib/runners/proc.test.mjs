import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { baseContext, collect, killCommand, SESSION_RE, withBase } from './proc.mjs';

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

test('기본 맥락·세션 id: 첫 메시지 입력 합, usage 에 base, claude·agy 세션 id', () => {
  assert.equal(baseContext({ input: 5, output: 9, cacheWrite: 23000, cacheRead: 17000 }), 40005);
  assert.deepEqual(withBase({ input: 1 }, 40), { input: 1, base: 40 });
  assert.equal(withBase(null, 40), null);
  assert.deepEqual(withBase({ input: 1 }, null), { input: 1 });
  assert.equal(SESSION_RE.exec('{"type":"system","session_id":"abc-1"}')?.[1], 'abc-1');
  assert.equal(SESSION_RE.exec('{"step_update":{"conversation_id": "c9"}}')?.[1], 'c9');
});
