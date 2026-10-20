// 토큰 절약 도구 — headroom 처럼 멤버 실행에 기본으로 켠다.
// - ponytail: Claude Code 전역 플러그인(최소 코드). 끄면 PONYTAIL_DEFAULT_MODE=off 로 그 실행에서만 끈다.
// - graphify: 코드 그래프(AST). 실행 전 `graphify update .`, 프롬프트에 "grep 전에 graphify query" 규칙, 실행별 절감 추정.
// 멤버 MEMBER.md plugins 맵에 `ponytail: false`·`graphify: false` 로 끈다(없으면 켜짐 — headroom 의 기본 켜짐과 같은 방식).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { collect, hasCommand, isWin } from './runners/proc.mjs';
import { lockTask } from './runners/lock.mjs';

export const TOKEN_TOOLS = ['ponytail', 'graphify'];
/** 플러그인 설치·스킬 목록에서 따로 다루는 이름(headroom 은 실행 감싸기, 나머지는 이 파일). */
export const isTokenTool = (n) => n === 'headroom' || TOKEN_TOOLS.includes(n);

/** [{name, on}] 에 빠진 토큰 도구를 켜진 채로 붙인다. */
export function withTokenTools(list = []) {
  const have = new Set(list.map((p) => p.name));
  return [...list, ...TOKEN_TOOLS.filter((n) => !have.has(n)).map((name) => ({ name, on: true }))];
}

const dirs = (d) => {
  try {
    return fs.readdirSync(d, { withFileTypes: true }).filter((x) => x.isDirectory()).map((x) => x.name);
  } catch {
    return [];
  }
};

/** graphify 실행 파일: PATH → SQUAD_GRAPHIFY → %APPDATA%\Python\Python3*\Scripts\graphify.exe(pip --user). 없으면 ''. */
export function graphifyBin(env = process.env, has = hasCommand) {
  if (env.SQUAD_GRAPHIFY && fs.existsSync(env.SQUAD_GRAPHIFY)) return env.SQUAD_GRAPHIFY;
  if (has('graphify')) return 'graphify';
  const base = env.APPDATA ? path.join(env.APPDATA, 'Python') : '';
  for (const d of dirs(base).sort().reverse()) {
    const f = path.join(base, d, 'Scripts', isWin ? 'graphify.exe' : 'graphify');
    if (fs.existsSync(f)) return f;
  }
  return '';
}

/** 절대 경로 graphify 를 멤버가 `graphify ...` 로 부를 수 있게 PATH 앞에 그 폴더를 붙인 env 조각. Windows 의 Path 대소문자를 지킨다. */
export function pathEnv(bin, env = process.env) {
  if (!bin || !path.isAbsolute(bin)) return {};
  const key = Object.keys(env).find((k) => /^path$/i.test(k)) || 'PATH';
  return { [key]: [path.dirname(bin), env[key]].filter(Boolean).join(path.delimiter) };
}

export const graphFile = (dir) => path.join(dir, 'graphify-out', 'graph.json');
const STAMP = '.squad-updated';

/**
 * dir 의 그래프를 만들거나 갱신한다(`graphify update .`, AST 만·오프라인). 실패해도 던지지 않는다.
 * - 같은 폴더는 동시에 갱신하지 않는다: <root>/data/locks 잠금, 잡혀 있으면 기다리지 않고 'locked'.
 * - freshMs(기본 5분) 안에 갱신했으면 'fresh'(qugo 는 바뀐 게 없어도 30~60초 — 대기열 멤버마다 쓰지 않게).
 * - graphify-out 을 새로 만들었으면 그 안에 .gitignore(*) — 저장소 git 상태를 더럽히지 않는다.
 * → { status: 'updated'|'fresh'|'locked'|'failed'|'missing', ms, text }
 */
