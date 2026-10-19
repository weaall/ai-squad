#!/usr/bin/env node
// AI Squad CLI — `node bin/squad.mjs <명령>`. 명령 목록은 `help`.
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import {
  appendJsonl, isId, loadMembers, loadProjects, memberFile, newId, projectPaths, readJsonl,
  readMemberDocs, saveProjects, updateTask,
} from '../lib/store.mjs';
import { setSection } from '../lib/md.mjs';
import { STATUS_LABEL, buildState, describeEvent } from '../lib/state.mjs';
import { validateMessage, validateTask } from '../lib/validate.mjs';
import { buildRunPrompt, readStreamLine } from '../lib/claude.mjs';
import { planOrder, saveOrder, spawnClaude } from '../lib/runner.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const now = () => new Date().toISOString();

const HELP = `AI Squad CLI

  init <project> <path> [--name 이름]     .squad 뼈대와 projects.json 항목 만들기
  status [project]                         멤버별 상태 표
  order <project> "<지시>" [--dry] [--headroom]   메인 오더가 작업을 나눠 배정 (claude 호출)
  run <project> <member> [taskId] [--headroom]    멤버에게 작업 실행 (claude -p, 선택: headroom 으로 감싸기)
  msg <project> <from> <to> "<내용>" [--kind note] [--task T-..]
  log <project> <member> "<내용>" [--status working|idle|blocked]
  task add <project> <member> "<제목>" [--detail 내용]
  task done <project> <taskId> [--summary 요약]
  task block <project> <taskId> [--reason 이유]
  board [--port 4777] [--demo]             보드 서버 (--demo: 시연 데이터 파일로)`;

function fail(msg) {
  console.error(`오류: ${msg}`);
  process.exit(1);
}

function ctx(projectId, opts = {}) {
  if (!projectId) fail('프로젝트 id 가 필요합니다');
  try {
    const paths = projectPaths(ROOT, projectId, opts);
    return { paths, members: loadMembers(paths) };
  } catch (e) {
    fail(e.message);
  }
}

function emit(paths, member, ev) {
  return appendJsonl(paths.events, { at: now(), project: paths.id, member, ...ev });
}

function addMessage(paths, members, input) {
  const v = validateMessage(input, members.map((m) => m.id));
  if (v.error) fail(v.error);
  return appendJsonl(paths.messages, { id: newId('M'), at: now(), ...v });
}

function addTask(paths, members, input, createdBy = 'human') {
  const v = validateTask(input, members.map((m) => m.id));
  if (v.error) fail(v.error);
  const at = now();
  return appendJsonl(paths.tasks, { id: newId('T'), ...v, createdBy, createdAt: at, updatedAt: at, summary: '' });
}

function setCurrent(paths, member, text) {
  const file = memberFile(paths, member);
  if (!fs.existsSync(file)) return;
  fs.writeFileSync(file, setSection(fs.readFileSync(file, 'utf8'), '지금 작업', text), 'utf8');
}

// ── 화면 너비(한글 2칸)에 맞춘 표 ──
const width = (s) => [...s].reduce((n, c) => n + (/[ᄀ-ᅟ⺀-꓏가-힣豈-﫿＀-｠]/.test(c) ? 2 : 1), 0);
function cut(s, max) {
  let out = '';
  for (const c of String(s)) {
    if (width(out + c) > max - 1) return out + '…';
    out += c;
  }
  return out;
}
const pad = (s, n) => s + ' '.repeat(Math.max(0, n - width(s)));
function table(rows) {
  const ws = rows[0].map((_, i) => Math.max(...rows.map((r) => width(r[i]))));
  return rows.map((r) => r.map((c, i) => pad(c, ws[i])).join('  ').trimEnd()).join('\n');
}

