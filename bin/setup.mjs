// 다른 컴퓨터에서 같은 스쿼드를 열기 위한 도구 — 경로 풀기, projects.local.json 덮어쓰기, doctor 점검, migrate.
// 설치·삭제는 하지 않는다. ~/.claude 는 읽기만 한다.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/** %USERPROFILE%·$HOME·${VAR}·~ 를 풀고 base 기준 절대 경로로. 없는 변수는 그대로 둔다. */
export function expandPath(raw, base, env = process.env) {
  const get = (k) => env[k] ?? env[Object.keys(env).find((x) => x.toUpperCase() === k.toUpperCase())];
  const s = String(raw)
    .replace(/^~(?=$|[\\/])/, () => get('USERPROFILE') || get('HOME') || os.homedir())
    .replace(/%([A-Za-z_][A-Za-z0-9_]*)%|\$\{([A-Za-z_][A-Za-z0-9_]*)\}|\$([A-Za-z_][A-Za-z0-9_]*)/g, (m, a, b, c) => get(a || b || c) ?? m);
  return path.resolve(base, s);
}

/** 이 PC 와 상관없이 쓸 수 있는 경로인가(상대 경로·환경변수·~). 아니면 절대 경로. */
export const isPortable = (raw) => !path.isAbsolute(raw) || /%\w+%|\$\{?\w|^~/.test(raw);

const readJson = (f) => {
  try {
    return JSON.parse(fs.readFileSync(f, 'utf8')) || {};
  } catch {
    return {};
  }
};

/** projects.json 위에 projects.local.json(이 PC 전용, git 제외)을 프로젝트별로 덮어쓴다. 경로는 풀지 않은 원래 값. */
export function mergedProjects(root) {
  const base = readJson(path.join(root, 'projects.json'));
  const local = readJson(path.join(root, 'projects.local.json'));
  const out = { ...base };
  for (const [id, p] of Object.entries(local)) out[id] = { ...base[id], ...p };
  return out;
}

/** 프로젝트 하나의 실제 경로: path 와 스쿼드 문서 폴더(squadDir 이 있으면 저장소 기준, 없으면 <path>/.squad). */
export function resolveProject(root, p, env = process.env) {
  const dir = expandPath(p.path, root, env);
  return { path: dir, squad: p.squadDir ? expandPath(p.squadDir, root, env) : path.join(dir, '.squad') };
}

// ── doctor ──

const dirs = (d) => {
  try {
    return fs.readdirSync(d, { withFileTypes: true }).filter((e) => e.isDirectory() && !e.name.startsWith('.')).map((e) => e.name);
  } catch {
    return [];
  }
};

/**
 * 이 PC 의 Claude Code 에 설치된 플러그인 이름·사용자 스킬 이름.
 * plugins/installed_plugins.json(직접 설치) + plugins/synced/<묶음>/<플러그인>(계정 동기화),
 * skills/<스킬> + skills/synced/<묶음>/<스킬>(claude.ai 스킬).
 */
export function readInstalled(home = os.homedir()) {
  const pdir = path.join(home, '.claude', 'plugins');
  const sdir = path.join(home, '.claude', 'skills');
  const plugins = new Set(Object.keys(readJson(path.join(pdir, 'installed_plugins.json')).plugins || {}).map((k) => k.split('@')[0]));
  for (const b of dirs(path.join(pdir, 'synced'))) {
    for (const p of dirs(path.join(pdir, 'synced', b))) plugins.add(readJson(path.join(pdir, 'synced', b, p, '.claude-plugin', 'plugin.json')).name || p);
  }
  const skills = new Set(dirs(sdir).filter((s) => s !== 'synced'));
  for (const b of dirs(path.join(sdir, 'synced'))) for (const s of dirs(path.join(sdir, 'synced', b))) skills.add(s);
  return { plugins, skills };
}

// 로컬 파일로 확인할 수 없는 것: claude.ai 에서 오는 스킬 묶음
const CLOUD = new Set(['anthropic-skills']);

/**
 * MEMBER.md 의 플러그인 이름 하나 → { state: 'ok'|'missing'|'unknown', hint }.
 * `플러그인:스킬` 은 플러그인 설치 여부, 이름만 있으면 플러그인·사용자 스킬 둘 다 본다.
 * 둘 다 없으면 Claude Code 내장 스킬이나 MCP 커넥터일 수 있어 unknown 으로 둔다.
 */
export function checkPlugin(name, installed) {
  const [owner, skill] = name.includes(':') ? name.split(':') : [name, ''];
  if (installed.plugins.has(owner) || (!skill && installed.skills.has(owner))) return { state: 'ok', hint: '' };
  if (skill && CLOUD.has(owner)) {
    return installed.skills.has(skill) ? { state: 'ok', hint: '' } : { state: 'unknown', hint: 'claude.ai 스킬 — 같은 계정으로 로그인하면 동기화됨' };
  }
  if (skill) return { state: 'missing', hint: `claude 안에서 /plugin install ${owner} (마켓플레이스: /plugin marketplace add <주소>)` };
  return { state: 'unknown', hint: '내장 스킬·MCP 커넥터일 수 있음 — 없으면 /plugin install ' + owner };
}

const winKey = (p) => (process.platform === 'win32' ? path.resolve(p).toLowerCase() : path.resolve(p));

/** ~/.claude.json 의 projects[경로].hasTrustDialogAccepted. 경로 표기(c:/ · C:\)가 달라도 같게 본다. */
export function isTrusted(dir, home = os.homedir()) {
  const projects = readJson(path.join(home, '.claude.json')).projects || {};
  const k = Object.keys(projects).find((x) => winKey(x) === winKey(dir));
  return Boolean(k && projects[k].hasTrustDialogAccepted);
}

// ── migrate ──

/** .squad 에서 squads/<id>/ 로 옮길 파일 목록(잠금 폴더 제외). */
export function migrateFiles(src) {
  return fs.readdirSync(src, { recursive: true, withFileTypes: true })
    .filter((d) => d.isFile())
    .map((d) => path.relative(src, path.join(d.parentPath ?? d.path, d.name)))
    .filter((rel) => rel.split(path.sep)[0] !== 'locks')
    .sort();
}

/**
 * src 의 스쿼드 문서를 dst 로 복사하고 projects.json 의 squadDir 을 저장소 기준 상대 경로로 바꾼다.
 * 원본은 지우지 않는다(지우기는 사람이 확인 후). dst 가 이미 있으면 거절.
 */
export function migrate({ root, id, src, dst }) {
  if (!fs.existsSync(path.join(src, 'SQUAD.md'))) throw new Error(`스쿼드 문서가 없습니다: ${src}`);
  if (fs.existsSync(dst)) throw new Error(`이미 있습니다: ${dst}`);
  const files = migrateFiles(src);
  for (const rel of files) {
    fs.mkdirSync(path.dirname(path.join(dst, rel)), { recursive: true });
    fs.copyFileSync(path.join(src, rel), path.join(dst, rel));
  }
  const file = path.join(root, 'projects.json');
  const projects = readJson(file);
  if (!projects[id]) throw new Error(`projects.json 에 없는 프로젝트: ${id}`);
  projects[id].squadDir = path.relative(root, dst).split(path.sep).join('/');
  fs.writeFileSync(file, JSON.stringify(projects, null, 2) + '\n', 'utf8');
  return { files, squadDir: projects[id].squadDir };
}
