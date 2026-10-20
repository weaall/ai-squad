// 메인 오더 계획과 멤버 실행 — CLI(order·run·run-queue·review)와 보드 서버(/api/order)가 같이 쓴다.
// 실제 실행은 runner 어댑터(lib/runners/)가 한다: 오더는 squad.config.json 의 mainAi, 멤버는 MEMBER.md 의 runner.
import fs from 'node:fs';
import path from 'node:path';
import { appendJsonl, memberFile, newId, readJsonl, readMemberDocs, updateTask } from './store.mjs';
import { setSection } from './md.mjs';
import { buildOrderPrompt, buildRunPrompt, parsePlan } from './claude.mjs';
import { validateMessage, validateTask } from './validate.mjs';
import { budgetTokens, buildState, describeEvent, sumUsage } from './state.mjs';
import { PLAN_RETRY_MODEL, loadConfig } from './config.mjs';
import { getRunner, routedRunner, routeTask } from './runners/index.mjs';
import { mapFile, mapFor } from './runners/map.mjs';
import { CONFLICT_REASON, createWorktree, finishWorktree } from './runners/worktree.mjs';
const EDIT_TOOLS = /^(Edit|Write|MultiEdit|NotebookEdit|write_to_file|replace_file_content|multi_replace_file_content|edit_file|create_file)$/i;
const relPath = (root, p) => {
  let a = path.resolve(root, p).split(path.sep).join('/');
  // .squad 가 드라이브 등으로 연결돼 있으면 실제 경로(G:/...)를 .squad/... 로 되돌린다
  for (const d of linkedDirs(root)) {
    const real = path.resolve(d).split(path.sep).join('/') + '/';
    if (a.toLowerCase().startsWith(real.toLowerCase())) a = path.resolve(root, '.squad').split(path.sep).join('/') + '/' + a.slice(real.length);
  }
  const r = path.resolve(root).split(path.sep).join('/') + '/';
  return a.toLowerCase().startsWith(r.toLowerCase()) ? a.slice(r.length) : a;
};
import { diffSnapshots, gitSnapshot, outsideOwns, taskDiffStat } from './owns.mjs';
import { checkBudget, memberLimit, overTaskCap, usageOn } from './budget.mjs';
import { budgetApproved, loadApprovals, pendingBudget, requestApproval } from './approvals.mjs';
import { pickRunnable } from './queue.mjs';
import { withTaskLock } from './runners/lock.mjs';
import { gitOnlyOf, gitOnlyText } from './runners/edits.mjs';
import { memberBrief, memberResume, saveMemberSession, sessionsFile } from './runners/resident.mjs';
import { retryOnce } from './runners/retry.mjs';
import { linkedDirs, modelFor } from './runners/claude.mjs';
import { LIMIT_REASON, isLimitError, limitBlockedText, limitHint, limitsView, loadLimits, saveLimits } from './limits.mjs';
import { buildReviewPrompt, parseVerdict, reviewerFor, summarizeDiff } from './review.mjs';
import { precheck } from './runners/precheck.mjs';
import { graphFile, graphifyBin, graphifyMeter, pathEnv, queryGraph, tokenRules, updateGraph } from './tokentools.mjs';

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
    limitHint: limitHint(limitsView(loadLimits(root))),
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
  const prompt = orderPrompt({ root, paths, members, instruction, config });
  const ids = members.filter((m) => m.id !== 'order').map((m) => m.id);
  const once = async (name, model) => {
    const runner = getRunner(config, name);
    const r = await runner.exec({ prompt, cwd: paths.path, mode: 'plan', model, headroom, stderr, timeoutMs });
    if (r.timedOut) throw new Error(`${runner.name} 가 시간 안에 끝나지 않았습니다`);
    if (r.code !== 0) throw new Error(`${runner.name} 가 ${r.code} 로 끝났습니다${/설치/.test(r.err) ? ' (CLI 가 설치돼 있는지 확인하세요)' : ''}`);
    return { plan: parsePlan(r.text, ids), usage: r.usage, runner: runner.name };
  };
  const { runner, model } = config.mainAi;
  if (runner === 'claude' && model === PLAN_RETRY_MODEL) return once(runner, model);
  // 싼 모델이 실패하거나 빈 계획을 내면 Opus 로 한 번만 다시(빈 계획 쪽 토큰은 합친다)
  let first;
  try {
    first = await once(runner, model);
    if (first.plan.length) return first;
  } catch {
    return once('claude', PLAN_RETRY_MODEL);
  }
  const second = await once('claude', PLAN_RETRY_MODEL);
  return { ...second, usage: sumUsage([first.usage, second.usage].filter(Boolean)) };
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
    const v = validateTask({ title: p.title, detail: p.detail, member: p.member, dependsOn, difficulty: p.difficulty }, ids.filter((id) => id !== 'order'));
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
 *   concurrentOwns: 같이 도는 다른 멤버 [{id, owns}](배열, 또는 끝날 때 부르는 함수) — git 에만 보인 변경은 '<id> 몫' 으로 표시해 요약·이벤트(outside-warn)에 남긴다.
 * - 실행 중 누적 토큰이 작업 상한(budget.task)을 넘으면 프로세스를 끝내고 blocked(사유 "예산 초과").
 * - Claude 가 알려 준 사용 한도(rate_limit_event)는 limit 이벤트와 data/limits.json 에 남긴다. 한도에 걸려 실패하면 blocked(사유 "사용 한도").
 * - 모델은 작업 난이도(task.difficulty)로 고른다(modelFor).
 * - 검수 멤버가 있으면 done 대신 review 로 두고, 바뀐 파일·줄 수(diffStat)를 남긴다.
 * 돌려주는 값: { ok, status, summary, outside: [경로], stopped, limited }
 */
