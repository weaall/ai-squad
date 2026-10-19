// 메인 오더 계획과 멤버 실행 — CLI(order·run)와 보드 서버(/api/order)가 같이 쓴다.
// 실제 실행은 runner 어댑터(lib/runners/)가 한다: 오더는 squad.config.json 의 mainAi, 멤버는 MEMBER.md 의 runner.
import fs from 'node:fs';
import path from 'node:path';
import { appendJsonl, memberFile, newId, readJsonl, readMemberDocs, updateTask } from './store.mjs';
import { setSection } from './md.mjs';
import { buildOrderPrompt, buildRunPrompt, parsePlan } from './claude.mjs';
import { validateMessage, validateTask } from './validate.mjs';
import { buildState, describeEvent } from './state.mjs';
import { loadConfig } from './config.mjs';
import { getRunner } from './runners/index.mjs';
import { diffSnapshots, gitSnapshot, outsideOwns } from './owns.mjs';

const read = (f) => {
  try {
    return fs.readFileSync(f, 'utf8');
  } catch {
    return '';
  }
};

/** 지금 상태(멈춤·답 없는 인계·대기 수 포함)를 붙인 멤버 목록. */
export function membersWithState({ root, paths, members, config = loadConfig(root) }) {
  return buildState({
    project: paths, members, tasks: readJsonl(paths.tasks), messages: readJsonl(paths.messages), events: readJsonl(paths.events), stale: config.stale,
  }).members;
}

/** 오더 프롬프트 조립: ORDER.md + SQUAD.md + 멤버 짧은 요약 + 지시. */
export function orderPrompt({ root, paths, members, instruction, config }) {
  return buildOrderPrompt({
    orderMd: read(path.join(root, 'ORDER.md')),
    squadMd: read(path.join(paths.squad, 'SQUAD.md')),
    members: membersWithState({ root, paths, members, config }),
    instruction,
  });
}

/**
 * 계획만 받는다(`order --dry` 와 같다) → { plan, usage, runner }. 저장하지 않는다. 실패하면 한국어 Error.
 * ponytail: 시간 제한은 하나(기본 5분). 길게 걸리는 지시가 잦으면 설정으로.
 */
export async function planOrder({ root, paths, members, instruction, headroom = false, timeoutMs = 300000, stderr = 'pipe' }) {
  const config = loadConfig(root);
  const runner = getRunner(config, config.mainAi.runner);
  const prompt = orderPrompt({ root, paths, members, instruction, config });
  const r = await runner.exec({ prompt, cwd: paths.path, mode: 'plan', model: config.mainAi.model, headroom, stderr, timeoutMs });
  if (r.timedOut) throw new Error(`${runner.name} 가 시간 안에 끝나지 않았습니다`);
  if (r.code !== 0) throw new Error(`${runner.name} 가 ${r.code} 로 끝났습니다${/설치/.test(r.err) ? ' (CLI 가 설치돼 있는지 확인하세요)' : ''}`);
  const plan = parsePlan(r.text, members.filter((m) => m.id !== 'order').map((m) => m.id));
  return { plan, usage: r.usage, runner: runner.name };
}

/** 계획을 저장한다: 사람 → 오더 지시 1건 + 멤버마다 작업과 오더 → 멤버 지시. 검증에 걸리면 아무것도 쓰지 않고 던진다. */
export function saveOrder({ paths, members, instruction, plan }) {
  const ids = members.map((m) => m.id);
  const at = new Date().toISOString();
  const first = validateMessage({ from: 'human', to: 'order', kind: 'order', text: instruction.slice(0, 2000) }, ids);
  if (first.error) throw new Error(first.error);
  const tasks = plan.map((p) => {
    const v = validateTask({ title: p.title, detail: p.detail, member: p.member }, ids.filter((id) => id !== 'order'));
    if (v.error) throw new Error(v.error);
    return { v, why: p.why || '', step: p.step || 1 };
  });
  appendJsonl(paths.messages, { id: newId('M'), at, ...first });
  return tasks.map(({ v, why, step }) => {
    const t = appendJsonl(paths.tasks, { id: newId('T'), ...v, step, createdBy: 'order', createdAt: at, updatedAt: at, summary: '' });
    const text = [v.title, why].filter(Boolean).join(' — ').slice(0, 2000);
    appendJsonl(paths.messages, { id: newId('M'), at, from: 'order', to: v.member, kind: 'order', taskId: t.id, text });
    return t;
  });
}

