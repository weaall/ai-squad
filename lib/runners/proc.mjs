// runner 어댑터가 같이 쓰는 자식 프로세스 도우미.
import readline from 'node:readline';
import { spawnSync } from 'node:child_process';

export const isWin = process.platform === 'win32';

/** PATH 에 그 명령이 있는지(where/which). 가볍다 — 프로그램을 실행하지 않는다. */
export function hasCommand(cmd) {
  if (!/^[\w.\-\\/: ]+$/.test(cmd)) return false;
  return spawnSync(isWin ? 'where' : 'which', [cmd], { stdio: 'ignore', windowsHide: true }).status === 0;
}

/**
 * 자식 프로세스가 끝날 때까지 기다린다. stdout 줄마다 onLine, keepOut 이면 stdout 전체를 모은다.
 * spawn 이 실패하면(명령 없음) Error 를 던진다.
 */
export function collect(child, { timeoutMs = 0, onLine, keepOut = false } = {}) {
  return new Promise((resolve, reject) => {
    let out = '';
    let err = '';
    let timedOut = false;
    child.stderr?.on('data', (d) => (err = (err + d).slice(-400)));
    const rl = readline.createInterface({ input: child.stdout });
    rl.on('line', (line) => {
      if (keepOut) out += line + '\n';
      onLine?.(line);
    });
    const timer = timeoutMs ? setTimeout(() => ((timedOut = true), killTree(child)), timeoutMs) : null;
    child.on('error', (e) => {
      clearTimeout(timer);
      reject(new Error(`실행하지 못했습니다: ${e.message}`));
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      // readline 이 마지막 줄을 다 넘긴 뒤에 끝낸다
      setImmediate(() => resolve({ code, out, err, timedOut }));
    });
  });
}

export const notFoundHint = (err) => (/not recognized|not found|ENOENT|인식되지|찾을 수 없/i.test(err) ? ' (CLI 가 설치돼 있는지 확인하세요)' : '');

/** 프로세스 트리 종료 명령 [cmd, args]. win32 가 아니면 null(그때는 child.kill 로 끝낸다). */
export function killCommand(pid, platform = process.platform) {
  return platform === 'win32' ? ['taskkill', ['/PID', String(pid), '/T', '/F']] : null;
}

/** 자식 프로세스와 그 아래 프로세스까지 끝낸다(Windows 는 셸을 거쳐 띄워서 taskkill /T 가 필요하다). */
export function killTree(child) {
  if (!child?.pid) return;
  const c = killCommand(child.pid);
  if (c) spawnSync(c[0], c[1], { stdio: 'ignore', windowsHide: true });
  else child.kill('SIGTERM');
}
