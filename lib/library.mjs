// 에이전트 라이브러리 — library/<묶음>/<분류>/<이름>.md 를 멤버의 기반(base)으로 쓴다.
// 멤버 MEMBER.md frontmatter 에 `base: agency/testing/accessibility-auditor` 를 두면 runner 가
// 기반 문서(있으면 <이름>.brief.md 요약, 없으면 원문 본문)를 멤버 문서보다 먼저 프롬프트에 넣는다.
import fs from 'node:fs';
import path from 'node:path';
import { parseFrontmatter } from './md.mjs';

// 소문자·숫자·하이픈 조각을 / 로 2개 이상 — `..`·절대 경로·역슬래시를 막는다
const BASE_RE = /^[a-z0-9][a-z0-9-]*(\/[a-z0-9][a-z0-9-]*)+$/;
export const isBase = (s) => typeof s === 'string' && BASE_RE.test(s);

export const libraryDir = (root) => path.join(root, 'library');

/** 기반 경로 → 원문(.md) 또는 요약(.brief.md) 파일. 잘못된 경로면 throw. */
export function baseFile(root, base, brief = false) {
  if (!isBase(base)) throw new Error(`잘못된 라이브러리 경로: ${base}`);
  return path.join(libraryDir(root), ...base.split('/')) + (brief ? '.brief.md' : '.md');
}

/** 라이브러리 목록 [{ base, name, description, brief, chars, briefChars }] — LICENSE·SOURCE 같은 대문자 파일과 요약 파일은 뺀다. */
export function listLibrary(root) {
  const out = [];
  const walk = (dir, parts) => {
    let ents = [];
    try {
      ents = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of ents) {
      if (e.isDirectory()) walk(path.join(dir, e.name), [...parts, e.name]);
      else if (e.name.endsWith('.md') && !e.name.endsWith('.brief.md') && /^[a-z0-9]/.test(e.name)) {
        const base = [...parts, e.name.slice(0, -3)].join('/');
        if (!isBase(base)) continue;
        const text = fs.readFileSync(path.join(dir, e.name), 'utf8');
        const { data } = parseFrontmatter(text);
        const bf = baseFile(root, base, true);
        const brief = fs.existsSync(bf);
        out.push({ base, name: data.name || base, description: data.description || '', brief, chars: text.length, briefChars: brief ? fs.readFileSync(bf, 'utf8').length : 0 });
      }
    }
  };
  walk(libraryDir(root), []);
  return out.sort((a, b) => a.base.localeCompare(b.base));
}

/** 기반 문서 본문(요약 우선). base 가 비었거나 파일이 없으면 ''. */
export function readBase(root, base) {
  if (!base) return '';
  for (const brief of [true, false]) {
    let f;
    try {
      f = baseFile(root, base, brief);
    } catch {
      return '';
    }
    if (fs.existsSync(f)) return parseFrontmatter(fs.readFileSync(f, 'utf8')).body.trim();
  }
  return '';
}
