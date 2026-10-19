// claude runner — Claude Code CLI(`claude -p`)로 오더 계획과 멤버 작업을 실행한다.
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { readStreamLine, readUsage } from '../claude.mjs';
import { baseContext, collect, hasCommand, isWin, killTree, notFoundHint, SESSION_RE, withBase } from './proc.mjs';
import { usageMeter } from '../budget.mjs';
import { systemAppend } from './skills.mjs';

export const LOGIN_COMMAND = 'claude auth login';

// headroom(토큰 압축 프록시)은 항상 켠다 — 끄는 설정 없음. 설치 안 됐으면 경고 후 claude 로.
// 이미 떠 있는 headroom 프록시가 있으면 wrap 대신 ANTHROPIC_BASE_URL 로 바로 붙는다.
// wrap 은 실행마다 프로젝트 .claude 설정 파일을 고쳐, 멤버 여러 명이 동시에 띄우면 [Errno 13] Permission denied 로 바로 죽었다(2026-10-19).
const HEADROOM_PORT = Number(process.env.HEADROOM_PORT) || 8787;
export function proxyAlive(port = HEADROOM_PORT) {
  const r = spawnSync(process.execPath, ['-e', `const s=require('net').connect(${port},'127.0.0.1');s.on('connect',()=>process.exit(0));s.on('error',()=>process.exit(1));setTimeout(()=>process.exit(1),800)`], { timeout: 2000 });
  return r.status === 0;
}
function launcher() {
  if (proxyAlive()) return { cmd: 'claude', pre: [], env: { ANTHROPIC_BASE_URL: `http://127.0.0.1:${HEADROOM_PORT}` } };
  if (hasCommand('headroom')) return { cmd: 'headroom', pre: ['wrap', 'claude', '--'] };
  console.warn('경고: headroom 이 켜져 있지만 설치돼 있지 않아 claude 를 바로 실행합니다');
  return { cmd: 'claude', pre: [] };
}

