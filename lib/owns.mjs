// 맡은 경로(owns) 밖 수정 감지 — run 전후로 대상 저장소의 `git status --porcelain` 을 비교한다. 되돌리지는 않는다.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

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
  const repos = gitRepos(projectPath);
  let ok = repos.length > 0;
  for (const r of repos) {
    const g = spawnSync('git', ['-c', 'core.quotePath=false', 'status', '--porcelain', '-z', '-uall'], { cwd: r.dir, encoding: 'utf8', windowsHide: true, maxBuffer: 32 * 1024 * 1024 });
    if (g.status !== 0) { ok = false; continue; }
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
  return { ok, map };
}
