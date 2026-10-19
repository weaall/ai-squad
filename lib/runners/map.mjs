// 파일 지도 — data/<project>/map.md 에 멤버 owns 구역마다 '경로 — 한 줄 설명'(2~4KB)을 남긴다.
// - 쉬운 모델(또는 antigravity flash)로 만들고, 저장소 HEAD 가 바뀔 때만 다시 만든다.
// - 멤버 프롬프트에는 자기 구역(mapFor)만 붙인다 → 매번 Glob·Grep 으로 구조를 다시 찾지 않는다.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { gitRepos, globToRegExp } from '../owns.mjs';

export const MAP_MAX = 4096;
const git = (dir, args) => spawnSync('git', ['-C', dir, ...args], { encoding: 'utf8', windowsHide: true, maxBuffer: 64 << 20 }).stdout || '';

export const mapFile = (root, projectId) => path.join(root, 'data', projectId, 'map.md');

/** 저장소들의 HEAD 를 이은 지문 — 커밋이 바뀌면 달라진다. git 이 없으면 ''. */
export const headsOf = (projectPath) => gitRepos(projectPath).map((r) => git(r.dir, ['rev-parse', 'HEAD']).trim()).join(',');

/** git 이 아는 파일(프로젝트 기준 상대 경로). */
export const listFiles = (projectPath) =>
  gitRepos(projectPath).flatMap((r) => git(r.dir, ['ls-files']).split('\n').filter(Boolean).map((f) => r.prefix + f));

/** owns 에 맞는 파일 목록을 max 줄 안으로: 넘치면 깊은 단계부터 '폴더/ (n개)' 로 접는다. */
export function outline(files, owns, max = 80) {
  const res = owns.map(globToRegExp);
  const mine = files.filter((f) => res.some((r) => r.test(f)));
  let depth = Math.max(1, ...mine.map((f) => f.split('/').length));
  let rows;
  do {
    const m = new Map();
    for (const f of mine) {
      const p = f.split('/');
      const k = p.length > depth ? `${p.slice(0, depth).join('/')}/` : f;
      m.set(k, (m.get(k) || 0) + 1);
    }
    rows = [...m].map(([k, n]) => (k.endsWith('/') ? `${k} (${n}개)` : k));
  } while (rows.length > max && --depth > 0);
  return rows.sort();
}

export const mapPrompt = (member, rows) =>
  [
    `아래는 멤버 ${member} 가 맡은 구역의 파일·폴더 목록이다. 각 줄을 '경로 — 한 줄 설명(무엇이 들어 있는지, 30자 안팎)' 으로 바꿔라.`,
    '파일을 열지 말고 이름·구조로 판단한다. 모르면 설명 없이 경로만 둔다. 파일을 고치거나 명령을 실행하지 않는다.',
    `전체 3000자 이내, 목록 밖 말·머리말·코드 블록 없이 줄만 쓴다.`,
    '',
    ...rows,
  ].join('\n');

const HEAD_RE = /^<!-- heads: (.*) -->/;

/** map.md 에서 그 멤버 구역만(최대 MAP_MAX 자). 없으면 ''. */
export function mapFor(text, memberId) {
  const sec = String(text || '').split(/^## /m).find((s) => s.startsWith(`${memberId}\n`));
  return sec ? sec.slice(memberId.length + 1).trim().slice(0, MAP_MAX) : '';
}

export const BIG_CLAUDE_MD = 30 * 1024;

/**
 * 멤버가 매 실행 읽는 저장소 CLAUDE.md 중 limit 을 넘는 것 → [{ file, size, owner }].
 * owner: 그 저장소 안 owns 가 가장 많은 멤버(없으면 '').
 */
export function bigClaudeMds(projectPath, members, limit = BIG_CLAUDE_MD) {
  const repos = gitRepos(projectPath);
  return (repos.length ? repos : [{ dir: projectPath, prefix: '' }]).flatMap((r) => {
    const file = path.join(r.dir, 'CLAUDE.md');
    const size = fs.existsSync(file) ? fs.statSync(file).size : 0;
    if (size <= limit) return [];
    const score = (m) => (m.owns || []).filter((o) => o.startsWith(r.prefix)).length;
    const owner = members.filter((m) => m.id !== 'order' && score(m) > 0).sort((a, b) => score(b) - score(a))[0]?.id || '';
    return [{ file, size, owner }];
  });
}

/** 지도가 지금 커밋 기준인지. */
export const mapFresh = (text, heads) => Boolean(heads) && HEAD_RE.exec(text || '')?.[1] === heads;

/**
 * 커밋이 바뀌었으면(또는 force) 다시 만든다 → { file, fresh: 다시 만들었나, members: [id] }.
 * members: [{ id, owns }] · exec(prompt) → { text, isError, usage } (쉬운 모델 runner)
 */
export async function refreshMap({ root, projectId, projectPath, members, exec, force = false }) {
  const file = mapFile(root, projectId);
  const old = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
  const heads = headsOf(projectPath);
  if (!force && mapFresh(old, heads)) return { file, fresh: false, members: [] };
  const files = listFiles(projectPath);
  const parts = [`<!-- heads: ${heads} -->`];
  const done = [];
  for (const m of members) {
    const rows = m.owns?.length ? outline(files, m.owns) : [];
    if (!rows.length) continue;
    const r = await exec(mapPrompt(m.id, rows));
    // 실패하면 설명 없는 목록이라도 남긴다(경로만으로도 탐색이 준다)
    const body = !r.isError && r.text.trim() ? r.text.trim() : rows.join('\n');
    parts.push(`## ${m.id}\n${body.slice(0, MAP_MAX)}\n`);
    done.push(m.id);
  }
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, parts.join('\n'), 'utf8');
  return { file, fresh: true, members: done };
}
