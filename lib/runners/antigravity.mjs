// antigravity runner — Google Antigravity CLI(`agy -p`)로 멤버 작업·오더 계획을 실행한다.
// - stream-json 줄({event:'step_update'|'result'})을 claude 어댑터와 같은 이벤트(onTool·onUsage·결과)로 바꾼다.
// - 사용량은 usage.runner = 'antigravity' 를 붙여 돌려준다 → 이벤트·작업에 그대로 남아 runner 별로 나눠 셀 수 있다.
// - Claude Code 한도와 따로라 쉬운 작업·조사·검수를 넘기면 Claude 한도를 아낀다.
// - 한도·남은 양 필드는 실측 출력에 없었다 → 우리가 센 양만 남긴다(onLimit 없음).
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { toolPath } from '../claude.mjs';
import { usageMeter } from '../budget.mjs';
import { collect, isWin, killTree, notFoundHint } from './proc.mjs';

// `agy models` 실측(v1.4.2). 여기 없는 이름(claude-haiku-5-5 같은 Claude Code 모델)이 오면 기본 모델로 바꾼다.
export const AGY_MODELS = ['gemini-3.8-flash-low', 'gemini-3.8-flash-medium', 'gemini-3.8-flash-high', 'claude-sonnet-4-6', 'claude-opus-4-6-thinking', 'gpt-oss-120b-medium'];
export const DEFAULT_MODEL = 'gemini-3.8-flash-medium';
// Windows 명령줄은 32767자까지 → 넘을 것 같으면 프롬프트를 임시 파일로 넘긴다
const MAX_ARG = 24000;

/** 실행 파일 경로: cfg.bin(%VAR% 풀기) → 없으면 %LOCALAPPDATA%\agy\bin\agy.exe(Windows) · agy. */
export function agyBin(cfg = {}, env = process.env) {
  if (cfg.bin) return String(cfg.bin).replace(/%(\w+)%/g, (m, k) => env[k] ?? m);
  return isWin && env.LOCALAPPDATA ? path.join(env.LOCALAPPDATA, 'agy', 'bin', 'agy.exe') : 'agy';
}

export const pickModel = (model, cfg = {}) => (AGY_MODELS.includes(model) ? model : cfg.defaultModel || DEFAULT_MODEL);

/** agy 인자. 셸을 거치지 않고 .exe 를 바로 띄우므로 프롬프트를 그대로 인자로 넘긴다. */
export function agyArgs({ prompt, model, timeoutMs = 0, addDirs = [] }) {
  const args = ['--output-format', 'stream-json', '--model', model, '--mode', 'accept-edits'];
  if (timeoutMs) args.push('--print-timeout', `${Math.ceil(timeoutMs / 1000)}s`);
  for (const d of addDirs) args.push('--add-dir', d);
  return [...args, '-p', prompt];
}

const n = (v) => (Number.isFinite(v) && v >= 0 ? Math.round(v) : 0);
/** agy usage → 우리 모양. thinking 은 claude 처럼 출력에 넣는다. */
export function readAgyUsage(u) {
  if (!u || typeof u !== 'object') return null;
  return { input: n(u.input_tokens), output: n(u.output_tokens) + n(u.thinking_tokens), cacheRead: n(u.cache_read_tokens), cacheWrite: 0, runner: 'antigravity' };
}

/**
 * stream-json 한 줄 → { tools, usage?, stepId?, result? }. 모르는 줄은 null.
 * 도구는 ACTIVE 일 때 한 번만(DONE 은 같은 단계라 다시 세지 않는다). 경로는 tool_info.parameters 의 TargetFile·AbsolutePath 등.
 */
export function readAgyLine(line, projectPath) {
  let j;
  try {
    j = JSON.parse(line);
  } catch {
    return null;
  }
  if (j.event === 'step_update' && j.step_update) {
    const s = j.step_update;
    const tools = [];
    if (s.step_type === 'tool' && s.state === 'ACTIVE') {
      const p = s.tool_info?.parameters || {};
      const file = p.TargetFile || p.AbsolutePath || p.DirectoryPath || p.SearchPath || p.Path || '';
      tools.push({ tool: String(s.tool_name || s.tool_info?.name || '').slice(0, 60), path: toolPath({ path: file }, projectPath) });
    }
    const usage = readAgyUsage(s.usage);
    if (!tools.length && !usage) return null;
    return { tools, ...(usage ? { usage, stepId: `${s.conversation_id}:${s.step_index}` } : {}) };
  }
  if (j.event === 'result' && j.result) {
    const r = j.result;
    const text = String(r.response ?? r.error ?? '').trim();
    // 헤드리스는 권한을 물을 수 없어 도구를 거부하고, 빈 답에 status SUCCESS 를 준다 → 실패로 본다
    const denied = r.denied_actions?.length ? `도구 거부(denied): ${r.denied_actions.map((a) => a.display_name || a.action).join(', ')}` : '';
    return { tools: [], result: { text: [denied, text].filter(Boolean).join('\n'), isError: r.status !== 'SUCCESS' || Boolean(denied), usage: readAgyUsage(r.usage) } };
  }
  return null;
}

