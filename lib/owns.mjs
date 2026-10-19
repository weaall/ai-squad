// 맡은 경로(owns) 밖 수정 감지 — run 전후로 대상 저장소의 `git status --porcelain` 을 비교한다. 되돌리지는 않는다.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { parseNumstat } from './review.mjs';

/** `qugo_fe_web/app/**`, `*.md`, `a/?.ts` 같은 glob → 정규식. `**` 는 여러 폴더, `*` 는 한 폴더 안. */
export function globToRegExp(glob) {
  let g = String(glob).replace(/\\/g, '/').replace(/^\.\//, '');
  if (g.endsWith('/')) g += '**';
  let re = '';
  for (let i = 0; i < g.length; i++) {
    const c = g[i];
    if (c === '*' && g[i + 1] === '*') {
      if (g[i + 2] === '/') { re += '(?:.*/)?'; i += 2; } else { re += '.*'; i += 1; }
    } else if (c === '*') re += '[^/]*';
    else if (c === '?') re += '[^/]';
    else re += c.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp(`^${re}$`, process.platform === 'win32' ? 'i' : '');
}

/** 멤버가 고쳐도 되는 경로: owns + 자기 멤버 폴더 + 스쿼드 기록 파일(CLI 가 쓰는 것). */
export function allowedPatterns(owns, memberId) {
  return [...owns, `.squad/members/${memberId}/**`, '.squad/*.jsonl'];
}

export function outsideOwns(changed, owns, memberId) {
  const res = allowedPatterns(owns, memberId).map(globToRegExp);
  return changed.filter((p) => !res.some((r) => r.test(p)));
}

/** `git status --porcelain -z` 출력 → [{xy, path}]. 이름 바꾸기는 새 경로와 옛 경로 둘 다. */
export function parsePorcelainZ(text, prefix = '') {
  const parts = String(text).split('\0');
  const out = [];
  for (let i = 0; i < parts.length; i++) {
    const e = parts[i];
    if (e.length < 4) continue;
    const xy = e.slice(0, 2);
    out.push({ xy, path: prefix + e.slice(3) });
    if (xy[0] === 'R' || xy[0] === 'C') out.push({ xy, path: prefix + parts[++i] });
  }
  return out;
}

/** 두 스냅숏(Map 경로 → 지문)에서 달라진 경로. 생긴 것·없어진 것·지문이 바뀐 것. */
export function diffSnapshots(before, after) {
  const out = new Set();
  for (const [p, sig] of after) if (before.get(p) !== sig) out.add(p);
  for (const p of before.keys()) if (!after.has(p)) out.add(p);
  return [...out].sort();
}

/** 프로젝트 경로 자체가 저장소면 그것, 아니면 바로 아래 폴더 중 저장소들(QUGO: qugo_be_api, qugo_fe_web). */
export function gitRepos(projectPath) {
  if (fs.existsSync(path.join(projectPath, '.git'))) return [{ dir: projectPath, prefix: '' }];
  let dirs = [];
  try {
    dirs = fs.readdirSync(projectPath, { withFileTypes: true }).filter((d) => d.isDirectory() && fs.existsSync(path.join(projectPath, d.name, '.git')));
  } catch {
    return [];
  }
  return dirs.map((d) => ({ dir: path.join(projectPath, d.name), prefix: `${d.name}/` }));
}

/**
 * 지금 바뀌어 있는 파일들의 지문(상태 + 수정 시각 + 크기). 이미 더러운 파일을 또 고친 것도 잡는다.
 * git 이 없거나 저장소가 아니면 ok:false.
 */
export function gitSnapshot(projectPath) {
  const map = new Map();
  const heads = {}; // 하위 저장소 prefix → 실행 전 HEAD (검수용 diff 기준)
  const repos = gitRepos(projectPath);
  let ok = repos.length > 0;
  for (const r of repos) {
    const g = spawnSync('git', ['-c', 'core.quotePath=false', 'status', '--porcelain', '-z', '-uall'], { cwd: r.dir, encoding: 'utf8', windowsHide: true, maxBuffer: 32 * 1024 * 1024 });
    if (g.status !== 0) { ok = false; continue; }
    const h = git(r.dir, ['rev-parse', 'HEAD']);
    if (h.ok) heads[r.prefix] = h.out.trim();
    for (const { xy, path: p } of parsePorcelainZ(g.stdout, r.prefix)) {
      let st = '-';
      try {
        const s = fs.statSync(path.join(projectPath, p));
        st = `${s.mtimeMs}:${s.size}`;
      } catch {
        // 지운 파일
      }
      map.set(p, `${xy}|${st}`);
    }
  }
  return { ok, map, heads };
}

function git(cwd, args) {
  const g = spawnSync('git', ['-c', 'core.quotePath=false', ...args], { cwd, encoding: 'utf8', windowsHide: true, maxBuffer: 32 * 1024 * 1024 });
  return { ok: g.status === 0, out: g.stdout || '' };
}

/**
 * 이번 작업이 바꾼 파일과 줄 수 → [{path, add, del}]. 실행 전 HEAD 와 지금 작업 트리를 비교하되,
 * 이번에 달라진 파일(changed)과 그사이 커밋된 파일만 본다(남이 이미 고쳐 둔 파일은 빼려고). 새 파일(추적 안 됨)은 줄 수를 센다.
 */
export function taskDiffStat(projectPath, heads, changed) {
  const out = [];
  const seen = new Set();
  for (const r of gitRepos(projectPath)) {
    const base = heads?.[r.prefix];
    if (!base) continue;
    const mine = new Set(changed.filter((p) => p.startsWith(r.prefix)));
    for (const p of git(r.dir, ['diff', '--name-only', base, 'HEAD']).out.split(/\r?\n/)) if (p) mine.add(r.prefix + p);
    if (!mine.size) continue;
    for (const s of parseNumstat(git(r.dir, ['diff', '--numstat', base]).out, r.prefix)) {
      if (mine.has(s.path) && !seen.has(s.path)) out.push(s), seen.add(s.path);
    }
    for (const p of mine) {
      if (seen.has(p)) continue;
      let add = 0;
      try {
        const st = fs.statSync(path.join(projectPath, p));
        if (st.size < 2 * 1024 * 1024) {
          const t = fs.readFileSync(path.join(projectPath, p), 'utf8');
          add = t ? t.split('\n').length - (t.endsWith('\n') ? 1 : 0) : 0;
        }
      } catch {
        // 지운 파일
      }
      out.push({ path: p, add, del: 0 });
      seen.add(p);
    }
  }
  return out;
}
