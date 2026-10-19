// 메인 오더 계획과 멤버 실행 — CLI(order·run·run-queue·review)와 보드 서버(/api/order)가 같이 쓴다.
// 실제 실행은 runner 어댑터(lib/runners/)가 한다: 오더는 squad.config.json 의 mainAi, 멤버는 MEMBER.md 의 runner.
import fs from 'node:fs';
import path from 'node:path';
import { appendJsonl, memberFile, newId, readJsonl, readMemberDocs, updateTask } from './store.mjs';
import { setSection } from './md.mjs';
import { buildOrderPrompt, buildRunPrompt, parsePlan } from './claude.mjs';
import { validateMessage, validateTask } from './validate.mjs';
import { budgetTokens, buildState, describeEvent } from './state.mjs';
import { loadConfig } from './config.mjs';
import { getRunner } from './runners/index.mjs';
import { diffSnapshots, gitSnapshot, outsideOwns, taskDiffStat } from './owns.mjs';
import { checkBudget, memberLimit, overTaskCap, usageOn } from './budget.mjs';
import { budgetApproved, loadApprovals, pendingBudget, requestApproval } from './approvals.mjs';
import { pickRunnable } from './queue.mjs';
import { buildReviewPrompt, parseVerdict, reviewerFor, summarizeDiff } from './review.mjs';

const read = (f) => {
  try {
    return fs.readFileSync(f, 'utf8');
  } catch {
    return '';
  }
};
const now = () => new Date().toISOString();

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

// ── 토큰 예산 ──
/**
 * 실행 전 예산 확인. subject 는 멤버 id(오더는 'order').
 * → { ok: true, check } | { ok: false, level: 'over', check } | { ok: false, level: 'warn', check, approval }
 * warn 이면 승인 대기(action: budget)를 하나 남긴다(이미 대기 중이면 그것). 오늘 이미 승인받았으면 ok.
 */