// ── 명령 ──
const commands = {
  help() {
    console.log(HELP);
  },

  init([projectId, projectPath], o) {
    if (!isId(projectId) || !projectPath) fail('사용법: init <project> <path>');
    const abs = path.resolve(projectPath);
    if (!fs.existsSync(abs)) fail(`경로가 없습니다: ${abs}`);
    const projects = loadProjects(ROOT);
    if (!projects[projectId]) {
      projects[projectId] = { name: o.name || projectId.toUpperCase(), path: abs };
      saveProjects(ROOT, projects);
      console.log(`projects.json 에 ${projectId} 추가`);
    }
    const squad = path.join(abs, '.squad');
    const files = {
      'SQUAD.md': `# ${projects[projectId].name} 스쿼드\n\n## 개요\n\n## 멤버\n\n| id | 이름 | 담당 |\n|---|---|---|\n| order | 메인 오더 | 분배·조율 |\n\n## 공용 규칙\n`,
      'tasks.jsonl': '',
      'messages.jsonl': '',
      'members/order/MEMBER.md': `---\nid: order\nname: 메인 오더\nrunner: claude\nmodel:\nowns:\n  - .squad/**\nreads: []\ntools: [Read, Glob, Grep]\nplugins: []\n---\n\n## 역할\n\n지시를 받아 멤버에게 나눠 준다. 코드는 직접 고치지 않는다.\n\n## 지금 작업\n\n## 인계 메모\n\n## 하지 말 것\n`,
      'members/order/NOTES.md': '# 메인 오더 메모\n',
    };
    for (const [rel, body] of Object.entries(files)) {
      const f = path.join(squad, rel);
      if (fs.existsSync(f)) continue;
      fs.mkdirSync(path.dirname(f), { recursive: true });
      fs.writeFileSync(f, body, 'utf8');
      console.log(`만듦: ${f}`);
    }
  },

  status([projectId]) {
    const ids = projectId ? [projectId] : Object.keys(loadProjects(ROOT));
    for (const id of ids) {
      const { paths, members } = ctx(id);
      const st = buildState({
        project: paths, members, tasks: readJsonl(paths.tasks), messages: [], events: readJsonl(paths.events),
      });
      console.log(`\n${paths.name} — 일하는 중 ${st.counts.working} · 대기 작업 ${st.counts.pending} · 막힘 ${st.counts.blocked}`);
      const rows = [['id', '이름', '상태', '지금 작업', '대기', '마지막 이벤트']];
      for (const m of st.members) {
        rows.push([m.id, m.name, STATUS_LABEL[m.status], cut(m.current || '-', 30), String(m.pending), cut(m.lastEvent ? describeEvent(m.lastEvent) : '-', 36)]);
      }
      console.log(table(rows));
    }
  },

  async order([projectId, instruction], o) {
    if (!instruction) fail('사용법: order <project> "<지시>" [--dry]');
    const { paths, members } = ctx(projectId);
    let plan;
    try {
      plan = await planOrder({ root: ROOT, paths, members, instruction, headroom: Boolean(o.headroom) });
    } catch (e) {
      fail(e.message);
    }
    for (const p of plan) console.log(`- ${p.member}: ${p.title}${p.why ? `  (${p.why})` : ''}`);
    if (o.dry) return console.log('(--dry: 저장하지 않음)');
    try {
      saveOrder({ paths, members, instruction, plan });
    } catch (e) {
      fail(e.message);
    }
    console.log(`작업 ${plan.length}개를 배정했습니다`);
  },

  async run([projectId, memberId, taskId], o) {
    const { paths, members } = ctx(projectId);
    const m = members.find((x) => x.id === memberId);
    if (!m) fail(`멤버가 없습니다: ${memberId}`);
    if (m.runner !== 'claude') fail(`${m.name} 은(는) runner=${m.runner} 라 CLI 가 실행하지 않습니다`);
    const tasks = readJsonl(paths.tasks);
    const task = taskId ? tasks.find((t) => t.id === taskId) : tasks.find((t) => t.member === m.id && t.status === 'todo');
    if (!task) fail(taskId ? `작업이 없습니다: ${taskId}` : `${m.name} 의 todo 작업이 없습니다`);

    const docs = readMemberDocs(paths, m.id);
    const prompt = buildRunPrompt({ memberMd: docs.member, notesMd: docs.notes, task, squadRoot: ROOT, project: paths.id, member: m.id });
    const tools = m.tools.length ? m.tools : ['Read', 'Edit', 'Write', 'Glob', 'Grep'];
    const args = ['-p', '--output-format', 'stream-json', '--verbose', '--permission-mode', 'acceptEdits', '--allowedTools', tools.join(',')];
    if (m.model) args.push('--model', m.model);

    updateTask(paths.tasks, task.id, { status: 'doing' });
    setCurrent(paths, m.id, task.title);
    emit(paths, m.id, { type: 'start', taskId: task.id, text: task.title });
    const logFile = path.join(paths.logs, m.id, `${task.id}.log`);
    fs.mkdirSync(path.dirname(logFile), { recursive: true });
    const log = fs.createWriteStream(logFile);
    console.log(`${m.name} 실행 — ${task.title}\n원본 로그: ${logFile}`);

    const child = spawnClaude(args, prompt, paths.path, Boolean(o.headroom) || m.headroom);
    let result = null;
    for await (const line of readline.createInterface({ input: child.stdout })) {
      log.write(line + '\n');
      const r = readStreamLine(line, paths.path);
      if (!r) continue;
      for (const t of r.tools) {
        emit(paths, m.id, { type: 'tool', taskId: task.id, tool: t.tool, path: t.path });
        console.log(`  ${describeEvent({ type: 'tool', ...t })}`);
      }
      if (r.result) result = r.result;
    }
    const code = await new Promise((res) => (child.exitCode !== null ? res(child.exitCode) : child.on('close', res)));
    log.end();

    const ok = code === 0 && result && !result.isError;
    const summary = (result?.text || `종료 코드 ${code}`).slice(0, 2000);
    updateTask(paths.tasks, task.id, { status: ok ? 'done' : 'blocked', summary });
    addMessage(paths, members, { from: m.id, to: 'order', kind: 'report', taskId: task.id, text: summary });
    setCurrent(paths, m.id, '');
    emit(paths, m.id, { type: 'end', taskId: task.id, status: ok ? 'idle' : 'blocked', text: ok ? '완료' : '막힘' });
    console.log(ok ? `완료: ${summary}` : `막힘: ${summary}`);
    if (!ok) process.exitCode = 1;
  },

  msg([projectId, from, to, text], o) {
    const { paths, members } = ctx(projectId);
    const msg = addMessage(paths, members, { from, to, text, kind: o.kind, taskId: o.task });
    console.log(`메시지 ${msg.id}`);
  },

  log([projectId, memberId, text], o) {
    const { paths, members } = ctx(projectId);
    if (!members.some((m) => m.id === memberId)) fail(`멤버가 없습니다: ${memberId}`);
    if (!text || text.length > 500) fail('내용은 1~500자로 써 주세요');
    const status = o.status || 'working';
    if (!STATUS_LABEL[status]) fail('--status 는 working|idle|blocked');
    emit(paths, memberId, { type: 'log', status, text });
    if (status === 'working') setCurrent(paths, memberId, text);
    if (status === 'idle') setCurrent(paths, memberId, '');
    console.log(`${memberId}: ${STATUS_LABEL[status]} · ${text}`);
  },

  task([sub, projectId, a, b], o) {
    const { paths, members } = ctx(projectId);
    if (sub === 'add') {
      const t = addTask(paths, members, { member: a, title: b, detail: o.detail });
      return console.log(`작업 ${t.id}`);
    }
    if (sub === 'done' || sub === 'block') {
      const patch = sub === 'done' ? { status: 'done', summary: o.summary || '' } : { status: 'blocked', summary: o.reason || '' };
      const t = updateTask(paths.tasks, a, patch);
      if (!t) fail(`작업이 없습니다: ${a}`);
      return console.log(`${t.id} → ${patch.status}`);
    }
    fail('사용법: task add|done|block ...');
  },

  async board(_, o) {
    const { startBoard } = await import('../server/index.mjs');
    const port = Number(o.port || 4777);
    if (!Number.isInteger(port) || port < 1 || port > 65535) fail('--port 가 잘못됐습니다');
    await startBoard({ root: ROOT, port, demo: Boolean(o.demo) });
  },
};

const { values, positionals } = parseArgs({
  allowPositionals: true,
  strict: false,
  options: {
    dry: { type: 'boolean' }, headroom: { type: 'boolean' }, demo: { type: 'boolean' }, port: { type: 'string' }, kind: { type: 'string' },
    task: { type: 'string' }, status: { type: 'string' }, detail: { type: 'string' }, summary: { type: 'string' },
    reason: { type: 'string' }, name: { type: 'string' },
  },
});
const [cmd = 'help', ...rest] = positionals;
if (!commands[cmd]) fail(`모르는 명령: ${cmd}\n\n${HELP}`);
await commands[cmd](rest, values);
