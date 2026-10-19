#!/usr/bin/env node
// AI Squad CLI — `node bin/squad.mjs <명령>`. 명령 목록은 `help`.
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import {
  appendJsonl, isId, loadMembers, loadProjects, memberFile, newId, projectPaths, readJsonl, saveProjects, updateTask,
} from '../lib/store.mjs';
import { setSection } from '../lib/md.mjs';
import { STATUS_LABEL, buildState, describeEvent, tokenTotal } from '../lib/state.mjs';
import { validateMessage, validateTask } from '../lib/validate.mjs';
import { askMainAi, budgetGate, planOrder, runMember, runOrder, runQueue, runReview, saveOrder } from '../lib/runner.mjs';
import { waitDecision } from '../lib/approvals.mjs';
import { planNeedsConfirm } from '../lib/confirm.mjs';
import { addInbox, doneInbox, INBOX_LABEL, loadInbox, takeInbox } from '../lib/inbox.mjs';
import { buildReport, dateKey, isDateKey, polishPrompt } from '../lib/report.mjs';
import { capture, captureName } from '../lib/capture.mjs';
import { loadConfig } from '../lib/config.mjs';
import { runnerStatuses, LOGIN_COMMAND } from '../lib/runners/index.mjs';
import { withTaskLock } from '../lib/runners/lock.mjs';
import { retryOnce } from '../lib/runners/retry.mjs';
import { setSecret, secretsFile } from '../lib/secrets.mjs';
import { ACTIONS, DECISIONS, decideApproval, decisionText, loadApprovals, requestApproval, validateApprovalRequest } from '../lib/approvals.mjs';
import { INPUT_KINDS, requestInput, validateInputRequest } from '../lib/input.mjs';
import { askRequest } from './ask.mjs';
import { afterMessage } from './msg.mjs';
import {
  checkPlugin, expandPath, isPortable, isTrusted, mergedProjects, migrate, migrateFiles, readInstalled, resolveProject, setupPlan, toolList,
} from './setup.mjs';
import { hasCommand } from '../lib/runners/proc.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const now = () => new Date().toISOString();

