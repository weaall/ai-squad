// claude runner — Claude Code CLI(`claude -p`)로 오더 계획과 멤버 작업을 실행한다.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { readStreamLine, readUsage } from '../claude.mjs';
import { collect, hasCommand, isWin, killTree, notFoundHint } from './proc.mjs';
import { usageMeter } from '../budget.mjs';

export const LOGIN_COMMAND = 'claude auth login';

// headroom(토큰 압축 프록시)은 --headroom 이나 실효 headroom(MEMBER.md → config headroom.default, 기본 켜짐)이 true 면 감싼다. 설치 안 됐으면 경고 후 claude 로.
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

// 멤버는 도구 목록과 상관없이 add·commit 까지 할 수 있다. push 는 넣지 않는다(승인 요청으로).
export const GIT_TOOLS = ['Bash(git add *)', 'Bash(git commit *)'];

export const MAX_TURNS = 40;

// 난이도별 모델. hard 는 MEMBER.md model(없으면 claude 기본). config.models 로 덮어쓴다.
export const DEFAULT_MODELS = { easy: 'claude-haiku-5-5', normal: 'claude-sonnet-5-5', hard: '' };
/** difficulty(easy|normal|hard) → 모델 이름. 난이도가 없으면 멤버 모델 그대로. */
export function modelFor({ difficulty, memberModel = '', models = {} }) {
  if (!difficulty) return memberModel;
  const m = { ...DEFAULT_MODELS, ...models };
  return difficulty === 'hard' ? memberModel || m.hard : m[difficulty] ?? memberModel;
}

/**
 * 켠 MCP 이름만 담은 mcp 설정. 서버 정의는 ~/.claude.json(사용자·이 프로젝트)과 cwd/.mcp.json 에서 찾는다.
 * 없는 이름(플러그인·스킬)은 조용히 넘긴다 → 켠 것이 없으면 빈 설정.
 */
export function mcpConfig(names = [], cwd = '.', home = os.homedir()) {
  const readJson = (f) => {
    try {
      return JSON.parse(fs.readFileSync(f, 'utf8'));
    } catch {
      return {};
    }
  };
  const user = readJson(path.join(home, '.claude.json'));
  const proj = Object.entries(user.projects || {}).find(([p]) => path.resolve(p) === path.resolve(cwd))?.[1];
  const all = { ...user.mcpServers, ...proj?.mcpServers, ...readJson(path.join(cwd, '.mcp.json')).mcpServers };
  return { mcpServers: Object.fromEntries(names.filter((n) => all[n]).map((n) => [n, all[n]])) };
}

/** mode 별 claude 인자. plan: 계획 JSON 한 덩어리, member: stream-json 으로 도구 사용을 줄마다. */
export function claudeArgs({ mode, model, tools, mcpFile, maxTurns }) {
  const allowed = [...new Set([...(tools?.length ? tools : ['Read', 'Edit', 'Write', 'Glob', 'Grep']), ...GIT_TOOLS])];
  const args =
    mode === 'plan'
      ? ['-p', '--output-format', 'json']
      : ['-p', '--output-format', 'stream-json', '--verbose', '--permission-mode', 'acceptEdits', '--allowedTools', allowed.join(','), '--max-turns', String(maxTurns || MAX_TURNS)];
  if (model) args.push('--model', model);
  // 이 PC 의 MCP·플러그인 도구 설명이 매 호출 수만 토큰 → 켠 것만 담은 설정으로 제한한다
  if (mcpFile) args.push('--mcp-config', mcpFile, '--strict-mcp-config');
  return args;
}

/**
 * 실행하고 끝날 때까지 기다린다 → { code, text, isError, usage, timedOut, err }.
 * member 모드는 줄마다 onLine(원본)·onTool({tool, path}) 을 부른다.
 * onLimit(한도) 은 rate_limit_event 마다(lib/limits.mjs readLimit 모양).
 * onUsage(지금까지 토큰) 이 true 를 돌려주면 프로세스를 끝낸다(작업 예산 초과) → stopped: true.
 */
export async function exec({ prompt, cwd, mode = 'member', model = '', tools = [], mcp = [], maxTurns = 0, headroom = false, stderr = 'pipe', timeoutMs = 0, onLine, onTool, onUsage, onLimit }) {
  // 서버 정의에 env 비밀값이 있을 수 있어 본인만 읽게 쓰고 끝나면 지운다
  const mcpFile = path.join(os.tmpdir(), `squad-mcp-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.json`);
  fs.writeFileSync(mcpFile, JSON.stringify(mcpConfig(mcp, cwd)), { mode: 0o600 });
  try {
    return await run({ prompt, cwd, mode, args: claudeArgs({ mode, model, tools, mcpFile, maxTurns }), headroom, stderr, timeoutMs, onLine, onTool, onUsage, onLimit });
  } finally {
    fs.rmSync(mcpFile, { force: true });
  }
}

async function run({ prompt, cwd, mode, args, headroom, stderr, timeoutMs, onLine, onTool, onUsage, onLimit }) {
  const child = spawnClaude(args, prompt, cwd, headroom, stderr);
  let result = null;
  let stopped = false;
  const meter = usageMeter();
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
            if (s.limit) onLimit?.(s.limit);
            if (s.usage && !stopped && onUsage?.(meter.add(s.msgId, s.usage))) {
              stopped = true;
              killTree(child);
            }
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
    stopped,
    text: result?.text || '',
    isError: !result || result.isError,
    // 끝까지 가지 못했으면(예산으로 멈춤) 줄마다 모은 사용량을 쓴다
    usage: result?.usage || (stopped ? meter.usage() : null),
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
