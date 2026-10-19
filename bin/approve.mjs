// `squad approve run` — 승인된 요청에 적힌 명령만 차례로 실행한다. 멤버 도구에는 위험 명령이 없다(lib/runners/claude.mjs safeTools).
import { spawnSync } from 'node:child_process';

export const LOG_MAX = 4000;

/** 실행할 수 있는 승인인지 — 순수 함수. rows 는 approvals.jsonl 원래 줄(이미 실행했는지 'run' 줄로 본다). 문제면 오류 문장. */
export function runBlocker(a, rows) {
  if (!a) return '승인 요청이 없습니다';
  if (a.status !== 'approved') return '승인된 요청만 실행합니다';
  if (!a.commands?.length) return '승인에 적힌 명령(--cmd)이 없습니다';
  if (rows.some((r) => r.type === 'run' && r.id === a.id)) return '이미 실행한 승인입니다';
  return '';
}

/** 명령을 cwd 에서 하나씩 셸로 실행하고 처음 실패에서 멈춘다 → { ok, code, log }. log 는 끝 LOG_MAX 자. */
export function runApproved(commands, cwd, { timeoutMs = 10 * 60000 } = {}) {
  let log = '';
  for (const c of commands) {
    const r = spawnSync(c, { cwd, shell: true, encoding: 'utf8', timeout: timeoutMs, windowsHide: true });
    const code = r.error ? -1 : r.status ?? -1;
    log += `$ ${c}\n${r.stdout || ''}${r.stderr || ''}${r.error ? `${r.error.message}\n` : ''}(종료 ${code})\n`;
    if (code !== 0) return { ok: false, code, log: log.slice(-LOG_MAX) };
  }
  return { ok: true, code: 0, log: log.slice(-LOG_MAX) };
}