const HELP = `AI Squad CLI

  init <project> <path> [--name 이름] [--squad-dir squads/<project>] [--local]
                                           .squad 뼈대와 projects.json 항목 만들기. path 는 상대 경로·%USERPROFILE% 그대로 저장
                                           --local: 이 PC 전용 projects.local.json(git 제외)에 경로만 덮어쓰기
  doctor [project]                         이 PC 점검: claude 로그인·headroom·멤버 플러그인 설치·경로·작업 공간 신뢰 (설치는 안 함)
  setup [--yes] [--json]                   빠진 도구(squad.config.json tools, 기본 claude·gemini·headroom)·멤버 플러그인을 확인 후 설치. 로그 logs/setup-*.log
                                           --json 만 주면 설치할 목록만 출력. 로그인은 하지 않고 안내만
  migrate <project> [--to squads/<project>] [--yes]   스쿼드 문서를 이 저장소로 복사하고 squadDir 지정 (--yes 없으면 미리보기)
  status [project]                         멤버별 상태 표
  order <project> "<지시>" [--dry] [--auto] [--headroom]
                                           메인 AI(squad.config.json mainAi)가 계획·실행 순서를 만들고, 사람이 승인하면 배정
                                           --dry: 계획만 / --auto: 승인 뒤 배정하고, 한 번 더 승인하면 순서대로 실행
  run <project> <member> [taskId] [--headroom] [--retry]    멤버에게 작업 실행 (MEMBER.md 의 runner). --retry: 실패 시 1회 재시도(시간 초과·잠금 충돌 제외)
  approve request <project> <from> <push|deploy|migrate|send|delete> "<무엇을>" [--reason 이유] [--scope 저장소·경로] [--task T-..]
                [--details-file 설명.md] [--diff-file 변경.sql|.diff] [--files a,b] [--cmd "명령"]... [--risk 낮음|보통|높음] [--rollback "되돌리는 방법"]
  ask <project> <from> preview|choice|form "<제목>" --task T-.. [--text 설명]
      preview: [--to 받는 곳] [--subject 제목] --body 본문|--body-file 본문.txt   (발송하지 않음 — 사람이 미리보기를 승인한 뒤에만)
      choice:  --option "id|라벨|캡처 경로"... (2개 이상)    form: --field "name[*]|라벨"... (* 는 필수, 비밀값 칸은 거부)
                                           작업을 입력 대기로 멈춘다. 답은 answer 메시지로 온다
  approve list <project>                   승인 대기 목록 (approve 명령은 --demo 면 시연 파일에)
  approve yes|no <project> <approvalId> [--reason 사유]   승인·거절 (요청한 멤버에게 answer 메시지)
  auth status                              runner 별 연결 상태
  auth set <runner>                        외부 runner 의 API 키 넣기 (입력이 화면에 보이지 않음)
  auth clear <runner>                      저장한 키 지우기
  auth login                               claude 로그인 (claude auth login)
  msg <project> <from> <to> "<내용>" [--kind note] [--task T-..]
                                           --kind question: 받는 멤버에게 답변 작업(easy)을 만들고 run-queue 를 백그라운드로
                                           --kind answer --task T: T 가 답을 기다리면(입력 대기·막힘) 다시 todo
  log <project> <member> "<내용>" [--status working|idle|blocked]
  task add <project> <member> "<제목>" [--detail 내용] [--after T-a,T-b]   (--after: 먼저 끝나야 하는 작업)
  task done <project> <taskId> [--summary 요약]
  task block <project> <taskId> [--reason 이유]
  run-queue <project> [--max 2] [--retry]          의존이 풀린 todo·검수 대기를 골라 담당 경로가 겹치지 않는 멤버끼리 동시에 실행
  review <project> <taskId>                검수 대기(review) 작업을 검수 멤버가 통과/반려
  report <project> [--date YYYY-MM-DD] [--ai] [--demo]
                                           일일 보고 → <project>/.squad/reports/<날짜>.md (--ai: 메인 AI 로 문장 다듬기)
  capture <project> <url> [--member id] [--task T-..] [--width 1440] [--height 900] [--demo]
                                           Chrome/Edge headless 로 화면을 찍어 data/captures/ 에 두고 작업·메시지에 첨부
  inbox <project> [--take] [--demo]        데스크톱 세션용 지시 목록 / 가장 오래된 대기 지시를 가져오기(처리 중으로)
  inbox add <project> "<지시>"             지시 넣기 (보드 명령 창의 "데스크톱 Claude 세션"과 같다)
  inbox done <id> "<결과>" [--project p]   처리 끝 표시
  board [--port 4777] [--demo]             보드 서버 (--demo: 시연 데이터 파일로)

  run·order·run-queue·review·report --ai 는 실행 전에 오늘 토큰 예산(squad.config.json budget)을 본다.
  80% 를 넘으면 승인 대기(budget)를 남기고 결정을 기다리고, 100% 를 넘으면 실행하지 않는다.`;

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

/**
 * 실행 전 예산 확인. → true(실행) | false(거절·시간 초과) | 'over'(100% 넘음)
 * 80% 를 넘으면 승인 대기(budget)를 남기고 보드의 확인 패널이나 `approve yes` 결정을 기다린다.
 */
async function gate(paths, members, subject, what, taskId) {
  const g = budgetGate({ root: ROOT, paths, members, subject, what, taskId });
  if (g.ok) return true;
  if (g.level === 'over') {
    console.log(`예산 초과: ${g.check.reason} — 실행하지 않습니다. squad.config.json 의 budget 을 올리거나 내일 다시 하세요`);
    return 'over';
  }
  console.log(`예산 경고: ${g.check.reason}\n승인 대기 ${g.approval.id} — 보드의 확인 패널이나 \`node bin/squad.mjs approve yes ${paths.id} ${g.approval.id}\` 로 결정하세요. 기다립니다(최대 10분)`);
  const d = await waitDecision(paths, g.approval.id);
  if (d === 'approved') return true;
  console.log(d === 'rejected' ? '예산 확인이 거절돼 실행하지 않습니다' : '결정이 없어 실행하지 않습니다');
  return false;
}