export async function updateGraph({ root, dir, bin = graphifyBin(), timeoutMs = 180000, freshMs = 5 * 60000, now = Date.now() }) {
  if (!bin) return { status: 'missing', ms: 0, text: 'graphify 가 설치돼 있지 않습니다' };
  const outDir = path.join(dir, 'graphify-out');
  try {
    if (now - fs.statSync(path.join(outDir, STAMP)).mtimeMs < freshMs && fs.existsSync(graphFile(dir))) return { status: 'fresh', ms: 0, text: '방금 갱신함' };
  } catch {
    // 표시 파일 없음 → 갱신
  }
  const key = crypto.createHash('sha1').update(path.resolve(dir).toLowerCase()).digest('hex').slice(0, 12);
  const release = lockTask(path.join(root, 'data', 'locks'), `graphify-${key}`);
  if (!release) return { status: 'locked', ms: 0, text: '다른 실행이 갱신 중' };
  const had = fs.existsSync(outDir);
  const t0 = Date.now();
  try {
    const child = spawn(bin, ['update', '.'], { cwd: dir, shell: false, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    const r = await collect(child, { timeoutMs });
    const ok = r.code === 0 && !r.timedOut && fs.existsSync(graphFile(dir));
    if (fs.existsSync(outDir)) {
      if (!had) fs.writeFileSync(path.join(outDir, '.gitignore'), '*\n');
      if (ok) fs.writeFileSync(path.join(outDir, STAMP), new Date().toISOString());
    }
    return { status: ok ? 'updated' : 'failed', ms: Date.now() - t0, text: ok ? '' : r.timedOut ? `시간 초과(${Math.round(timeoutMs / 1000)}초)` : r.err.trim().split('\n').pop() || `종료 코드 ${r.code}` };
  } catch (e) {
    return { status: 'failed', ms: Date.now() - t0, text: e.message };
  } finally {
    release();
  }
}

/** `graphify query "<q>"` 한 번(Antigravity 처럼 셸을 못 쓰는 runner 에 미리 넣어 줄 결과). 실패하면 ''. */
export async function queryGraph({ dir, q, bin = graphifyBin(), budget = 800, timeoutMs = 30000 }) {
  if (!bin || !q.trim() || !fs.existsSync(graphFile(dir))) return '';
  try {
    const child = spawn(bin, ['query', q.slice(0, 300), '--budget', String(budget)], { cwd: dir, shell: false, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    const r = await collect(child, { timeoutMs, keepOut: true });
    return r.code === 0 ? r.out.trim().slice(0, 6000) : '';
  } catch {
    return '';
  }
}

// claude stream-json 의 Bash 명령에서 graphify 질의(query·path·explain)를 알아본다. 경로·.exe·따옴표가 붙어도
const CALL_RE = /(?:^|[\s;&|("'/\\])graphify(?:\.exe)?["']?\s+(query|path|explain)(?=\s|$)/;
export const isGraphifyCall = (cmd) => CALL_RE.test(String(cmd || ''));

/**
 * 실행 하나의 graphify 절감 추정기.
 * - line(raw): claude stream-json 줄 — Bash graphify 질의의 tool_use id 를 기억했다가 같은 id 의 tool_result 글자 수를 센다.
 * - add(text): 직접 질의한 결과(Antigravity 미리 넣기).
 * - result(): { calls, out, src, files, saved } | null — out: 돌려준 글자, src: 결과가 가리킨 파일(src=...) 전체 크기 합(바이트),
 *   saved = max(0, src - out). "그래프 대신 그 파일들을 통째로 읽었다면" 의 추정이다. 실측 아님.
 */
export function graphifyMeter(roots = []) {
  let calls = 0;
  let out = 0;
  const files = new Set();
  const pending = new Set();
  const add = (text) => {
    calls++;
    out += text.length;
    for (const m of text.matchAll(/\bsrc=([^\s\]]+)/g)) files.add(m[1]);
  };
  const line = (raw) => {
    if (!raw.includes('graphify') && !pending.size) return;
    let j;
    try {
      j = JSON.parse(raw);
    } catch {
      return;
    }
    const content = Array.isArray(j.message?.content) ? j.message.content : [];
    for (const c of content) {
      if (j.type === 'assistant' && c.type === 'tool_use' && c.name === 'Bash' && isGraphifyCall(c.input?.command)) pending.add(c.id);
      if (j.type === 'user' && c.type === 'tool_result' && pending.delete(c.tool_use_id)) {
        add(typeof c.content === 'string' ? c.content : Array.isArray(c.content) ? c.content.map((x) => x.text || '').join('') : '');
      }
    }
  };
  const size = (f) => {
    for (const r of roots) {
      try {
        return fs.statSync(path.resolve(r, f)).size;
      } catch {
        // 다음 뿌리
      }
    }
    return 0;
  };
  const result = () => {
    if (!calls) return null;
    const src = [...files].reduce((a, f) => a + size(f), 0);
    return { calls, out, src, files: files.size, saved: Math.max(0, src - out) };
  };
  return { line, add, result };
}

/**
 * 멤버 프롬프트에 넣을 토큰 절약 규칙. 켜진 도구만. 그래프가 없으면 graphify 규칙은 넣지 않는다.
 * runner 가 antigravity 면 셸을 못 쓰므로 미리 질의한 결과(prequery)를 보라고 쓴다.
 * graph: 쓸 graph.json(worktree 면 원래 트리 것 → --graph 로 가리킨다), update: 코드 수정 뒤 갱신하라고 쓸지.
 */
export function tokenRules({ graphify = false, ponytail = false, runner = 'claude', graph = '', worktree = false, prequery = '' }) {
  const lines = [];
  if (graphify && graph) {
    if (runner === 'antigravity') {
      lines.push('- 코드 위치·구조는 아래 "graphify 결과"(코드 그래프)를 먼저 본다. 원본은 그 결과가 가리킨 파일(src=)의 그 줄(loc=) 근처만 읽고, 거기 없을 때만 검색한다.');
    } else {
      const g = worktree ? ` --graph "${graph}"` : '';
      lines.push(`- 코드 질문(어디 있나·누가 부르나·구조)은 grep·파일 읽기 전에 \`graphify query "<질문>"${g}\` · \`graphify path "A" "B"${g}\` · \`graphify explain "X"${g}\` 를 먼저 쓴다. 원본은 그래프가 가리킨 파일(src=)의 그 줄(loc=) 근처만 읽는다.`);
      if (!worktree) lines.push('- 코드를 고친 뒤에는 `graphify update .` 로 그래프를 갱신한다.');
    }
  }
  if (ponytail) lines.push('- ponytail: 요청된 것만 가장 짧게 — 안 쓸 추상화·설정·파일을 만들지 않고, 이미 있는 함수·표준 라이브러리를 먼저 쓴다.');
  if (!lines.length) return '';
  const pre = graphify && graph && runner === 'antigravity' && prequery ? ['', '## graphify 결과 (작업 제목으로 미리 질의)', prequery] : [];
  return ['# 토큰 절약 규칙', ...lines, ...pre].join('\n');
}

/** ponytail 플러그인 설치·켜짐(~/.claude 를 읽기만). → { installed, enabled } */
export function ponytailState(home = os.homedir()) {
  const read = (f) => {
    try {
      return JSON.parse(fs.readFileSync(f, 'utf8'));
    } catch {
      return {};
    }
  };
  const key = (o) => Object.keys(o || {}).find((k) => k.split('@')[0] === 'ponytail');
  const inst = read(path.join(home, '.claude', 'plugins', 'installed_plugins.json')).plugins;
  const enabled = read(path.join(home, '.claude', 'settings.json')).enabledPlugins;
  const k = key(enabled);
  return { installed: Boolean(key(inst)), enabled: Boolean(k && enabled[k]) };
}