// Windows 에서 claude 는 .cmd 라 셸을 거쳐야 한다 → 인자를 직접 따옴표로 감싼다. 프롬프트는 stdin 으로 보내 명령줄 길이 제한을 피한다.
const quote = (a) => (isWin ? `"${String(a).replace(/"/g, '\\"')}"` : `'${String(a).replace(/'/g, `'\\''`)}'`);
function spawnClaude(args, prompt, cwd, stderr) {
  const { cmd, pre, env } = launcher();
  const child = spawn(cmd, [...pre, ...args].map(quote), { cwd, shell: true, stdio: ['pipe', 'pipe', stderr], windowsHide: true, ...(env ? { env: { ...process.env, ...env } } : {}) });
  child.stdin.on('error', () => {}); // claude 가 먼저 끝나면 EPIPE — 무시하고 종료 코드로 판단
  child.stdin.end(prompt);
  return child;
}

// 멤버는 도구 목록과 상관없이 add·commit 까지 할 수 있다. push 는 넣지 않는다(승인 요청으로).
export const GIT_TOOLS = ['Bash(git add *)', 'Bash(git commit *)'];
// 멤버끼리 메시지·작업 만들기(squad msg·task add·log·ask)는 모든 멤버의 기본 권한 — 없으면 인계·질문을 못 한다(2026-10-19 order 가 task add 실패)
const SQUAD_BIN = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..', '..', 'bin', 'squad.mjs');
export const SQUAD_TOOLS = [...new Set([SQUAD_BIN.split(path.sep).join('/'), SQUAD_BIN])].flatMap((p) => [`Bash(node ${p} *)`, `Bash(node "${p}" *)`]);

// 승인을 거쳐야 하는 명령 — MEMBER.md 도구에 적혀 있어도 빼고, 승인되면 `squad approve run` 이 직접 실행한다.
// Bash·Bash(*)·Bash(git *)처럼 이 명령까지 덮는 넓은 규칙도 뺀다.
const RISKY_CMDS = ['git push', 'bash deploy/', 'sh deploy/', 'gcloud', 'prisma migrate deploy', 'npx prisma migrate deploy'];
export function safeTools(tools) {
  return tools.filter((t) => {
    if (t === 'Bash') return false;
    const m = /^Bash\((.*)\)$/.exec(t);
    if (!m) return true;
    const rule = m[1].trim();
    const prefix = rule.replace(/:?\*$/, '').trim();
    return !RISKY_CMDS.some((c) => rule.includes(c) || (rule !== prefix && c.startsWith(prefix)));
  });
}

/** 사람이 승인한 명령을 이번 실행에만 그 명령 그대로 허용한다(safeTools 를 거치지 않음). 와일드카드·괄호·쉼표(--allowedTools 구분자)·줄바꿈이 섞이면 넓어지거나 쪼개지므로 뺀다. */
export const allowRules = (cmds = []) => cmds.filter((c) => typeof c === 'string' && c.trim() && !/[*(),\r\n]/.test(c)).map((c) => `Bash(${c.trim()})`);

export const MAX_TURNS = 80;

// 난이도별 모델. hard 는 MEMBER.md model(없으면 claude 기본). config.models 로 덮어쓴다.
// CLI 가 아는 별칭으로 둔다(정식 id 는 설치된 CLI 버전에 따라 unrecognized_model 이 났다)
export const DEFAULT_MODELS = { easy: 'haiku', normal: 'claude-sonnet-5-5', hard: '' };
/** difficulty(easy|normal|hard) → 모델 이름. 난이도가 없으면 normal 로 본다(기본 Sonnet — 2026-10-19 난이도 없는 작업이 모두 Opus 로 돌았다). 멤버 모델이 있으면 그것. */
export function modelFor({ difficulty, memberModel = '', models = {} }) {
  if (!difficulty) {
    if (memberModel) return memberModel;
    difficulty = 'normal';
  }
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

/**
 * cwd 안의 .squad 가 정션·심볼릭 링크로 다른 곳(예: 구글 드라이브)을 가리키면 그 실제 경로.
 * claude 는 링크를 실제 경로로 풀어 작업 폴더 밖으로 보고 쓰기를 막는다(2026-10-19 NOTES.md 쓰기 거부) → --add-dir 로 연다.
 */
export function linkedDirs(cwd) {
  const p = path.resolve(cwd, '.squad');
  try {
    const real = fs.realpathSync.native(p);
    return path.resolve(real).toLowerCase() === p.toLowerCase() ? [] : [real];
  } catch {
    return [];
  }
}

/** mode 별 claude 인자. plan: 계획 JSON 한 덩어리, member: stream-json 으로 도구 사용을 줄마다. */
export function claudeArgs({ mode, model, tools, mcpFile, maxTurns, skills = false, appendFile = '', addDirs = [], resume = '', allow = [] }) {
  // 켠 플러그인·스킬이 있으면 Skill 도구를 허용한다(-p 는 허용 목록 밖 도구를 묻지 않고 막는다)
  const allowed = [...new Set([...safeTools(tools?.length ? tools : ['Read', 'Edit', 'Write', 'Glob', 'Grep']),...GIT_TOOLS, ...SQUAD_TOOLS, ...allowRules(allow), ...(skills ? ['Skill'] : [])])];
  const args =
    mode === 'plan'
      ? ['-p', '--output-format', 'json']
      : ['-p', '--output-format', 'stream-json', '--verbose', '--permission-mode', 'acceptEdits', '--allowedTools', allowed.join(','), '--max-turns', String(maxTurns || MAX_TURNS)];
  if (model) args.push('--model', model);
  // 재시도·반려·후속 수정은 앞 세션을 이어 쓴다(캐시 적중, 파일을 다시 읽지 않음)
  if (resume && mode !== 'plan') args.push('--resume', resume);
  // 이 PC 의 MCP·플러그인 도구 설명이 매 호출 수만 토큰 → 켠 것만 담은 설정으로 제한한다
  if (mcpFile) args.push('--mcp-config', mcpFile, '--strict-mcp-config');
  // 출력 스타일·켜진 기술 — -p 는 사용자 출력 스타일을 받지 않아 직접 붙인다. 여러 줄이라 파일로 넘긴다
  if (appendFile) args.push('--append-system-prompt-file', appendFile);
  for (const d of addDirs) args.push('--add-dir', d);
  return args;
}

/**
 * 실행하고 끝날 때까지 기다린다 → { code, text, isError, usage, timedOut, err }.
 * member 모드는 줄마다 onLine(원본)·onTool({tool, path}) 을 부른다.
 * member 모드는 plugins(켠 플러그인·스킬 이름)·outputStyle(MEMBER.md outputStyle)을 시스템 프롬프트 뒤에 붙인다(skills.mjs).
 * onLimit(한도)은 rate_limit_event 마다(lib/limits.mjs readLimit 모양).
 * onUsage(지금까지 토큰) 이 true 를 돌려주면 프로세스를 끝낸다(작업 예산 초과) → stopped: true.
 */
export async function exec({ prompt, cwd, mode = 'member', model = '', tools = [], mcp = [], maxTurns = 0, plugins = [], outputStyle = '', stderr = 'pipe', timeoutMs = 0, resume = '', allow = [], onLine, onTool, onUsage, onLimit }) {
  // 서버 정의에 env 비밀값이 있을 수 있어 본인만 읽게 쓰고 끝나면 지운다
  const mcpFile = path.join(os.tmpdir(), `squad-mcp-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.json`);
  fs.writeFileSync(mcpFile, JSON.stringify(mcpConfig(mcp, cwd)), { mode: 0o600 });
  const append = mode === 'member' ? systemAppend({ outputStyle, plugins }) : '';
  const appendFile = append ? mcpFile.replace(/\.json$/, '.md') : '';
  if (appendFile) fs.writeFileSync(appendFile, append, 'utf8');
  const skills = plugins.some((p) => p !== 'headroom');
  try {
    return await run({ prompt, cwd, mode, args: claudeArgs({ mode, model, tools, mcpFile, maxTurns, skills, appendFile, addDirs: linkedDirs(cwd), resume, allow }), stderr, timeoutMs, onLine, onTool, onUsage, onLimit });
  } finally {
    fs.rmSync(mcpFile, { force: true });
    if (appendFile) fs.rmSync(appendFile, { force: true });
  }
}

async function run({ prompt, cwd, mode, args, stderr, timeoutMs, onLine, onTool, onUsage, onLimit }) {
  const child = spawnClaude(args, prompt, cwd, stderr);
  let result = null;
  let stopped = false;
  let sessionId = '';
  let base = null;
  const meter = usageMeter();
  const r = await collect(child, {
    timeoutMs,
    keepOut: mode === 'plan',
    onLine:
      mode === 'plan'
        ? null
        : (line) => {
            onLine?.(line);
            sessionId ||= SESSION_RE.exec(line)?.[1] || '';
            const s = readStreamLine(line, cwd);
            if (!s) return;
            if (s.usage && base === null) base = baseContext(s.usage);
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
    usage: withBase(result?.usage || (stopped ? meter.usage() : null), base),
    ...(sessionId ? { sessionId } : {}),
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
