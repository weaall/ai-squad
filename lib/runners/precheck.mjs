// 검수 사전 확인: LLM 검수 전에 그 멤버의 확인 명령(MEMBER.md tools 의 Bash 중 tsc·lint·test)을 runner 가 직접 돌린다.
// 모두 통과하고 diff 가 작으며 화면·대외 문구 변경이 아니면 바로 통과(done) — LLM 검수는 비용이라 그때만 쓴다(2026-10-19 사용자).
import { spawnSync } from 'node:child_process';

export const MAX_FILES = 10;
const CHECK = /\b(tsc|eslint|lint|typecheck|test)\b/;
const SCREEN_PATH = /(^|\/)(public|client|web|front)\/|\.(css|html|tsx|jsx|vue|svelte)$/i;
const SCREEN_TEXT = /화면|문구|카피|메일|발송|공지|안내문/;

/** MEMBER.md tools 의 `Bash(npm test*)` → 'npm test'. 확인 명령(tsc·lint·test)만 남긴다. */
export function checkCommands(tools = []) {
  return tools
    .map((t) => /^Bash\((.*)\)$/.exec(t)?.[1]?.replace(/[\s*:]+$/, '').trim())
    .filter((c) => c && !/\s\*/.test(c) && CHECK.test(c));
}

/** → LLM 검수가 필요한 이유('' 면 필요 없음): diff 큼 · 화면·대외 문구 변경. */
export function needsLlm({ task = {}, stats = [] }) {
  if (stats.length >= MAX_FILES) return `바뀐 파일 ${stats.length}개`;
  if (task.kind === 'screen' || stats.some((s) => SCREEN_PATH.test(s.path))) return '화면 변경';
  if (SCREEN_TEXT.test(`${task.title || ''} ${task.detail || ''}`)) return '화면·대외 문구 변경';
  return '';
}

/**
 * → { pass: true, note } 이면 LLM 없이 통과, { pass: false, why } 이면 LLM 검수로 간다.
 * run(cmd, cwd) → { ok, out } 은 시험용으로 바꿔 끼운다.
 */
export function precheck({ member, task, cwd, run = defaultRun }) {
  const why = needsLlm({ task, stats: task.diffStat || [] });
  if (why) return { pass: false, why };
  const cmds = checkCommands(member?.tools);
  if (!cmds.length) return { pass: false, why: '확인 명령 없음' };
  for (const c of cmds) {
    const r = run(c, cwd);
    if (!r.ok) return { pass: false, why: `${c} 실패: ${String(r.out).trim().split('\n').slice(-3).join(' ').slice(0, 200)}` };
  }
  return { pass: true, note: `확인 명령 통과(${cmds.join(', ')}) — LLM 검수 생략` };
}

// ponytail: 명령 하나당 5분 상한, 쉘로 그대로 돌린다(MEMBER.md 는 사람이 쓴 신뢰된 입력).
function defaultRun(cmd, cwd) {
  const r = spawnSync(cmd, { cwd, shell: true, encoding: 'utf8', timeout: 300000, windowsHide: true });
  return { ok: r.status === 0, out: `${r.stdout || ''}${r.stderr || ''}${r.error?.message || ''}` };
}