export function budgetGate({ root, paths, members, subject, what, taskId, config = loadConfig(root) }) {
  const usage = usageOn(readJsonl(paths.events));
  const m = members.find((x) => x.id === subject);
  const check = checkBudget({ budget: config.budget, used: usage.total, memberUsed: usage.byMember[subject] || 0, memberCap: memberLimit(config.budget, m) });
  if (check.level === 'ok') return { ok: true, check };
  if (check.level === 'over') return { ok: false, level: 'over', check };
  const approvals = loadApprovals(paths);
  if (budgetApproved(approvals, subject)) return { ok: true, check };
  const approval =
    pendingBudget(approvals, subject) ||
    requestApproval(paths, {
      from: subject, action: 'budget', text: `예산 ${Math.round(check.ratio * 100)}% — ${what}`.slice(0, 500), reason: check.reason,
      scope: '오늘 남은 토큰 예산', ...(taskId ? { taskId } : {}),
    });
  return { ok: false, level: 'warn', check, approval };
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

/** 메인 AI 로 글 하나를 받는다(보고 다듬기 등). 실패하면 Error. */
export async function askMainAi({ root, paths, prompt, timeoutMs = 180000, stderr = 'pipe' }) {
  const config = loadConfig(root);
  const runner = getRunner(config, config.mainAi.runner);
  const r = await runner.exec({ prompt, cwd: paths.path, mode: 'plan', model: config.mainAi.model, stderr, timeoutMs });
  if (r.timedOut || r.code !== 0 || r.isError) throw new Error(`${runner.name} 가 답하지 못했습니다${r.timedOut ? ' (시간 초과)' : ` (${r.code})`}`);
  return { text: r.text, usage: r.usage };
}

/**
 * 계획을 저장한다: 사람 → 오더 지시 1건 + 멤버마다 작업과 오더 → 멤버 지시.
 * 계획의 dependsOn(같은 계획 안의 key)은 새 작업 id 로 바꿔 넣는다. 검증에 걸리면 아무것도 쓰지 않고 던진다.
 */
export function saveOrder({ paths, members, instruction, plan }) {
  const ids = members.map((m) => m.id);
  const at = now();
  const first = validateMessage({ from: 'human', to: 'order', kind: 'order', text: instruction.slice(0, 2000) }, ids);
  if (first.error) throw new Error(first.error);
  const keyOf = (p, i) => p.key || `k${i + 1}`;
  const idOf = new Map(plan.map((p, i) => [keyOf(p, i), newId('T')]));
  const tasks = plan.map((p, i) => {
    const dependsOn = (p.dependsOn || []).map((k) => idOf.get(k)).filter(Boolean);
    const v = validateTask({ title: p.title, detail: p.detail, member: p.member, dependsOn }, ids.filter((id) => id !== 'order'));
    if (v.error) throw new Error(v.error);
    return { id: idOf.get(keyOf(p, i)), v, why: p.why || '', step: p.step || 1 };
  });
  appendJsonl(paths.messages, { id: newId('M'), at, ...first });
  return tasks.map(({ id, v, why, step }) => {
    const t = appendJsonl(paths.tasks, { id, ...v, step, createdBy: 'order', createdAt: at, updatedAt: at, summary: '' });
    const text = [v.title, why].filter(Boolean).join(' — ').slice(0, 2000);
    appendJsonl(paths.messages, { id: newId('M'), at, from: 'order', to: v.member, kind: 'order', taskId: t.id, text });
    return t;
  });
}

/** 실행 순서: step 오름차순, 같으면 들어온 순서. */
export const runOrder = (tasks) =>
  tasks.map((t, i) => [t, i]).sort((a, b) => (a[0].step || 1) - (b[0].step || 1) || a[1] - b[1]).map(([t]) => t);

const emit = (paths, member, ev) => appendJsonl(paths.events, { at: now(), project: paths.id, member, ...ev });
function setCurrent(paths, member, text) {
  const file = memberFile(paths, member);
  if (!fs.existsSync(file)) return;
  fs.writeFileSync(file, setSection(fs.readFileSync(file, 'utf8'), '지금 작업', text), 'utf8');
}

/**
 * 멤버 한 명에게 작업 하나를 실행시킨다. 끝나면 작업 summary·usage, report 메시지, end 이벤트(usage 포함)를 남긴다.
 * - 실행 전후 git status 를 비교해 owns 밖 수정이 있으면 작업을 blocked 로 바꾸고 메인 오더에게 경고한다(되돌리지 않음).
 *   concurrentOwns: 같이 도는 다른 멤버의 owns(배열, 또는 끝날 때 부르는 함수) — 그쪽 변경은 이 멤버 탓으로 보지 않는다.
 * - 실행 중 누적 토큰이 작업 상한(budget.task)을 넘으면 프로세스를 끝내고 blocked(사유 "예산 초과").
 * - 검수 멤버가 있으면 done 대신 review 로 두고, 바뀐 파일·줄 수(diffStat)를 남긴다.
 * 돌려주는 값: { ok, status, summary, outside: [경로], stopped }
 */
export async function runMember({ root, paths, member: m, task, members = [], headroom = false, out = console.log, concurrentOwns = [] }) {
  const config = loadConfig(root);
  const runner = getRunner(config, m.runner);
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
      onUsage: (tokens) => overTaskCap(config.budget, tokens),
    });
  } catch (e) {
    r = { code: -1, text: e.message, isError: true, usage: null };
  }
  log.end();

  let ok = r.code === 0 && !r.isError && !r.stopped;
  let summary = (r.text || `종료 코드 ${r.code}`).slice(0, 2000);
  const after = gitSnapshot(paths.path);
  const changed = before.ok ? diffSnapshots(before.map, after.map) : [];
  const outside = before.ok ? outsideOwns(changed, [...m.owns, ...(typeof concurrentOwns === 'function' ? concurrentOwns() : concurrentOwns)], m.id) : [];
  if (r.stopped) {
    summary = `예산 초과: 작업 상한 ${config.budget.task.toLocaleString('ko-KR')}토큰을 넘어 실행을 멈췄습니다 (예산 기준 ${budgetTokens(r.usage).toLocaleString('ko-KR')}토큰)`;
    appendJsonl(paths.messages, { id: newId('M'), at: now(), from: m.id, to: 'order', kind: 'note', taskId: task.id, text: `${summary}. 작업을 나누거나 상한을 올린 뒤 다시 실행하세요.` });
  }
  if (outside.length) {
    ok = false;
    const list = outside.slice(0, 8).join(', ') + (outside.length > 8 ? ` 외 ${outside.length - 8}개` : '');
    summary = `맡은 경로 밖 수정 ${outside.length}건: ${list}\n${summary}`.slice(0, 2000);
    appendJsonl(paths.messages, {
      id: newId('M'), at: now(), from: m.id, to: 'order', kind: 'note', taskId: task.id,
      text: `경고: 맡은 경로 밖 파일을 고쳤습니다 — ${list}. 되돌리지 않았습니다. 확인 뒤 작업 상태를 정해 주세요.`.slice(0, 2000),
    });
  }
  const reviewer = ok ? reviewerFor(m, config.review, members.map((x) => x.id)) : '';
  // 검수용 diff: 이 멤버 owns 안의 변경만(스쿼드 기록 파일·같이 돈 멤버의 변경은 뺀다)
  const mine = (p) => !/(^|\/)\.squad\//.test(p) && !outsideOwns([p], m.owns, m.id).length;
  const diffStat = before.ok ? taskDiffStat(paths.path, before.heads, changed).filter((s) => mine(s.path)).slice(0, 200) : [];
  const status = !ok ? 'blocked' : reviewer ? 'review' : 'done';
  updateTask(paths.tasks, task.id, {
    status, summary, ...(r.usage ? { usage: r.usage } : {}), ...(r.stopped ? { blockedReason: '예산 초과' } : {}),
    ...(reviewer ? { reviewer } : {}), ...(diffStat.length ? { diffStat } : {}),
  });
  appendJsonl(paths.messages, { id: newId('M'), at: now(), from: m.id, to: 'order', kind: 'report', taskId: task.id, text: summary });
  if (reviewer) appendJsonl(paths.messages, { id: newId('M'), at: now(), from: m.id, to: reviewer, kind: 'handoff', taskId: task.id, text: `검수 부탁드립니다: ${task.title}` });
  setCurrent(paths, m.id, '');
  const endText = r.stopped ? '예산 초과' : outside.length ? '경로 밖 수정' : !ok ? '막힘' : reviewer ? '검수 대기' : '완료';
  emit(paths, m.id, { type: 'end', taskId: task.id, status: ok ? 'idle' : 'blocked', text: endText, ...(r.usage ? { usage: r.usage } : {}) });
  return { ok, status, summary, outside, stopped: Boolean(r.stopped) };
}