const localTime = (at) => {
  const d = new Date(at);
  const p = (n) => String(n).padStart(2, '0');
  return `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
};

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
    if (!isId(projectId) || !projectPath) fail('사용법: init <project> <path> [--squad-dir squads/<project>] [--local]');
    // 상대 경로(저장소 기준)·%USERPROFILE% 같은 환경변수는 풀지 않고 그대로 저장한다 → 다른 PC 에서도 같은 값
    const abs = expandPath(projectPath, ROOT);
    if (!fs.existsSync(abs)) fail(`경로가 없습니다: ${abs}`);
    const entry = { name: o.name || projectId.toUpperCase(), path: isPortable(projectPath) ? projectPath : abs };
    if (o['squad-dir']) entry.squadDir = o['squad-dir'];
    // --local: 이 PC 전용 projects.local.json(git 제외)에 경로만 덮어쓴다
    const file = path.join(ROOT, o.local ? 'projects.local.json' : 'projects.json');
    let projects = {};
    try {
      projects = JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch {
      // 처음 만듦
    }
    if (!projects[projectId] || o.local) {
      projects[projectId] = o.local ? { ...projects[projectId], path: entry.path, ...(entry.squadDir ? { squadDir: entry.squadDir } : {}) } : entry;
      fs.writeFileSync(file, JSON.stringify(projects, null, 2) + '\n', 'utf8');
      console.log(`${path.basename(file)} 에 ${projectId}: ${entry.path}`);
    }
    const squad = resolveProject(ROOT, mergedProjects(ROOT)[projectId]).squad;
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

  async doctor([projectId]) {
    const projects = mergedProjects(ROOT);
    const ids = projectId ? [projectId] : Object.keys(projects);
    if (projectId && !projects[projectId]) fail(`등록되지 않은 프로젝트: ${projectId}`);
    const rows = [];
    const add = (what, ok, fix = '') => rows.push([ok === true ? 'OK' : ok === false ? '없음' : '?', what, fix]);
    const claude = (await runnerStatuses(loadConfig(ROOT), { force: true })).find((r) => r.name === 'claude');
    add('claude CLI 로그인', claude?.state === 'ok', claude?.state === 'ok' ? '' : `${LOGIN_COMMAND} (설치: npm i -g @anthropic-ai/claude-code)`);
    const installed = readInstalled();
    const needHeadroom = new Set();
    for (const id of ids) {
      const { path: dir, squad } = resolveProject(ROOT, projects[id]);
      const there = fs.existsSync(dir);
      add(`${id} 경로 ${dir}`, there, there ? '' : `node bin/squad.mjs init ${id} <이 PC 의 경로> --local`);
      if (!there) continue;
      add(`${id} 작업 공간 신뢰`, isTrusted(dir), isTrusted(dir) ? '' : `cd "${dir}" && claude  (처음 뜨는 신뢰 질문에 Yes)`);
      const members = loadMembers({ members: path.join(squad, 'members') });
      add(`${id} 스쿼드 문서 ${squad}`, members.length > 0, members.length ? '' : `SQUAD.md·members/ 를 가져오거나 node bin/squad.mjs init ${id} <경로>`);
      const seen = new Map();
      for (const m of members) {
        if (m.headroom) needHeadroom.add(`${id}/${m.id}`);
        for (const p of m.plugins) {
          if (p === 'headroom') needHeadroom.add(`${id}/${m.id}`);
          else (seen.get(p) || seen.set(p, []).get(p)).push(m.id);
        }
      }
      for (const [p, who] of seen) {
        const c = checkPlugin(p, installed);
        add(`${id} 플러그인 ${p} (${who.join(',')})`, c.state === 'ok' ? true : c.state === 'missing' ? false : null, c.hint);
      }
    }
    if (needHeadroom.size) add(`headroom (${[...needHeadroom].slice(0, 3).join(',')}${needHeadroom.size > 3 ? ' 외' : ''})`, hasCommand('headroom'), hasCommand('headroom') ? '' : 'pip install headroom-ai  (또는 MEMBER.md 의 headroom 끄기)');
    console.log(table([['상태', '점검', '해결'], ...rows]));
    console.log('\n설치는 하지 않았습니다. 없음 은 위 해결 명령이나 node bin/squad.mjs setup 으로, ? 는 이 PC 에서 확인할 수 없는 것(내장 스킬·커넥터)입니다.');
    if (rows.some((r) => r[0] === '없음')) process.exitCode = 1;
  },

  async setup(_, o) {
    const plugins = [];
    for (const p of Object.values(mergedProjects(ROOT))) {
      const { path: dir, squad } = resolveProject(ROOT, p);
      if (fs.existsSync(dir)) for (const m of loadMembers({ members: path.join(squad, 'members') })) plugins.push(...m.plugins);
    }
    const check = (c) => spawnSync(c, { shell: true, stdio: 'ignore', timeout: 30_000 }).status === 0;
    const steps = setupPlan({ tools: toolList(ROOT), plugins, installed: readInstalled(), check });
    if (o.json && !o.yes) return console.log(JSON.stringify({ missing: steps }));
    if (!steps.length) return console.log('빠진 도구가 없습니다');
    console.log(`설치할 것 ${steps.length}개:\n${steps.map((s) => `  ${s.name}: ${s.cmd}`).join('\n')}`);
    if (!o.yes && !(await ask('위 명령을 순서대로 실행할까요? (y/N) '))) return console.log('설치하지 않았습니다');
    fs.mkdirSync(path.join(ROOT, 'logs'), { recursive: true });
    const log = path.join(ROOT, 'logs', `setup-${now().replace(/[:.]/g, '-')}.log`);
    const results = [];
    for (const s of steps) {
      const r = spawnSync(s.cmd, { shell: true, encoding: 'utf8', timeout: 600_000 });
      const ok = r.status === 0;
      fs.appendFileSync(log, `$ ${s.cmd}\nexit ${r.status ?? r.error?.message}\n${r.stdout || ''}${r.stderr || ''}\n`, 'utf8');
      results.push({ ...s, ok });
      if (!o.json) console.log(`${ok ? 'OK  ' : '실패'} ${s.name}`);
    }
    const logins = results.filter((s) => s.ok && s.login);
    if (o.json) console.log(JSON.stringify({ results, log }));
    else {
      console.log(`로그: ${log}`);
      // 로그인은 자동으로 하지 않는다. API 키는 squad auth set 으로만.
      for (const s of logins) console.log(`로그인 필요: 새 콘솔에서 ${s.login} 실행  (Windows: start "" cmd /k ${s.login})`);
    }
    if (results.some((s) => !s.ok)) process.exitCode = 1;
  },

  migrate([projectId], o) {
    const projects = mergedProjects(ROOT);
    if (!isId(projectId) || !projects[projectId]) fail('사용법: migrate <project> [--to squads/<project>] [--yes]');
    const { squad: src } = resolveProject(ROOT, projects[projectId]);
    const dst = path.resolve(ROOT, o.to || path.join('squads', projectId));
    if (path.resolve(src) === dst) return console.log(`이미 ${dst} 를 씁니다`);
    if (!fs.existsSync(path.join(src, 'SQUAD.md'))) fail(`스쿼드 문서가 없습니다: ${src}`);
    if (fs.existsSync(dst)) fail(`이미 있습니다: ${dst}`);
    const files = migrateFiles(src);
    console.log(`${src}\n→ ${dst}\n${files.map((f) => `  ${f}`).join('\n')}`);
    if (!o.yes) return console.log('\n(미리보기) 복사하려면 --yes. 원본은 지우지 않고, projects.json 의 squadDir 만 바꿉니다');
    let r;
    try {
      r = migrate({ root: ROOT, id: projectId, src, dst });
    } catch (e) {
      fail(e.message);
    }
    console.log(`${r.files.length}개 복사, projects.json ${projectId}.squadDir = ${r.squadDir}\n원본 ${src} 는 그대로 있습니다. 보드에서 확인한 뒤 직접 지우세요. *.jsonl 은 git 에 넣지 마세요`);
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
    if ((await gate(paths, members, 'order', `계획 · ${instruction.slice(0, 80)}`)) !== true) return void (process.exitCode = 1);
    let r;
    try {
      r = await planOrder({ root: ROOT, paths, members, instruction, headroom: Boolean(o.headroom) || loadConfig(ROOT).headroom.default, stderr: 'inherit' });
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
    // 보드 /api/order 와 같은 규칙: 확인이 필요 없으면 바로 배정하고 run-queue 를 백그라운드로 띄운다
    const c = planNeedsConfirm({ plan, members, config: loadConfig(ROOT) });
    if (!c.needsConfirm) {
      let saved;
      try {
        saved = saveOrder({ paths, members, instruction, plan: ordered });
      } catch (e) {
        fail(e.message);
      }
      const args = [fileURLToPath(import.meta.url), 'run-queue', paths.id, ...(o.headroom ? ['--headroom'] : [])];
      spawn(process.execPath, args, { cwd: ROOT, detached: true, stdio: 'ignore', windowsHide: true }).unref();
      return console.log(`작업 ${saved.length}개를 자동 배정했습니다. 대기열을 백그라운드로 시작했습니다 (진행은 status·보드에서)`);
    }
    console.log('확인이 필요합니다:');
    for (const why of c.reasons) console.log(`  - ${why}`);
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
      const g = await gate(paths, members, m.id, `실행 · ${t.title}`, t.id);
      if (g !== true) {
        process.exitCode = 1;
        return console.log('예산 확인을 넘지 못해 뒤 순서는 멈췄습니다');
      }
      const res = await withTaskLock(path.join(paths.squad, 'locks'), t.id, () => runMember({ root: ROOT, paths, member: m, task: t, members, headroom: Boolean(o.headroom) }));
      if (res.locked) {
        console.log(`건너뜀: ${t.id} — 이미 다른 곳에서 실행 중입니다`);
        continue;
      }
      console.log(res.ok ? `${res.status === 'review' ? '검수 대기' : '완료'}: ${res.summary}` : `막힘: ${res.summary}`);
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
    // 할 일이 없고 이 멤버가 검수할 작업이 있으면 검수를 한다
    const reviewing = !taskId && !tasks.some((t) => t.member === m.id && t.status === 'todo') && tasks.find((t) => t.status === 'review' && t.reviewer === m.id);
    if (reviewing) return commands.review([projectId, reviewing.id], o);
    const task = taskId ? tasks.find((t) => t.id === taskId) : tasks.find((t) => t.member === m.id && t.status === 'todo');
    if (!task) fail(taskId ? `작업이 없습니다: ${taskId}` : `${m.name}: 할 일(todo) 작업이 없습니다`);
    const wait = (task.dependsOn || []).filter((id) => tasks.find((t) => t.id === id && t.status !== 'done'));
    if (wait.length) fail(`선행 작업이 아직 끝나지 않았습니다: ${wait.join(', ')}`);
    if ((await gate(paths, members, m.id, `실행 · ${task.title}`, task.id)) !== true) return void (process.exitCode = 1);
    const res = await withTaskLock(path.join(paths.squad, 'locks'), task.id, () =>
      retryOnce(() => runMember({ root: ROOT, paths, member: m, task, members, headroom: Boolean(o.headroom) }), {
        retry: Boolean(o.retry),
        onRetry: (r) => console.log(`실패해서 한 번 더 실행합니다: ${String(r.summary).slice(0, 200)}`),
      }));
    if (res.locked) return console.log(`건너뜀: ${task.id} — 이미 다른 곳에서 실행 중입니다`);
    if (res.outside.length) console.log(`경고: 맡은 경로 밖 수정 ${res.outside.length}건 — 작업을 막힘으로 바꾸고 메인 오더에게 알렸습니다`);
    console.log(res.ok ? `${res.status === 'review' ? '검수 대기' : '완료'}: ${res.summary}` : `막힘: ${res.summary}`);
    if (!res.ok) process.exitCode = 1;
  },

  async 'run-queue'([projectId], o) {
    const { paths, members } = ctx(projectId);
    const max = Number(o.max || loadConfig(ROOT).queue?.max || 2);
    if (!Number.isInteger(max) || max < 1 || max > 8) fail('--max 는 1~8');
    console.log(`대기열 실행 — 동시에 ${max}개까지`);
    const r = await runQueue({
      root: ROOT, paths, max, headroom: Boolean(o.headroom), retry: Boolean(o.retry),
      loadMembers: () => loadMembers(paths),
      gate: (subject, what, taskId) => gate(paths, members, subject, what, taskId),
    });
    console.log(`끝: 실행 ${r.ran}건 · 막힘 ${r.blocked}건${r.stoppedBy ? ` · ${r.stoppedBy}로 멈춤` : ''}`);
    if (r.blocked || r.stoppedBy) process.exitCode = 1;
  },

  async review([projectId, taskId]) {
    const { paths, members } = ctx(projectId);
    const task = readJsonl(paths.tasks).find((t) => t.id === taskId);
    if (!task) fail(`작업이 없습니다: ${taskId}`);
    if (task.status !== 'review') fail(`검수 대기(review) 작업이 아닙니다: ${task.status}`);
    const rid = task.reviewer || loadConfig(ROOT).review.default;
    if ((await gate(paths, members, rid, `검수 · ${task.title}`, task.id)) !== true) return void (process.exitCode = 1);
    try {
      const v = await runReview({ root: ROOT, paths, members, task });
      console.log(v.pass ? `통과: ${v.note}` : `반려: ${v.note} — 담당 멤버에게 인계하고 할 일로 되돌렸습니다`);
    } catch (e) {
      fail(e.message);
    }
  },

  async report([projectId], o) {
    const { paths, members } = ctx(projectId, { demo: Boolean(o.demo) });
    const date = o.date || dateKey(Date.now());
    if (!isDateKey(date)) fail('--date 는 YYYY-MM-DD');
    const config = loadConfig(ROOT);
    const r = buildReport({
      project: paths, date, members, tasks: readJsonl(paths.tasks), messages: readJsonl(paths.messages),
      approvals: loadApprovals(paths), events: readJsonl(paths.events).filter((e) => e.project === paths.id), budget: config.budget,
    });
    let md = r.markdown;
    if (o.ai) {
      if ((await gate(paths, members, 'order', `보고 다듬기 · ${date}`)) === true) {
        try {
          const a = await askMainAi({ root: ROOT, paths, prompt: polishPrompt(md), stderr: 'inherit' });
          if (a.text.trim()) md = a.text.trim() + '\n';
          emit(paths, 'order', { type: 'plan', text: `보고 다듬기 ${date}`, ...(a.usage ? { usage: a.usage } : {}) });
        } catch (e) {
          console.log(`다듬기 실패, 규칙 기반 보고를 씁니다: ${e.message}`);
        }
      } else console.log('예산 확인을 넘지 못해 규칙 기반 보고를 씁니다');
    }
    const file = path.join(paths.reports, `${date}.md`);
    fs.mkdirSync(paths.reports, { recursive: true });
    fs.writeFileSync(file, md, 'utf8');
    console.log(`보고: ${file}  (한 일 ${r.counts.done} · 막힌 일 ${r.counts.blocked} · 내일 ${r.counts.next} · ${r.counts.tokens.toLocaleString('ko-KR')}토큰)`);
    if (config.report.copyTo) {
      try {
        const to = path.join(config.report.copyTo, `${paths.id}-${date}.md`);
        fs.mkdirSync(config.report.copyTo, { recursive: true });
        fs.copyFileSync(file, to);
        console.log(`복사: ${to}`);
      } catch (e) {
        console.log(`복사하지 못했습니다(report.copyTo): ${e.message}`);
      }
    }
  },

  async capture([projectId, url], o) {
    const { paths, members } = ctx(projectId, { demo: Boolean(o.demo) });
    if (!url) fail('사용법: capture <project> <url> [--member id] [--task T-..]');
    const who = o.member || 'human';
    if (who !== 'human' && !members.some((m) => m.id === who)) fail(`멤버가 없습니다: ${who}`);
    const tasks = readJsonl(paths.tasks);
    if (o.task && !tasks.some((t) => t.id === o.task)) fail(`작업이 없습니다: ${o.task}`);
    const width = Number(o.width || 1440), height = Number(o.height || 900);
    if (![width, height].every((n) => Number.isInteger(n) && n >= 320 && n <= 3840)) fail('--width·--height 는 320~3840');
    let name = captureName(paths.id, who);
    for (let i = 2; fs.existsSync(path.join(paths.captures, name)); i++) name = name.replace(/(-\d+)?\.png$/, `-${i}.png`);
    let r;
    try {
      r = await capture({ url, file: path.join(paths.captures, name), width, height });
    } catch (e) {
      fail(e.message);
    }
    const at = now();
    const att = { type: 'capture', name, width, height, at };
    if (o.task) {
      const t = tasks.find((x) => x.id === o.task);
      updateTask(paths.tasks, o.task, { attachments: [...(t.attachments || []), att].slice(-10) });
    }
    const safeUrl = url.replace(/([?&])t=[^&#]*/g, '$1t=…'); // 보드 접속 토큰은 남기지 않는다
    const v = validateMessage({ from: who, to: 'order', kind: 'note', taskId: o.task, text: `화면 캡처 ${width}×${height}: ${safeUrl}`.slice(0, 2000) }, members.map((m) => m.id));
    if (!v.error) appendJsonl(paths.messages, { id: newId('M'), at, ...v, attachments: [att] });
    console.log(`캡처: ${r.file} (${Math.round(r.bytes / 1024)}KB)${o.task ? ` → ${o.task} 에 첨부` : ''}`);
  },

  inbox([a, b, c], o) {
    if (a === 'done') {
      const ids = o.project ? [o.project] : Object.keys(loadProjects(ROOT));
      for (const id of ids) {
        const { paths } = ctx(id, { demo: Boolean(o.demo) });
        if (!loadInbox(paths).some((i) => i.id === b)) continue;
        try {
          doneInbox(paths, b, c || '');
        } catch (e) {
          fail(e.message);
        }
        return console.log(`${b} → 끝`);
      }
      fail(`inbox 지시가 없습니다: ${b}`);
    }
    if (a === 'add') {
      const { paths } = ctx(b, { demo: Boolean(o.demo) });
      try {
        return console.log(`inbox ${addInbox(paths, c).id}`);
      } catch (e) {
        fail(e.message);
      }
    }
    const { paths } = ctx(a, { demo: Boolean(o.demo) });
    if (o.take) {
      const it = takeInbox(paths);
      if (!it) return console.log('대기 중인 지시가 없습니다');
      return console.log(`${it.id} (처리 중으로 바꿈)\n${it.text}\n\n끝나면: node bin/squad.mjs inbox done ${it.id} "<결과>"`);
    }
    const list = loadInbox(paths).filter((i) => i.status !== 'done');
    if (!list.length) return console.log('대기·처리 중인 지시가 없습니다');
    console.log(table([['id', '상태', '받은 때', '지시'], ...list.map((i) => [i.id, INBOX_LABEL[i.status], localTime(i.at), cut(i.text, 50)])]));
  },

  approve([sub, projectId, a, b, c], o) {
    const { paths, members } = ctx(projectId, { demo: Boolean(o.demo) }); // --demo: 시연 파일에만
    if (sub === 'request') {
      const readOpt = (f, label) => {
        if (!f) return undefined;
        try {
          return fs.readFileSync(path.resolve(f), 'utf8');
        } catch {
          fail(`${label} 파일을 읽지 못했습니다: ${f}`);
        }
      };
      const v = validateApprovalRequest({
        from: a, action: b, text: c, reason: o.reason, scope: o.scope, taskId: o.task,
        details: readOpt(o['details-file'], '상세') ?? o.details, diff: readOpt(o['diff-file'], 'diff'),
        files: o.files ? o.files.split(',').map((x) => x.trim()).filter(Boolean) : undefined,
        commands: o.cmd?.length ? o.cmd : undefined, risk: o.risk, rollback: o.rollback,
      }, members.map((m) => m.id));
      if (v.error) fail(v.error);
      const r = requestApproval(paths, v);
      emit(paths, v.from, { type: 'log', status: 'blocked', text: `승인 대기 · ${ACTIONS[v.action]}` });
      return console.log(`승인 요청 ${r.id} — 보드의 확인 패널이나 approve yes|no 로 결정합니다. 결정 전에는 그 행위를 하지 마세요`);
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

  ask([projectId, from, kind, title], o) {
    const { paths, members } = ctx(projectId, { demo: Boolean(o.demo) });
    if (!o.task) fail('--task 작업 id 가 필요합니다');
    let body = o.body;
    if (o['body-file']) {
      try {
        body = fs.readFileSync(path.resolve(o['body-file']), 'utf8');
      } catch {
        fail(`본문 파일을 읽지 못했습니다: ${o['body-file']}`);
      }
    }
    const v = validateInputRequest(askRequest(from, kind, title, { ...o, body }), members.map((m) => m.id));
    if (v.error) fail(v.error);
    const t = readJsonl(paths.tasks).find((x) => x.id === o.task);
    if (!t) fail(`작업이 없습니다: ${o.task}`);
    if (t.member !== v.from) fail('자기 작업에만 입력을 요청할 수 있습니다');
    let next;
    try {
      next = requestInput(t, v, now());
    } catch (e) {
      fail(e.message);
    }
    updateTask(paths.tasks, t.id, { status: next.status, input: next.input });
    emit(paths, v.from, { type: 'log', status: 'blocked', text: `입력 대기 · ${INPUT_KINDS[v.kind]} · ${v.title}` });
    const send = v.kind === 'preview' ? ' 발송은 하지 않았습니다 — 사람이 미리보기를 승인한 뒤에만 보내세요.' : '';
    return console.log(`${t.id} → 입력 대기(${INPUT_KINDS[v.kind]}). 보드에서 답하면 answer 메시지로 옵니다. 그때까지 이 작업을 멈추세요.${send}`);
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
    const workers = members.map((m) => m.id).filter((id) => id !== 'order');
    const next = afterMessage(msg, { tasks: readJsonl(paths.tasks), workers, squadRoot: ROOT, project: paths.id });
    if (next.resume) {
      updateTask(paths.tasks, next.resume, { status: 'todo' });
      console.log(`${next.resume} → 다시 todo (답이 왔습니다)`);
    }
    if (next.task) {
      const t = addTask(paths, members, next.task, from);
      console.log(`${to} 에게 답변 작업 ${t.id}`);
    }
    // 새로 할 일이 생기면 run-queue 를 백그라운드로 (order 자동 배정과 같은 방식)
    if (next.task || next.resume) {
      spawn(process.execPath, [fileURLToPath(import.meta.url), 'run-queue', paths.id], { cwd: ROOT, detached: true, stdio: 'ignore', windowsHide: true }).unref();
    }
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
      const t = addTask(paths, members, { member: a, title: b, detail: o.detail, ...(o.after ? { dependsOn: o.after.split(',').map((x) => x.trim()).filter(Boolean) } : {}) });
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
    dry: { type: 'boolean' }, headroom: { type: 'boolean' }, retry: { type: 'boolean' }, demo: { type: 'boolean' }, port: { type: 'string' }, kind: { type: 'string' },
    task: { type: 'string' }, status: { type: 'string' }, detail: { type: 'string' }, summary: { type: 'string' },
    reason: { type: 'string' }, name: { type: 'string' }, auto: { type: 'boolean' }, scope: { type: 'string' },
    max: { type: 'string' }, date: { type: 'string' }, ai: { type: 'boolean' }, member: { type: 'string' }, width: { type: 'string' },
    height: { type: 'string' }, take: { type: 'boolean' }, project: { type: 'string' }, after: { type: 'string' },
    'details-file': { type: 'string' }, details: { type: 'string' }, 'diff-file': { type: 'string' }, files: { type: 'string' },
    cmd: { type: 'string', multiple: true }, risk: { type: 'string' }, rollback: { type: 'string' },
    text: { type: 'string' }, to: { type: 'string' }, subject: { type: 'string' }, body: { type: 'string' }, 'body-file': { type: 'string' },
    option: { type: 'string', multiple: true }, 'squad-dir': { type: 'string' }, local: { type: 'boolean' }, yes: { type: 'boolean' }, json: { type: 'boolean' }, field: { type: 'string', multiple: true },
  },
});
const [cmd = 'help', ...rest] = positionals;
if (!commands[cmd]) fail(`모르는 명령: ${cmd}\n\n${HELP}`);
await commands[cmd](rest, values);
