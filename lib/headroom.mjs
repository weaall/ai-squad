// 사용량 탭의 headroom 절약 수치: `headroom savings --json --days 7` 출력을 주기적으로 받아 둔다.
import { spawn } from 'node:child_process';
import { collect, hasCommand } from './runners/proc.mjs';

const CMD = 'headroom savings --json --days 7';

/** 명령 출력 → JSON(객체·배열). 못 읽으면 null. */
export function parseSavings(text) {
  try {
    const j = JSON.parse(String(text).trim());
    return j && typeof j === 'object' ? j : null;
  } catch {
    return null;
  }
}

/** 한 번 실행해 JSON 을 돌려준다. headroom 이 없거나 실패하면 null. */
export async function readSavings() {
  if (!hasCommand('headroom')) return null;
  const child = spawn(CMD, { shell: true, stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true });
  const r = await collect(child, { keepOut: true, timeoutMs: 60000 }).catch(() => null);
  return r && r.code === 0 ? parseSavings(r.out) : null;
}

/**
 * every ms 마다 read() 해서 { at, data } 를 캐시한다. 실패하면 이전 값을 그대로 둔다.
 * → { get() → { at, data } | null, stop() }
 */
export function savingsCache(read = readSavings, every = 5 * 60 * 1000) {
  let last = null;
  let busy = false;
  const tick = async () => {
    if (busy) return;
    busy = true;
    try {
      const data = await read();
      if (data) last = { at: Date.now(), data };
    } catch {
      // 다음 주기에 다시
    } finally {
      busy = false;
    }
  };
  tick();
  const timer = setInterval(tick, every);
  timer.unref?.();
  return { get: () => last, stop: () => clearInterval(timer) };
}