// 헤드리스 agy 는 셸 명령(run_command)을 자동 거부한다 → 시작부터 쓰지 않게 한다. 거부되면 실패로 보고 claude 로 대체(route.mjs)
export const AGY_RULE = '[실행 규칙] 셸 명령(run_command 등)은 쓰지 마세요 — 거부됩니다. 파일 읽기·검색·수정 도구만 쓰세요.\n\n';

/** 실행하고 끝날 때까지 기다린다 → claude 어댑터와 같은 모양 { code, text, isError, usage, timedOut, stopped, err }. */
export async function exec({ cfg = {}, prompt, cwd, model = '', stderr = 'pipe', timeoutMs = 0, onLine, onTool, onUsage }) {
  let file = null;
  let text = AGY_RULE + prompt;
  if (prompt.length > MAX_ARG) {
    file = path.join(os.tmpdir(), `squad-agy-${process.pid}-${Date.now()}.md`);
    fs.writeFileSync(file, prompt, 'utf8');
    text = `지시가 길어 파일에 있다: ${file}\n그 파일을 먼저 읽고 그 지시대로 작업한다.`;
  }
  try {
    const args = agyArgs({ prompt: text, model: pickModel(model, cfg), timeoutMs, addDirs: file ? [path.dirname(file)] : [] });
    const child = spawn(agyBin(cfg), args, { cwd, shell: false, stdio: ['ignore', 'pipe', stderr], windowsHide: true });
    let result = null;
    let stopped = false;
    const meter = usageMeter();
    const r = await collect(child, {
      timeoutMs,
      onLine: (line) => {
        onLine?.(line);
        const s = readAgyLine(line, cwd);
        if (!s) return;
        for (const t of s.tools) onTool?.(t);
        if (s.usage && !stopped && onUsage?.(meter.add(s.stepId, s.usage))) {
          stopped = true;
          killTree(child);
        }
        if (s.result) result = s.result;
      },
    });
    if (result?.isError && /log ?in|auth|credential|401/i.test(result.text + r.err)) lastStatus = { state: 'login', at: Date.now() };
    else if (r.code === 0 && result) lastStatus = { state: 'ok', at: Date.now() };
    const usage = result?.usage || (stopped ? { ...meter.usage(), runner: 'antigravity' } : null);
    return { code: r.code, timedOut: r.timedOut, stopped, text: result?.text || '', isError: !result || result.isError, usage, err: r.err + (r.code !== 0 ? notFoundHint(r.err) : '') };
  } finally {
    if (file) fs.rmSync(file, { force: true });
  }
}

// ── 연결 상태: `agy models` 가 성공하면 로그인된 것. 5분 동안은 다시 묻지 않는다. ──
let lastStatus = null;
let checking = null;
const TTL = 5 * 60 * 1000;

export function status({ cfg = {}, force = false } = {}) {
  if (!force && lastStatus && Date.now() - lastStatus.at < TTL) return Promise.resolve({ state: lastStatus.state });
  if (checking) return checking;
  const bin = agyBin(cfg);
  checking = new Promise((resolve) => {
    if (path.isAbsolute(bin) && !fs.existsSync(bin)) return resolve({ state: 'unset', detail: `agy CLI 가 없습니다: ${bin}` });
    const child = spawn(bin, ['models'], { shell: false, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    collect(child, { keepOut: true, timeoutMs: 30000 })
      .then((r) => resolve(r.code === 0 ? { state: 'ok' } : { state: 'login', detail: 'agy 로그인 필요 — 터미널에서 agy 실행' }))
      .catch(() => resolve({ state: 'unset', detail: 'agy 를 실행하지 못했습니다' }));
  }).then((s) => {
    checking = null;
    lastStatus = { state: s.state, at: Date.now() };
    return s;
  });
  return checking;
}
