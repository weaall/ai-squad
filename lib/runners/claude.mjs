// claude runner — Claude Code CLI(`claude -p`)로 오더 계획과 멤버 작업을 실행한다.
import { spawn } from 'node:child_process';
import { readStreamLine, readUsage } from '../claude.mjs';
import { collect, hasCommand, isWin, notFoundHint } from './proc.mjs';

export const LOGIN_COMMAND = 'claude auth login';

// 기본은 claude 를 바로 실행한다. headroom(토큰 압축 프록시)은 --headroom 이나 MEMBER.md 의 headroom: true 일 때만 감싼다.
function launcher(useHeadroom) {
  if (!useHeadroom) return { cmd: 'claude', pre: [] };
  if (hasCommand('headroom')) return { cmd: 'headroom', pre: ['wrap', 'claude', '--'] };
  console.warn('경고: headroom 이 켜져 있지만 설치돼 있지 않아 claude 를 바로 실행합니다');
  return { cmd: 'claude', pre: [] };
}

// Windows 에서 claude 는 .cmd 라 셸을 거쳐야 한다 → 인자를 직접 따옴표로 감싼다. 프롬프트는 stdin 으로 보내 명령줄 길이 제한을 피한다.
const quote = (a) => (isWin ? `"${String(a).replace(/"/g, '\\"')}"` : `'${String(a).replace(/'/g, `'\\''`)}'`);
function spawnClaude(args, prompt, cwd, useHeadroom, stderr) {
  const { cmd, pre } = launcher(useHeadroom);
  const child = spawn(cmd, [...pre, ...args].map(quote), { cwd, shell: true, stdio: ['pipe', 'pipe', stderr], windowsHide: true });
  child.stdin.on('error', () => {}); // claude 가 먼저 끝나면 EPIPE — 무시하고 종료 코드로 판단
  child.stdin.end(prompt);
  return child;
}

/** mode 별 claude 인자. plan: 계획 JSON 한 덩어리, member: stream-json 으로 도구 사용을 줄마다. */
export function claudeArgs({ mode, model, tools }) {
  const args =
    mode === 'plan'
      ? ['-p', '--output-format', 'json']
      : ['-p', '--output-format', 'stream-json', '--verbose', '--permission-mode', 'acceptEdits', '--allowedTools', (tools?.length ? tools : ['Read', 'Edit', 'Write', 'Glob', 'Grep']).join(',')];
  if (model) args.push('--model', model);
  return args;
}

/**
 * 실행하고 끝날 때까지 기다린다 → { code, text, isError, usage, timedOut, err }.
 * member 모드는 줄마다 onLine(원본)·onTool({tool, path}) 을 부른다.
 */
export async function exec({ prompt, cwd, mode = 'member', model = '', tools = [], headroom = false, stderr = 'pipe', timeoutMs = 0, onLine, onTool }) {
  const child = spawnClaude(claudeArgs({ mode, model, tools }), prompt, cwd, headroom, stderr);
  let result = null;
  const r = await collect(child, {
    timeoutMs,
    keepOut: mode === 'plan',
    onLine:
      mode === 'plan'
        ? null
        : (line) => {
            onLine?.(line);
            const s = readStreamLine(line, cwd);
            if (!s) return;
            for (const t of s.tools) onTool?.(t);
            if (s.result) result = s.result;
          },
  });
  if (mode === 'plan') {
    try {
      const j = JSON.parse(r.out);
      result = { text: String(j.result ?? '').trim(), isError: Boolean(j.is_error), usage: readUsage(j) };
    } catch {
      result = { text: r.out.trim(), isError: false, usage: null };
    }
  }
  if (result?.isError && /log ?in|logged|auth|401/i.test(result.text)) lastStatus = { state: 'login', at: Date.now() };
  else if (r.code === 0 && result) lastStatus = { state: 'ok', at: Date.now() };
  return {
    code: r.code,
    timedOut: r.timedOut,
    text: result?.text || '',
    isError: !result || result.isError,
    usage: result?.usage || null,
    err: r.err + (r.code !== 0 ? notFoundHint(r.err) : ''),
  };
}

// ── 연결 상태 ──
// `claude auth status --json` 은 모델을 부르지 않는 가벼운 확인이다. 그래도 5분 동안은 다시 묻지 않는다.
// 마지막 실행 결과(로그인 오류·성공)가 더 새로우면 그것을 쓴다.
let lastStatus = null;
let checking = null;
const TTL = 5 * 60 * 1000;

/** `claude auth status --json` 출력 → 상태. 이메일 같은 값은 내보내지 않는다. */
export function parseAuthStatus(text) {
  try {
    const j = JSON.parse(text);
    return j && j.loggedIn === true ? 'ok' : 'login';
  } catch {
    return 'login';
  }
}

export function status({ force = false } = {}) {
  if (!force && lastStatus && Date.now() - lastStatus.at < TTL) return Promise.resolve({ state: lastStatus.state });
  if (checking) return checking;
  checking = new Promise((resolve) => {
    if (!hasCommand('claude')) return resolve({ state: 'unset', detail: 'claude CLI 가 설치돼 있지 않습니다' });
    const child = spawn('claude auth status --json', { shell: true, stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true });
    collect(child, { keepOut: true, timeoutMs: 20000 })
      .then((r) => resolve({ state: r.code === 0 || r.out ? parseAuthStatus(r.out) : 'login' }))
      .catch(() => resolve({ state: 'unset', detail: 'claude 를 실행하지 못했습니다' }));
  }).then((s) => {
    checking = null;
    lastStatus = { state: s.state, at: Date.now() };
    return s;
  });
  return checking;
}
