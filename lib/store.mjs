// 파일 저장소: projects.json, .squad/*.jsonl, data/events.jsonl, MEMBER.md 읽기·쓰기.
import fs from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { parseFrontmatter, getSection } from './md.mjs';

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
    name: p.name || projectId,
    path: p.path,
    squad,
    members: path.join(squad, 'members'),
    tasks: demo ? path.join(demoDir, projectId, 'tasks.jsonl') : path.join(squad, 'tasks.jsonl'),
    messages: demo ? path.join(demoDir, projectId, 'messages.jsonl') : path.join(squad, 'messages.jsonl'),
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
      plugins: arr(data.plugins),
      initials: data.initials || '',
      // headroom: true 면 run 이 headroom wrap claude 로 감싼다 (선택, 토큰 절약)
      headroom: data.headroom === 'true',
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
