#!/usr/bin/env node
// AI Squad CLI — `node bin/squad.mjs <명령>`. 명령 목록은 `help`.
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import {
  appendJsonl, isId, loadMembers, loadProjects, memberFile, newId, projectPaths, readJsonl, saveProjects, updateTask,
} from '../lib/store.mjs';
import { setSection } from '../lib/md.mjs';
import { STATUS_LABEL, buildState, describeEvent, tokenTotal } from '../lib/state.mjs';
import { validateMessage, validateTask } from '../lib/validate.mjs';
import { planOrder, runMember, runOrder, saveOrder } from '../lib/runner.mjs';
import { loadConfig } from '../lib/config.mjs';
import { runnerStatuses, LOGIN_COMMAND } from '../lib/runners/index.mjs';
import { setSecret, secretsFile } from '../lib/secrets.mjs';
import { ACTIONS, DECISIONS, decideApproval, decisionText, loadApprovals, requestApproval, validateApprovalRequest } from '../lib/approvals.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const now = () => new Date().toISOString();

const HELP = `AI Squad CLI

  init <project> <path> [--name 이름]     .squad 뼈대와 projects.json 항목 만들기
  status [project]                         멤버별 상태 표
  order <project> "<지시>" [--dry] [--auto] [--headroom]
                                           메인 AI(squad.config.json mainAi)가 계획·실행 순서를 만들고, 사람이 승인하면 배정
                                           --dry: 계획만 / --auto: 승인 뒤 배정하고, 한 번 더 승인하면 순서대로 실행
  run <project> <member> [taskId] [--headroom]    멤버에게 작업 실행 (MEMBER.md 의 runner)
  approve request <project> <from> <push|deploy|migrate|send|delete> "<무엇을>" [--reason 이유] [--scope 저장소·경로] [--task T-..]
  approve list <project>                   승인 대기 목록 (approve 명령은 --demo 면 시연 파일에)
  approve yes|no <project> <approvalId> [--reason 사유]   승인·거절 (요청한 멤버에게 answer 메시지)
  auth status                              runner 별 연결 상태
  auth set <runner>                        외부 runner 의 API 키 넣기 (입력이 화면에 보이지 않음)
  auth clear <runner>                      저장한 키 지우기
  auth login                               claude 로그인 (claude auth login)
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

// ── 터미널 묻기 ──
/** y/N 질문. 터미널이 아니면(파이프·다른 프로그램) 승인으로 보지 않는다. */
async function ask(q) {
  if (!process.stdin.isTTY) {
    console.log(`${q}→ 터미널이 아니라 승인할 수 없습니다`);
    return false;
  }
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const a = await new Promise((r) => rl.question(q, r));
  rl.close();
  return /^(y|yes|예|네)$/i.test(a.trim());
}

/** 입력이 화면에 보이지 않게 한 줄 받는다. 파이프로 들어오면 첫 줄. */
function hidden(q) {
  const input = process.stdin;
  if (!input.isTTY) {
    return new Promise((resolve) => {
      let buf = '';
      input.setEncoding('utf8');
      input.on('data', (d) => (buf += d));
      input.on('end', () => resolve(buf.split(/\r?\n/)[0] || ''));
    });
  }
  process.stdout.write(q);
  return new Promise((resolve) => {
    let buf = '';
    const done = (v) => {
      input.setRawMode(false);
      input.pause();
      input.off('data', onData);
      process.stdout.write('\n');
      resolve(v);
    };
    const onData = (chunk) => {
      for (const c of chunk) {
        if (c === '\r' || c === '\n') return done(buf);
        if (c === '\u0003') {
          done('');
          return process.exit(130);
        }
        if (c === '\u007f' || c === '\b') buf = buf.slice(0, -1);
        else if (c >= ' ') buf += c;
      }
    };
    input.setRawMode(true);
    input.setEncoding('utf8');
    input.on('data', onData);
    input.resume();
  });
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
        project: paths, members, tasks: readJsonl(paths.tasks), messages: readJsonl(paths.messages), events: readJsonl(paths.events),
        approvals: loadApprovals(paths), stale: loadConfig(ROOT).stale,
      });
      const c = st.counts;
      console.log(`\n${paths.name} — 일하는 중 ${c.working} · 대기 작업 ${c.pending} · 막힘 ${c.blocked} · 승인 대기 ${c.approvals} · 멈춤 ${c.stalled} · 답 없는 인계 ${c.unanswered} · 오늘 ${st.tokensToday.total.toLocaleString('ko-KR')}토큰`);
      const rows = [['id', '이름', '상태', '지금 작업', '대기', '주의', '마지막 이벤트']];
      for (const m of st.members) {
        const warn = [m.stalled && '멈춤', m.unanswered && `답 없음 ${m.unanswered}`].filter(Boolean).join(' ') || '-';
        rows.push([m.id, m.name, STATUS_LABEL[m.status], cut(m.current || '-', 30), String(m.pending), warn, cut(m.lastEvent ? describeEvent(m.lastEvent) : '-', 36)]);
      }
      console.log(table(rows));
    }
  },

  async order([projectId, instruction], o) {
    if (!instruction) fail('사용법: order <project> "<지시>" [--dry] [--auto]');
    const { paths, members } = ctx(projectId);
    let r;
    try {
      r = await planOrder({ root: ROOT, paths, members, instruction, headroom: Boolean(o.headroom), stderr: 'inherit' });
    } catch (e) {
      fail(e.message);
    }
    const { plan, usage } = r;
    emit(paths, 'order', { type: 'plan', text: `계획 ${plan.length}개`, ...(usage ? { usage } : {}) });
    if (!plan.length) fail('메인 AI 가 배정할 작업을 내놓지 않았습니다. 지시를 더 구체적으로 써 주세요');
    const ordered = runOrder(plan);
    for (const p of ordered) console.log(`- [${p.step}] ${p.member}: ${p.title}${p.why ? `  (${p.why})` : ''}`);
    if (usage) console.log(`(계획 ${tokenTotal(usage).toLocaleString('ko-KR')}토큰)`);
    if (o.dry) return console.log('(--dry: 저장하지 않음)');
    // 자동 배정은 하지 않는다: 늘 사람이 이 터미널에서 승인해야 저장한다
    if (!(await ask(`작업 ${plan.length}개를 이대로 배정할까요? [y/N] `))) return console.log('배정하지 않았습니다');
    let tasks;
    try {
      tasks = saveOrder({ paths, members, instruction, plan: ordered });
    } catch (e) {
      fail(e.message);
    }
    console.log(`작업 ${tasks.length}개를 배정했습니다. 실행 순서:`);
    for (const t of tasks) console.log(`  [${t.step}] node bin/squad.mjs run ${paths.id} ${t.member} ${t.id}`);
    if (!o.auto) return;
    if (!(await ask('이 순서대로 지금 실행할까요? [y/N] '))) return console.log('실행하지 않았습니다. 위 명령으로 하나씩 실행하세요');
    // ponytail: 같은 step 도 하나씩 차례로 돈다. 동시에 돌려야 하면 step 묶음별 Promise.all.
    for (const t of tasks) {
      const m = members.find((x) => x.id === t.member);
      if (m.runner === 'external') {
        console.log(`건너뜀: ${m.name} — runner=external 이라 사람이 넘겨 주세요`);
        continue;
      }
      const res = await runMember({ root: ROOT, paths, member: m, task: t, headroom: Boolean(o.headroom) });
      console.log(res.ok ? `완료: ${res.summary}` : `막힘: ${res.summary}`);
      if (!res.ok) {
        process.exitCode = 1;
        return console.log('막힌 작업이 있어 뒤 순서는 멈췄습니다');
      }
    }
  },

  async run([projectId, memberId, taskId], o) {
    const { paths, members } = ctx(projectId);
    const m = members.find((x) => x.id === memberId);
    if (!m) fail(`멤버가 없습니다: ${memberId}`);
    if (m.runner === 'external') fail(`${m.name}: runner=external 이라 CLI 가 실행하지 않습니다`);
    if (!loadConfig(ROOT).runners[m.runner]) fail(`${m.name}: runner=${m.runner} 가 squad.config.json 의 runners 에 없습니다`);
    const tasks = readJsonl(paths.tasks);
    const task = taskId ? tasks.find((t) => t.id === taskId) : tasks.find((t) => t.member === m.id && t.status === 'todo');
    if (!task) fail(taskId ? `작업이 없습니다: ${taskId}` : `${m.name}: 할 일(todo) 작업이 없습니다`);
    const res = await runMember({ root: ROOT, paths, member: m, task, headroom: Boolean(o.headroom) });
    if (res.outside.length) console.log(`경고: 맡은 경로 밖 수정 ${res.outside.length}건 — 작업을 막힘으로 바꾸고 메인 오더에게 알렸습니다`);
    console.log(res.ok ? `완료: ${res.summary}` : `막힘: ${res.summary}`);
    if (!res.ok) process.exitCode = 1;
  },

  approve([sub, projectId, a, b, c], o) {
    const { paths, members } = ctx(projectId, { demo: Boolean(o.demo) }); // --demo: 시연 파일에만
    if (sub === 'request') {
      const v = validateApprovalRequest({ from: a, action: b, text: c, reason: o.reason, scope: o.scope, taskId: o.task }, members.map((m) => m.id));
      if (v.error) fail(v.error);
      const r = requestApproval(paths, v);
      emit(paths, v.from, { type: 'log', status: 'blocked', text: `승인 대기 · ${ACTIONS[v.action]}` });
      return console.log(`승인 요청 ${r.id} — 보드의 "승인 대기"나 approve yes|no 로 결정합니다. 결정 전에는 그 행위를 하지 마세요`);
    }
    if (sub === 'list') {
      const list = loadApprovals(paths).filter((x) => x.status === 'pending');
      if (!list.length) return console.log('승인 대기가 없습니다');
      return console.log(table([['id', '요청', '행위', '내용'], ...list.map((x) => [x.id, x.from, ACTIONS[x.action], cut(x.text, 50)])]));
    }
    if (sub === 'yes' || sub === 'no') {
      let d;
      try {
        d = decideApproval(paths, a, sub === 'yes' ? 'approved' : 'rejected', 'human', o.reason || '');
      } catch (e) {
        fail(e.message);
      }
      addMessage(paths, members, { from: 'human', to: d.from, kind: 'answer', taskId: d.taskId, text: decisionText(d) });
      return console.log(`${d.id} → ${DECISIONS[d.status]}`);
    }
    fail('사용법: approve request|list|yes|no ...');
  },

  async auth([sub, name]) {
    const config = loadConfig(ROOT);
    if (sub === 'status' || !sub) {
      const list = await runnerStatuses(config, { force: true });
      const rows = list.map((r) => [r.name + (r.main ? ' (메인)' : ''), r.type, r.stateLabel, r.secretSet === undefined ? '-' : r.secretSet ? '설정됨' : '없음', cut(r.detail || '-', 44)]);
      return console.log(table([['runner', '종류', '상태', '키', '비고'], ...rows]));
    }
    if (sub === 'login') {
      console.log(`claude 로그인: ${LOGIN_COMMAND} (브라우저에서 로그인하세요)`);
      return void spawnSync(LOGIN_COMMAND, { shell: true, stdio: 'inherit' });
    }
    if (sub === 'set' || sub === 'clear') {
      const r = config.runners[name];
      if (!r) fail(`runner 가 없습니다: ${name}`);
      if (!r.secret) fail(`${name}: 키를 쓰지 않는 runner 입니다 (squad.config.json 에 secret 이 없음)`);
      if (sub === 'clear') {
        setSecret(name, '');
        return console.log(`${name} 키를 지웠습니다`);
      }
      const v = (await hidden(`${name} 키 (입력이 보이지 않습니다): `)).trim();
      if (!v) fail('키가 비었습니다. 저장하지 않았습니다');
      setSecret(name, v);
      return console.log(`${name} 키를 저장했습니다 → ${secretsFile()}`);
    }
    fail('사용법: auth status|set|clear|login [runner]');
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
    reason: { type: 'string' }, name: { type: 'string' }, auto: { type: 'boolean' }, scope: { type: 'string' },
  },
});
const [cmd = 'help', ...rest] = positionals;
if (!commands[cmd]) fail(`모르는 명령: ${cmd}\n\n${HELP}`);
await commands[cmd](rest, values);
