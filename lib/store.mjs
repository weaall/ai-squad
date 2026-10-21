// 파일 저장소: projects.json, .squad/*.jsonl, data/events.jsonl, MEMBER.md 읽기·쓰기.
import fs from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { parseFrontmatter, getSection, setFrontmatterFlag, setFrontmatterValue } from './md.mjs';
import { loadConfig } from './config.mjs';
import { withTokenTools } from './tokentools.mjs';

export const ID_RE = /^[a-z0-9][a-z0-9-]{0,39}$/;
export const isId = (s) => typeof s === 'string' && ID_RE.test(s);

/** 시간순으로 정렬되는 짧은 id. 예: T-m2x8k1-3f9a */
export function newId(prefix) {
  return `${prefix}-${Date.now().toString(36)}-${randomBytes(2).toString('hex')}`;
}

export function readJsonl(file) {
  let text;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch {
    return [];
  }
  const out = [];
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue;
    try {
      out.push(JSON.parse(line));
    } catch {
      // 깨진 줄은 건너뛴다 (쓰는 도중 읽힌 마지막 줄 등)
    }
  }
  return out;
}

export function appendJsonl(file, obj) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.appendFileSync(file, JSON.stringify(obj) + '\n', 'utf8');
  return obj;
}

/** 통째로 다시 쓴다(임시 파일 → 이름 바꾸기). */
export function writeJsonl(file, rows) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, rows.map((r) => JSON.stringify(r)).join('\n') + (rows.length ? '\n' : ''), 'utf8');
  fs.renameSync(tmp, file);
}

export function loadProjects(root) {
  try {
    return JSON.parse(fs.readFileSync(path.join(root, 'projects.json'), 'utf8'));
  } catch {
    return {};
  }
}

export function saveProjects(root, projects) {
  fs.writeFileSync(path.join(root, 'projects.json'), JSON.stringify(projects, null, 2) + '\n', 'utf8');
}

/**
 * 프로젝트의 파일 위치. demo 이면 작업·대화·이벤트를 data/demo/ 아래 별도 파일로 읽고 쓴다
 * (멤버 문서는 실제 .squad 것을 그대로 보여 준다).
 */
export function projectPaths(root, projectId, { demo = false } = {}) {
  const projects = loadProjects(root);
  const p = projects[projectId];
  if (!p || !isId(projectId)) throw new Error(`등록되지 않은 프로젝트: ${projectId}`);
  const squad = path.join(p.path, '.squad');
  const demoDir = path.join(root, 'data', 'demo');
  return {
    id: projectId,
    root,
    name: p.name || projectId,
    path: p.path,
    // 이 프로젝트에서 쓸 수 있는 runner(projects.json runners). antigravity 가 있어야 작업 단위 라우팅이 켜진다
    runners: Array.isArray(p.runners) && p.runners.length ? p.runners : ['claude'],
    // 멤버마다 git worktree 에서 실행(projects.json worktree:true, lib/runners/worktree.mjs)
    worktree: p.worktree === true,
    squad,
    members: path.join(squad, 'members'),
    tasks: demo ? path.join(demoDir, projectId, 'tasks.jsonl') : path.join(squad, 'tasks.jsonl'),
    messages: demo ? path.join(demoDir, projectId, 'messages.jsonl') : path.join(squad, 'messages.jsonl'),
    approvals: demo ? path.join(demoDir, projectId, 'approvals.jsonl') : path.join(squad, 'approvals.jsonl'),
    inbox: demo ? path.join(demoDir, projectId, 'inbox.jsonl') : path.join(squad, 'inbox.jsonl'),
    reports: demo ? path.join(demoDir, projectId, 'reports') : path.join(squad, 'reports'),
    captures: path.join(root, 'data', 'captures'),
    ...(demo ? { toggles: path.join(demoDir, projectId, 'toggles.json') } : {}),
    events: demo ? path.join(demoDir, 'events.jsonl') : path.join(root, 'data', 'events.jsonl'),
    logs: path.join(root, 'logs', projectId),
  };
}

/** members/<id>/ 안의 파일 경로. id 를 검사하고 결과가 members 폴더 밖이면 거부한다. */
export function memberFile(paths, id, name = 'MEMBER.md') {
  if (!isId(id) || !['MEMBER.md', 'NOTES.md'].includes(name)) throw new Error('잘못된 멤버 경로');
  const file = path.resolve(paths.members, id, name);
  const base = path.resolve(paths.members) + path.sep;
  if (!file.startsWith(base)) throw new Error('잘못된 멤버 경로');
  return file;
}

function readText(file) {
  try {
    return fs.readFileSync(file, 'utf8');
  } catch {
    return '';
  }
}