/** 실행 순서: step 오름차순, 같으면 들어온 순서. */
export const runOrder = (tasks) =>
  tasks.map((t, i) => [t, i]).sort((a, b) => (a[0].step || 1) - (b[0].step || 1) || a[1] - b[1]).map(([t]) => t);

const emit = (paths, member, ev) => appendJsonl(paths.events, { at: new Date().toISOString(), project: paths.id, member, ...ev });
function setCurrent(paths, member, text) {
  const file = memberFile(paths, member);
  if (!fs.existsSync(file)) return;
  fs.writeFileSync(file, setSection(fs.readFileSync(file, 'utf8'), '지금 작업', text), 'utf8');
}

/**
 * 멤버 한 명에게 작업 하나를 실행시킨다. 끝나면 작업 summary·usage, report 메시지, end 이벤트(usage 포함)를 남긴다.
 * 실행 전후 git status 를 비교해 owns 밖 수정이 있으면 작업을 blocked 로 바꾸고 메인 오더에게 경고한다(되돌리지 않음).
 * 돌려주는 값: { ok, summary, outside: [경로] }
 */
export async function runMember({ root, paths, member: m, task, headroom = false, out = console.log }) {
  const runner = getRunner(loadConfig(root), m.runner);
  const docs = readMemberDocs(paths, m.id);
  const prompt = buildRunPrompt({
    memberMd: docs.member, notesMd: docs.notes, task, squadRoot: root, project: paths.id, member: m.id,
    owns: m.owns, reads: m.reads, tools: m.tools, plugins: m.plugins,
  });

  const before = gitSnapshot(paths.path);
  updateTask(paths.tasks, task.id, { status: 'doing' });
  setCurrent(paths, m.id, task.title);
  emit(paths, m.id, { type: 'start', taskId: task.id, text: task.title });
  const logFile = path.join(paths.logs, m.id, `${task.id}.log`);
  fs.mkdirSync(path.dirname(logFile), { recursive: true });
  const log = fs.createWriteStream(logFile);
  out(`${m.name} 실행 (${runner.name}) — ${task.title}\n원본 로그: ${logFile}`);

  let r;
  try {
    r = await runner.exec({
      prompt, cwd: paths.path, mode: 'member', model: m.model, tools: m.tools, headroom: headroom || m.headroom, stderr: 'inherit',
      onLine: (line) => log.write(line + '\n'),
      onTool: (t) => {
        emit(paths, m.id, { type: 'tool', taskId: task.id, tool: t.tool, path: t.path });
        out(`  ${describeEvent({ type: 'tool', ...t })}`);
      },
    });
  } catch (e) {
    r = { code: -1, text: e.message, isError: true, usage: null };
  }
  log.end();

  let ok = r.code === 0 && !r.isError;
  let summary = (r.text || `종료 코드 ${r.code}`).slice(0, 2000);
  const outside = before.ok ? outsideOwns(diffSnapshots(before.map, gitSnapshot(paths.path).map), m.owns, m.id) : [];
  const at = () => new Date().toISOString();
  if (outside.length) {
    ok = false;
    const list = outside.slice(0, 8).join(', ') + (outside.length > 8 ? ` 외 ${outside.length - 8}개` : '');
    summary = `맡은 경로 밖 수정 ${outside.length}건: ${list}\n${summary}`.slice(0, 2000);
    appendJsonl(paths.messages, {
      id: newId('M'), at: at(), from: m.id, to: 'order', kind: 'note', taskId: task.id,
      text: `경고: 맡은 경로 밖 파일을 고쳤습니다 — ${list}. 되돌리지 않았습니다. 확인 뒤 작업 상태를 정해 주세요.`.slice(0, 2000),
    });
  }
  updateTask(paths.tasks, task.id, { status: ok ? 'done' : 'blocked', summary, ...(r.usage ? { usage: r.usage } : {}) });
  appendJsonl(paths.messages, { id: newId('M'), at: at(), from: m.id, to: 'order', kind: 'report', taskId: task.id, text: summary });
  setCurrent(paths, m.id, '');
  emit(paths, m.id, { type: 'end', taskId: task.id, status: ok ? 'idle' : 'blocked', text: ok ? '완료' : outside.length ? '경로 밖 수정' : '막힘', ...(r.usage ? { usage: r.usage } : {}) });
  return { ok, summary, outside };
}