/**
 * 검수: 검수 멤버가 diff 요약(파일·줄 수, 상한 있음)과 작업 요약만 보고 통과/반려.
 * 통과 → done. 반려 → 담당 멤버에게 handoff 메시지, 작업은 todo 로(반려 사유는 reviewNote).
 * runner 는 계획처럼 도구 없이 한 번 답만 받는다(mode: plan).
 */
export async function runReview({ root, paths, members, task, out = console.log }) {
  const config = loadConfig(root);
  const rid = task.reviewer || reviewerFor(members.find((x) => x.id === task.member), config.review, members.map((x) => x.id));
  const reviewer = members.find((x) => x.id === rid);
  if (!reviewer) throw new Error(`검수 멤버가 없습니다: ${rid || '(지정 안 됨)'}`);
  const runner = getRunner(config, reviewer.runner);
  const prompt = buildReviewPrompt({ reviewer: rid, task, member: task.member, diff: summarizeDiff(task.diffStat || [], config.review.maxFiles) });
  emit(paths, rid, { type: 'start', taskId: task.id, text: `검수 · ${task.title}` });
  out(`${reviewer.name} 검수 — ${task.title}`);
  let r;
  try {
    r = await runner.exec({ prompt, cwd: paths.path, mode: 'plan', model: reviewer.model, stderr: 'pipe', timeoutMs: 180000 });
  } catch (e) {
    r = { code: -1, text: e.message, isError: true, usage: null };
  }
  const v = r.code === 0 && !r.isError ? parseVerdict(r.text) : { pass: false, note: `검수를 실행하지 못했습니다: ${String(r.text || r.err || r.code).slice(0, 200)}` };
  return finishReview({ paths, task, reviewer: rid, verdict: v, usage: r.usage });
}

