// 멤버 상주 — 같은 멤버의 다음 작업은 앞 세션을 이어 쓰고(앞부분이 캐시 읽기 0.1배), 저장소 CLAUDE.md 전체 대신 맡은 경로 규칙만 뽑은 브리프를 붙인다.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { gitRepos } from '../owns.mjs';

// ── 세션: data/<project>/sessions.json { "<member>:<runner>": { id, ctx, at } } ──
// ctx = 그 세션의 대략적 맥락 크기(마지막 실행의 시작 맥락 + 출력). 넘으면 새 세션 — 이어 갈 내용은 NOTES.md 인계 메모가 맡는다
// ponytail: 넘을 때 LLM 요약을 새 세션에 넘기지 않는다. 인계 메모로 모자라면 요약 단계를 더한다
export const SESSION_CAP = 150_000;
export const sessionsFile = (root, projectId) => path.join(root, 'data', projectId, 'sessions.json');

const readJson = (f) => {
  try {
    return JSON.parse(fs.readFileSync(f, 'utf8'));
  } catch {
    return {};
  }
};

/** 이어 쓸 세션 id. 없거나 맥락이 SESSION_CAP 을 넘었으면 ''. */
export function memberResume(file, member, runner) {
  const s = readJson(file)[`${member}:${runner}`];
  return s?.id && s.ctx < SESSION_CAP ? s.id : '';
}

/** 실행 결과의 세션을 그 멤버의 상주 세션으로 남긴다. usage 는 runner 결과의 usage(base 포함). */
export function saveMemberSession(file, member, runner, sessionId, usage) {
  if (!sessionId) return;
  const all = readJson(file);
  all[`${member}:${runner}`] = { id: sessionId, ctx: (usage?.base || 0) + (usage?.output || 0), at: Date.now() };
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(all, null, 1));
}

// ── 브리프: data/<project>/briefs/<member>.md ──
export const BRIEF_MAX = 5 * 1024;
export const briefFile = (root, projectId, memberId) => path.join(root, 'data', projectId, 'briefs', `${memberId}.md`);
const STAMP_RE = /^<!-- src:(\w+) -->\n/;

/** owns 글롭 → CLAUDE.md 에서 찾을 경로 낱말(저장소 prefix 를 뗀 경로, 4자 이상이면 마지막 폴더 이름도). */
export function ownsKeys(owns, prefix = '') {
  const keys = new Set();
  for (const o of owns) {
    if (!o.startsWith(prefix)) continue;
    const k = o.slice(prefix.length).replace(/\/?\*.*$/, '');
    if (!k) continue;
    keys.add(k);
    const last = k.split('/').pop();
    if (last.length >= 4) keys.add(last);
  }
  return [...keys];
}

/**
 * CLAUDE.md 를 제목(#~###) 단위로 나눠 첫 덩어리(공통 규칙)와 keys 를 말하는 덩어리만 원래 순서로 max 바이트 안에.
 * ponytail: 낱말 맞추기로 고른다(LLM 없음, 비용 0). 고른 결과가 부실하면 쉬운 모델 요약으로 바꾼다
 */
export function extractBrief(text, keys, max = BRIEF_MAX) {
  const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = keys.length ? new RegExp(`(^|[^\\w-])(${keys.map(esc).join('|')})([^\\w-]|$)`, 'm') : null;
  const secs = text.split(/^(?=#{1,3} )/m);
  let out = '';
  for (const [i, s] of secs.entries()) {
    if (i > 0 && !re?.test(s)) continue;
    if (Buffer.byteLength(out + s) > max) break;
    out += s;
  }
  return out.trim();
}

/**
 * 멤버 브리프(원문 CLAUDE.md 가 바뀌었을 때만 다시 만든다). 프로젝트·저장소에 CLAUDE.md 가 없으면 ''.
 * 돌려준 값이 있으면 runner exec 의 brief 로 넘긴다 → claude 는 프로젝트 CLAUDE.md 자동 로드를 끈다.
 */
export function memberBrief({ root, projectId, projectPath, member }) {
  const owns = member.owns || [];
  const repos = [{ dir: projectPath, prefix: '' }, ...gitRepos(projectPath).filter((r) => r.prefix)];
  const srcs = repos
    .map((r) => ({ ...r, file: path.join(r.dir, 'CLAUDE.md') }))
    .filter((r) => fs.existsSync(r.file) && (!r.prefix || owns.some((o) => o.startsWith(r.prefix))))
    .map((r) => ({ ...r, text: fs.readFileSync(r.file, 'utf8') }));
  if (!srcs.length) return '';
  const hash = crypto.createHash('sha1').update(JSON.stringify([owns, srcs.map((s) => [s.prefix, s.text])])).digest('hex').slice(0, 16);
  const file = briefFile(root, projectId, member.id);
  const old = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
  if (STAMP_RE.exec(old)?.[1] === hash) return old.replace(STAMP_RE, '');
  const per = Math.floor(BRIEF_MAX / srcs.length);
  const body = srcs.map((s) => `## ${s.prefix || './'}CLAUDE.md 중 맡은 경로 관련\n\n${extractBrief(s.text, ownsKeys(owns, s.prefix), per)}`).join('\n\n');
  const brief = `# 저장소 규칙 브리프 (전체는 각 CLAUDE.md — 필요할 때만 Read)\n\n${body}`;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `<!-- src:${hash} -->\n${brief}`);
  return brief;
}

// ── 효과 측정: 멤버별 평균 시작 맥락(usage.base), 브리프·상주 세션 전(before)과 후(after) ──
export function startContextStats(tasks) {
  const stats = {};
  for (const t of tasks) {
    const u = t.usage;
    if (!t.member || !u?.base) continue;
    const m = (stats[t.member] ||= { before: { n: 0, avg: 0 }, after: { n: 0, avg: 0 } });
    const g = u.brief || u.resumed ? m.after : m.before;
    g.avg = Math.round((g.avg * g.n + u.base) / ++g.n);
  }
  return stats;
}
