// 같은 작업 중복 실행 방지 — <squad>/locks/<작업id>.lock 을 wx 로 만든다. 안에는 잡은 프로세스 pid.
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';

function alive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return e.code === 'EPERM';
  }
}

/** 잠금을 잡으면 푸는 함수를, 이미 살아 있는 프로세스가 잡고 있으면 null 을 돌려준다. 죽은 프로세스의 잠금은 넘겨받는다. */
export function lockTask(dir, taskId) {
  fs.mkdirSync(dir, { recursive: true });
  const ig = path.join(dir, '.gitignore');
  if (!fs.existsSync(ig)) fs.writeFileSync(ig, '*\n');
  const file = path.join(dir, `${taskId}.lock`);
  for (let i = 0; i < 2; i++) {
    try {
      fs.writeFileSync(file, String(process.pid), { flag: 'wx' });
      let done = false;
      const release = () => {
        if (done) return;
        done = true;
        process.off('exit', release);
        fs.rmSync(file, { force: true });
      };
      process.on('exit', release);
      return release;
    } catch (e) {
      if (e.code !== 'EEXIST') throw e;
      const pid = Number(fs.readFileSync(file, 'utf8'));
      if (pid && alive(pid)) return null;
      fs.rmSync(file, { force: true });
    }
  }
  return null;
}

/** 프로젝트 대기열 잠금 이름 — run-queue 가 <squad>/locks/run-queue.lock 을 잡고 돈다. 작업 id(T-..)와 겹치지 않는다. */
export const QUEUE_LOCK = 'run-queue';

/** 그 프로젝트 대기열이 지금 돌고 있는지(잠금을 잡은 프로세스가 살아 있는지). dir: <squad>/locks */
export function queueRunning(dir) {
  try {
    const pid = Number(fs.readFileSync(path.join(dir, `${QUEUE_LOCK}.lock`), 'utf8'));
    return Boolean(pid && alive(pid));
  } catch {
    return false;
  }
}

/**
 * 대기열이 안 돌면 `squad run-queue <project>` 를 백그라운드로 띄운다. 띄웠으면 true.
 * 동시에 두 번 띄워도 run-queue 가 잠금을 못 잡은 쪽은 바로 끝나서 하나만 남는다.
 */
export function wakeQueue({ cli, root, paths, args = [] }) {
  if (queueRunning(path.join(paths.squad, 'locks'))) return false;
  spawn(process.execPath, [cli, 'run-queue', paths.id, ...args], { cwd: root, detached: true, stdio: 'ignore', windowsHide: true }).unref();
  return true;
}

/** fn 을 잠금 안에서 돌린다. 잠겨 있으면 fn 을 부르지 않고 { locked: true }. 끝나거나 던져도 잠금을 푼다. */
export async function withTaskLock(dir, taskId, fn) {
  const release = lockTask(dir, taskId);
  if (!release) return { locked: true };
  try {
    return await fn();
  } finally {
    release();
  }
}