export async function runMember({ root, paths, member: m, task, members = [], headroom = false, out = console.log, concurrentOwns = [] }) {
  const config = loadConfig(root);
  // 작업 runner·model → 프로젝트 runners 에 antigravity 가 켜져 있으면 난이도·종류·Claude 사용률 → MEMBER.md runner (route.mjs)
  const route = routeTask({ task, member: m, projectRunners: paths.runners, limits: limitsView(loadLimits(root)) });
  const runner = routedRunner(config, route, {
    onFallback: (f) => {
      const text = `${f.from} 실패(${f.reason}) — ${f.to} 로 한 번 다시 실행`;
      emit(paths, m.id, { type: 'fallback', taskId: task.id, text, ...f });
      out(`  ${text}`);
    },
  });
  const docs = readMemberDocs(paths, m.id);
  const mf = mapFile(root, paths.id);
  // 재시도·검수 반려·후속 수정: 같은 멤버·같은 runner 가 남긴 세션을 이어 간다(재시도는 p.task 가 옛것이라 저장본을 다시 읽는다)
  const saved = readJsonl(paths.tasks).find((t) => t.id === task.id) || task;
  const taskResume = saved.sessionId && saved.sessionKey === `${m.id}:${route.runner}` ? saved.sessionId : '';

  // 멤버마다 worktree(projects.json worktree:true) — 분리된 HEAD 등으로 못 만들면 원래 트리에서
  let wt = null;
  if (paths.worktree) {
    try {
      wt = createWorktree({ root: paths.path, member: m.id, taskId: task.id });
    } catch (e) {
      out(`  worktree 를 만들지 못해 원래 트리에서 실행: ${e.message}`);
    }
  }
  const cwd = wt ? wt.dir : paths.path;
  // 토큰 절약 도구(lib/tokentools.mjs): graphify 그래프는 원래 트리에서 갱신하고 worktree 는 그 그래프를 --graph 로 본다.
  // 실패·시간 초과여도 실행은 계속한다. ponytail 은 전역 플러그인이라 꺼진 멤버만 이 실행에서 끈다.
  const gOn = m.plugins.includes('graphify');
  const pOn = m.plugins.includes('ponytail');
  const gBin = gOn ? graphifyBin() : '';
  const gUp = gBin ? await updateGraph({ root, dir: paths.path, bin: gBin }) : null;
  if (gUp && gUp.status !== 'fresh') out(`  graphify update: ${gUp.status}${gUp.ms ? ` ${Math.round(gUp.ms / 1000)}초` : ''}${gUp.text ? ` — ${gUp.text}` : ''}`);
  const graph = gBin && fs.existsSync(graphFile(paths.path)) ? graphFile(paths.path) : '';
  const meter = graphifyMeter([cwd, paths.path]);
  // Antigravity 는 셸을 못 써서 graphify 를 부를 수 없다 → 작업 제목으로 미리 질의해 프롬프트에 넣는다(이것도 절감 측정에 센다)
  const prequery = graph && route.runner === 'antigravity' ? await queryGraph({ dir: paths.path, q: `${task.title} ${task.detail || ''}`, bin: gBin }) : '';
  if (prequery) meter.add(prequery);
  const prompt = buildRunPrompt({
    memberMd: docs.member, notesMd: docs.notes, task, squadRoot: root, project: paths.id, member: m.id,
    owns: m.owns, reads: m.reads, tools: m.tools, plugins: m.plugins,
    map: fs.existsSync(mf) ? mapFor(fs.readFileSync(mf, 'utf8'), m.id) : '',
    tokenRules: tokenRules({ graphify: Boolean(graph), ponytail: pOn, runner: route.runner, graph, worktree: Boolean(wt), prequery }),
  });
  // 작업 세션이 없으면 멤버 상주 세션을 이어 간다. worktree 는 cwd 가 달라 claude --resume 이 못 찾으니 쓰지 않는다
  const sFile = sessionsFile(root, paths.id);
  const resume = taskResume || (wt ? '' : memberResume(sFile, m.id, route.runner));
  const brief = memberBrief({ root, projectId: paths.id, projectPath: paths.path, member: m });
  const before = gitSnapshot(cwd);
  // 승인된 명령(allow)은 이번 실행에만 — 시작하면서 지운다
  const allow = saved.allow || [];
  updateTask(paths.tasks, task.id, { status: 'doing', ...(allow.length ? { allow: [] } : {}) });
  setCurrent(paths, m.id, task.title);
  emit(paths, m.id, { type: 'start', taskId: task.id, text: task.title });
  const logFile = path.join(paths.logs, m.id, `${task.id}.log`);
  fs.mkdirSync(path.dirname(logFile), { recursive: true });
  const log = fs.createWriteStream(logFile);
  out(`${m.name} 실행 (${runner.name}${route.model ? ' · ' + route.model : ''}${route.reason ? ' · ' + route.reason : ''}) — ${task.title}\n원본 로그: ${logFile}`);

  // 경로 밖 판정은 이 멤버가 직접 고친 파일(Edit·Write 류 도구)로만 한다 — git 전후 비교는 사람·다른 멤버의 동시 수정까지 섞인다(2026-10-19 오탐 반복)
  const edited = new Set();
  let r;
  try {
    r = await runner.exec({
      prompt, cwd, mode: 'member', model: modelFor({ difficulty: task.difficulty, memberModel: m.model, models: config.models }), tools: m.tools, maxTurns: m.maxTurns, headroom: headroom || m.headroom, stderr: 'inherit', resume, allow, brief,
      env: { ...pathEnv(gBin), ...(pOn ? {} : { PONYTAIL_DEFAULT_MODE: 'off' }) },
      extraTools: graph ? ['Bash(graphify *)'] : [],
      onLine: (line) => {
        log.write(line + '\n');
        meter.line(line);
      },
      onTool: (t) => {
        if (t.path && EDIT_TOOLS.test(t.tool || '')) edited.add(relPath(cwd, t.path));
        emit(paths, m.id, { type: 'tool', taskId: task.id, tool: t.tool, path: t.path });
        out(`  ${describeEvent({ type: 'tool', ...t })}`);
      },
      onUsage: (tokens) => overTaskCap(config.budget, tokens),
      onLimit: (l) => {
        saveLimits(root, l);
        const pct = (w) => (w ? Math.round(w.used * 100) + '%' : '?');
        emit(paths, m.id, { type: 'limit', taskId: task.id, text: `한도 5시간 ${pct(l.fiveHour)} · 주간 ${pct(l.sevenDay)}${l.status ? ' · ' + l.status : ''}`, limits: l });
      },
    });
  } catch (e) {
    r = { code: -1, text: e.message, isError: true, usage: null };
  }
  log.end();

  let ok = r.code === 0 && !r.isError && !r.stopped;
  let summary = (r.text || `종료 코드 ${r.code}`).slice(0, 2000);
  const after = gitSnapshot(cwd);
  const changed = before.ok ? diffSnapshots(before.map, after.map) : [];
  // 프로젝트 밖(임시 폴더 등)에 쓴 파일은 판정에서 뺀다 — 저장소 코드가 아니다
  const outside = outsideOwns([...edited].filter((p) => !path.isAbsolute(p)), m.owns, m.id);
  // git 으로만 보이는 경로 밖 변경은 막지 않고 경고로만(누가 고쳤는지 모름)
  const others = typeof concurrentOwns === 'function' ? concurrentOwns() : concurrentOwns;
  const gitOnly = before.ok ? gitOnlyOf({ changed, owns: m.owns, memberId: m.id, edited: [...edited], others }) : [];
  if (gitOnly.length) {
    const text = `확인 필요: 같은 시간에 바뀐 맡은 경로 밖 파일 ${gitOnly.length}개 — ${gitOnlyText(gitOnly)}. 이 멤버가 고쳤는지는 알 수 없어 막지 않았습니다`;
    summary = `${summary}\n(${text})`.slice(0, 2000);
    emit(paths, m.id, { type: 'outside-warn', taskId: task.id, text, files: gitOnly.slice(0, 50) });
  }
  if (r.stopped) {
    summary = `예산 초과: 작업 상한 ${config.budget.task.toLocaleString('ko-KR')}토큰을 넘어 실행을 멈췄습니다 (예산 기준 ${budgetTokens(r.usage).toLocaleString('ko-KR')}토큰)`;
    appendJsonl(paths.messages, { id: newId('M'), at: now(), from: m.id, to: 'order', kind: 'note', taskId: task.id, text: `${summary}. 작업을 나누거나 상한을 올린 뒤 다시 실행하세요.` });
  }
  const limits = limitsView(loadLimits(root));
  const limited = !r.stopped && (r.code !== 0 || r.isError) && (Boolean(limits?.hit) || isLimitError(r.text));
  if (limited) {
    summary = limitBlockedText(limits);
    appendJsonl(paths.messages, { id: newId('M'), at: now(), from: m.id, to: 'order', kind: 'note', taskId: task.id, text: `${summary}. 리셋 뒤 다시 실행하거나 계정을 바꾸세요.` });
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
  // 검수용 diff: 이 멤버 owns 안의 변경만(스쿼드 기록 파일·같이 돈 멤버의 변경은 뺀다). worktree 를 합치기 전에 센다
  const mine = (p) => !/(^|\/)\.squad\//.test(p) && !outsideOwns([p], m.owns, m.id).length;
  const diffStat = before.ok ? taskDiffStat(cwd, before.heads, changed).filter((s) => mine(s.path)).slice(0, 200) : [];
  // worktree 를 원래 브랜치로 합친다(동기 — 같이 도는 멤버의 병합과 섞이지 않음). 못 합치면 worktree 를 남기고 blocked
  let conflict = false;
  if (wt) {
    let res;
    try {
      res = finishWorktree({ root: paths.path, ...wt });
    } catch (e) {
      res = { status: 'conflict', text: `${CONFLICT_REASON}: ${e.message} — worktree: ${wt.dir}` };
    }
    out(`  worktree: ${res.text}`);
    if (res.status === 'conflict' || res.status === 'dirty') {
      conflict = true;
      ok = false;
      summary = `${res.text}\n${summary}`.slice(0, 2000);
    }
  }
  const reviewer = ok ? reviewerFor(m, config.review, members.map((x) => x.id)) : '';
  const status = !ok ? 'blocked' : reviewer ? 'review' : 'done';
  updateTask(paths.tasks, task.id, {
    status, summary, ...(r.usage ? { usage: r.usage } : {}), ...(r.stopped ? { blockedReason: '예산 초과' } : limited ? { blockedReason: LIMIT_REASON } : conflict ? { blockedReason: CONFLICT_REASON } : {}),
    ...(reviewer ? { reviewer } : {}), ...(diffStat.length ? { diffStat } : {}),
    // 대체로 돌았으면 세션은 claude 것
    ...(r.sessionId ? { sessionId: r.sessionId, sessionKey: `${m.id}:${r.fallback ? 'claude' : route.runner}` } : {}),
  });
  if (r.sessionId && !wt) saveMemberSession(sFile, m.id, r.fallback ? 'claude' : route.runner, r.sessionId, r.usage);
  appendJsonl(paths.messages, { id: newId('M'), at: now(), from: m.id, to: 'order', kind: 'report', taskId: task.id, text: summary });
  if (reviewer) appendJsonl(paths.messages, { id: newId('M'), at: now(), from: m.id, to: reviewer, kind: 'handoff', taskId: task.id, text: `검수 부탁드립니다: ${task.title}` });
  setCurrent(paths, m.id, '');
  const endText = r.stopped ? '예산 초과' : limited ? LIMIT_REASON : conflict ? CONFLICT_REASON : outside.length ? '경로 밖 수정' : !ok ? '막힘' : reviewer ? '검수 대기' : '완료';
  // 토큰 절약 도구: 켜진 것과 graphify 절감 추정(사용량 탭 · state.mjs toolSavings)
  const g = meter.result();
  const savings = { on: [...(headroom || m.headroom ? ['headroom'] : []), ...(pOn ? ['ponytail'] : []), ...(graph ? ['graphify'] : [])], ...(g ? { graphify: g } : {}), ...(gUp ? { graphUpdate: gUp.status } : {}) };
  emit(paths, m.id, { type: 'end', taskId: task.id, status: ok ? 'idle' : 'blocked', text: endText, ...(r.usage ? { usage: r.usage } : {}), savings });
  return { ok, status, summary, outside, stopped: Boolean(r.stopped), timedOut: Boolean(r.timedOut), limited };
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
  emit(paths, rid, { type: 'start', taskId: task.id, text: `검수 · ${task.title}` });
  out(`${reviewer.name} 검수 — ${task.title}`);

  // 사전 확인: 확인 명령 통과 + diff 작음 + 화면·대외 문구 아니면 LLM 없이 바로 통과
  const pre = precheck({ member: reviewer, task, cwd: paths.path });
  if (pre.pass) {
    out(`  precheck 통과 — LLM 검수 생략: ${pre.note}`);
    return finishReview({ paths, task, reviewer: rid, verdict: { pass: true, note: pre.note } });
  }
  out(`  precheck → LLM 검수 필요: ${pre.why}`);

  // 검수 runner: routedRunner(kind:'review') → LIGHT_KINDS 에 포함 → Antigravity flash
  const route = routeTask({ task: { ...task, kind: 'review' }, member: reviewer, projectRunners: paths.runners, limits: limitsView(loadLimits(root)) });
  const runner = routedRunner(config, route, {
    onFallback: (f) => {
      const text = `${f.from} 실패(${f.reason}) — ${f.to} 로 한 번 다시 실행`;
      emit(paths, rid, { type: 'fallback', taskId: task.id, text, ...f });
      out(`  ${text}`);
    },
  });
  const prompt = buildReviewPrompt({ reviewer: rid, task, member: task.member, diff: summarizeDiff(task.diffStat || [], config.review.maxFiles) });
  let r;
  try {
    r = await runner.exec({ prompt, cwd: paths.path, mode: 'plan', model: route.model || reviewer.model, stderr: 'pipe', timeoutMs: 180000 });
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
 * 할 일이 없거나 예산·사용 한도가 다 되면 끝낸다. 한 작업은 이번 실행에서 두 번까지만(반려 → 다시 실행 → 또 반려면 멈춤).
 * gate(subject, what, taskId) → Promise<true | false | 'over'> 는 예산 확인(기다리기 포함).
 * → { ran, blocked, stoppedBy: '' | '예산 초과' | '사용 한도' }
 */
export async function runQueue({ root, paths, loadMembers, max = 2, out = console.log, gate = async () => true, headroom = false, retry = false }) {
  const running = new Map(); // taskId → {member, kind, promise}
  const skip = new Set();
  const tries = new Map();
  let ran = 0, blocked = 0, stoppedBy = '';
  for (;;) {
    const members = loadMembers();
    const review = loadConfig(root).review;
    if (!stoppedBy && limitsView(loadLimits(root))?.hit) stoppedBy = LIMIT_REASON;
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
        const others = () => [...job.overlap].filter((id) => id !== p.member).map((id) => ({ id, owns: members.find((y) => y.id === id)?.owns || [] }));
        const res = await withTaskLock(path.join(paths.squad, 'locks'), p.task.id, () =>
          retryOnce(() => runMember({ root, paths, member: m, task: p.task, members, headroom, out, concurrentOwns: others }), {
            retry,
            onRetry: (r) => out(`${m.id} · ${p.task.title} 실패 — 1회 재시도 (${r.summary || r.status})`),
          }),
        );
        if (res.locked) return skip.add(p.task.id);
        if (res.limited) stoppedBy = LIMIT_REASON;
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