/** 멤버 목록: frontmatter + 주요 절. 폴더 이름순, 단 order 가 맨 앞. */
export function loadMembers(paths) {
  let dirs = [];
  try {
    dirs = fs.readdirSync(paths.members, { withFileTypes: true }).filter((d) => d.isDirectory() && isId(d.name));
  } catch {
    return [];
  }
  const members = [];
  const overlay = readOverlay(paths);
  const headroomDefault = paths.root ? loadConfig(paths.root).headroom.default : true;
  for (const d of dirs) {
    const text = readText(memberFile(paths, d.name));
    if (!text) continue;
    const { data, body } = parseFrontmatter(text);
    members.push({
      id: d.name,
      name: data.name || d.name,
      runner: data.runner || 'claude',
      model: data.model || '',
      owns: arr(data.owns),
      reads: arr(data.reads),
      tools: arr(data.tools),
      // plugins: 켜기·끄기 맵(`이름: true|false`). 옛 배열 형식은 모두 켜진 것으로 본다.
      // pluginList 는 화면용 [{name, on}], plugins 는 켜진 이름만(프롬프트·오더 요약용)
      // ponytail·graphify 는 맵에 없으면 켜진 것(토큰 절약 기본값, lib/tokentools.mjs)
      pluginList: withTokenTools(flags(data.plugins, overlay[d.name]?.plugins)),
      plugins: withTokenTools(flags(data.plugins, overlay[d.name]?.plugins)).filter((p) => p.on).map((p) => p.name),
      initials: data.initials || '',
      // 실효 headroom: true 면 run 이 headroom wrap claude 로 감싼다 (토큰 절약)
      headroom: resolveHeadroom(overlay[d.name]?.headroom ?? data.headroom, headroomDefault),
      // v0.4: 멤버별 하루 토큰 상한(비우면 squad.config.json 의 budget.memberDaily), 검수 멤버
      // MEMBER.md maxTurns — 큰 작업 멤버는 실행 횟수 상한을 올린다(2026-10-19 runner·ui 가 40턴에 반복해서 멈춤)
      maxTurns: Number(data.maxTurns) > 0 ? Math.min(300, Math.round(Number(data.maxTurns))) : 0,
      budget: Number(data.budget) > 0 ? Math.round(Number(data.budget)) : 0,
      reviewer: isId(data.reviewer) && data.reviewer !== d.name ? data.reviewer : '',
      // 라이브러리 기반 직무(lib/library.mjs) — 예: agency/testing/accessibility-auditor
      base: typeof data.base === 'string' ? data.base : '',
      role: getSection(body, '역할'),
      current: getSection(body, '지금 작업'),
      handoff: getSection(body, '인계 메모'),
      dont: getSection(body, '하지 말 것'),
    });
  }
  members.sort((a, b) => (a.id === 'order' ? -1 : b.id === 'order' ? 1 : a.id.localeCompare(b.id)));
  return members;
}

const arr = (v) => (Array.isArray(v) ? v : v ? [v] : []);

/** 멤버의 실효 headroom. 'false'(또는 false)면 끄고, 'true' 면 켜고, 그 밖(없음·이상한 값)은 config headroom.default. */
export function resolveHeadroom(value, def = true) {
  if (value === false || value === 'false') return false;
  if (value === true || value === 'true') return true;
  return def;
}

/** 배열이나 {이름: bool} → [{name, on}]. over 는 시연용 덮어쓰기. */
export function flags(v, over = {}) {
  const base = Array.isArray(v) ? v.map((name) => [name, true]) : v && typeof v === 'object' ? Object.entries(v) : v ? [[v, true]] : [];
  return base.map(([name, on]) => ({ name, on: typeof over[name] === 'boolean' ? over[name] : on === true }));
}

/** 시연 모드의 켜기·끄기는 실제 MEMBER.md 대신 data/demo/<project>/toggles.json 에 둔다. */
function readOverlay(paths) {
  if (!paths.toggles) return {};
  try {
    return JSON.parse(fs.readFileSync(paths.toggles, 'utf8')) || {};
  } catch {
    return {};
  }
}

/**
 * 멤버의 플러그인 하나 또는 headroom 을 켜고 끈다. 실제 모드는 MEMBER.md frontmatter 의 그 값만, 시연 모드는 toggles.json.
 * kind: 'plugin' | 'headroom'
 */
export function setMemberToggle(paths, id, { kind, name, on }) {
  if (paths.toggles) {
    const all = readOverlay(paths);
    const m = (all[id] ||= {});
    if (kind === 'headroom') m.headroom = on;
    else (m.plugins ||= {})[name] = on;
    fs.mkdirSync(path.dirname(paths.toggles), { recursive: true });
    fs.writeFileSync(paths.toggles, JSON.stringify(all, null, 2), 'utf8');
    return;
  }
  const file = memberFile(paths, id);
  const text = fs.readFileSync(file, 'utf8');
  const next = kind === 'headroom' ? setFrontmatterValue(text, 'headroom', on ? 'true' : 'false') : setFrontmatterFlag(text, 'plugins', name, on);
  fs.writeFileSync(file, next, 'utf8');
}

export function readMemberDocs(paths, id) {
  return { member: readText(memberFile(paths, id)), notes: readText(memberFile(paths, id, 'NOTES.md')) };
}

/** tasks.jsonl 의 한 작업을 고친다. 없으면 null. */
export function updateTask(file, id, patch) {
  const rows = readJsonl(file);
  const t = rows.find((r) => r.id === id);
  if (!t) return null;
  Object.assign(t, patch, { updatedAt: new Date().toISOString() });
  // ponytail: 통째로 다시 쓰므로 같은 순간 다른 프로세스의 append 하나를 잃을 수 있다. 동시 실행이 잦아지면 잠금 파일.
  writeJsonl(file, rows);
  return t;
}