/** 검수 결과를 남긴다(시연도 같이 쓴다). */
export function finishReview({ paths, task, reviewer, verdict, usage = null }) {
  const at = now();
  if (verdict.pass) {
    updateTask(paths.tasks, task.id, { status: 'done', reviewNote: verdict.note || '통과' });
    appendJsonl(paths.messages, { id: newId('M'), at, from: reviewer, to: 'order', kind: 'report', taskId: task.id, text: `검수 통과: ${task.title}${verdict.note ? ` — ${verdict.note}` : ''}`.slice(0, 2000) });
  } else {
    updateTask(paths.tasks, task.id, { status: 'todo', reviewNote: verdict.note });
    appendJsonl(paths.messages, { id: newId('M'), at, from: reviewer, to: task.member, kind: 'handoff', taskId: task.id, text: `검수 반려: ${task.title} — ${verdict.note || '사유 없음'}`.slice(0, 2000) });
  }
  emit(paths, reviewer, { type: 'end', taskId: task.id, status: 'idle', text: verdict.pass ? '검수 통과' : '검수 반려', ...(usage ? { usage } : {}) });
  return verdict;
}

/**
 * 대기열 실행: 의존이 풀린 todo 와 검수 대기를 골라, 담당 경로가 겹치지 않는 멤버끼리 동시에(max 개까지) 돌린다.
 * 할 일이 없거나 예산이 다 되면 끝낸다. 한 작업은 이번 실행에서 두 번까지만(반려 → 다시 실행 → 또 반려면 멈춤).
 * gate(subject, what, taskId) → Promise<true | false | 'over'> 는 예산 확인(기다리기 포함).
 * → { ran, blocked, stoppedBy: '' | '예산 초과' }
 */
export async function runQueue({ root, paths, loadMembers, max = 2, out = console.log, gate = async () => true, headroom = false }) {
  const running = new Map(); // taskId → {member, kind, promise}
  const skip = new Set();
  const tries = new Map();
  let ran = 0, blocked = 0, stoppedBy = '';
  for (;;) {
    const members = loadMembers();
    const review = loadConfig(root).review;
    const tasks = readJsonl(paths.tasks).filter((t) => !skip.has(t.id) && !running.has(t.id));
    const reviewerOf = (t) => reviewerFor(members.find((x) => x.id === t.member), review, members.map((x) => x.id));
    const picks = stoppedBy ? [] : pickRunnable({ tasks, members, running: [...running.values()], max, reviewerOf });
    for (const p of picks) {
      const key = `${p.kind}:${p.task.id}`;
      tries.set(key, (tries.get(key) || 0) + 1);
      if (tries.get(key) > 2) {
        skip.add(p.task.id);
        continue;
      }
      const m = members.find((x) => x.id === p.member);
      // 이 작업이 도는 동안 같이 돈 멤버들(시작할 때 돌던 것 + 나중에 시작한 것)
      const job = { member: p.member, kind: p.kind, overlap: new Set([...running.values()].map((x) => x.member)) };
      for (const x of running.values()) x.overlap.add(p.member);
      job.promise = (async () => {
        const g = await gate(p.member, `${p.kind === 'review' ? '검수' : '실행'} · ${p.task.title}`, p.task.id);
        if (g === 'over') {
          stoppedBy = '예산 초과';
          return skip.add(p.task.id);
        }
        if (!g) return skip.add(p.task.id);
        ran++;
        if (p.kind === 'review') return void (await runReview({ root, paths, members, task: p.task, out }));
        // 같이 도는 멤버의 owns 와 그 멤버 폴더(CLI 가 "지금 작업"을 고친다)는 이 멤버 탓으로 보지 않는다
        // 검수 멤버는 파일을 고치지 않지만 이벤트를 남기므로 그 폴더만 허용한다
        const others = () => [...job.overlap].filter((id) => id !== p.member).flatMap((id) => [...(members.find((y) => y.id === id)?.owns || []), `.squad/members/${id}/**`]);
        const res = await runMember({ root, paths, member: m, task: p.task, members, headroom, out, concurrentOwns: others });
        if (!res.ok) blocked++, skip.add(p.task.id);
      })()
        .catch((e) => {
          out(`오류: ${p.task.id} — ${e.message}`);
          skip.add(p.task.id);
        })
        .finally(() => running.delete(p.task.id));
      running.set(p.task.id, job);
    }
    if (!running.size) break;
    await Promise.race([...running.values()].map((x) => x.promise));
  }
  return { ran, blocked, stoppedBy };
}
