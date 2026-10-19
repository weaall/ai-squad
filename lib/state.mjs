// 보드 상태 계산 — 순수 함수. 파일을 읽지 않는다.
import { memberLimit } from './budget.mjs';
import { waitingOn } from './queue.mjs';
import { weekUsage } from './limits.mjs';

export const STATUS_LABEL = { working: '일하는 중', idle: '대기', blocked: '막힘' };
export const KIND_LABEL = {
  order: '지시',
  handoff: '인계',
  question: '질문',
  answer: '답변',
  report: '완료 보고',
  note: '메모',
};
export const TASK_STATUSES = ['todo', 'doing', 'review', 'blocked', 'done', 'cancelled'];
export const MESSAGE_KINDS = Object.keys(KIND_LABEL);

/** 이벤트 한 줄 설명. 예: "Edit · app/organization/page.tsx" */
export function describeEvent(e) {
  if (!e) return '';
  switch (e.type) {
    case 'tool':
      return [e.tool, e.path].filter(Boolean).join(' · ');
    case 'start':
      return `작업 시작${e.text ? ' · ' + e.text : ''}`;
    case 'end':
      return `작업 끝${e.text ? ' · ' + e.text : ''}`;
    default:
      return e.text || '';
  }
}

/**
 * 멤버 상태: 상태를 정하는 마지막 이벤트(start·end·log)를 따른다.
 * 이벤트가 없으면 doing 작업이 있을 때 일하는 중, 아니면 대기.
 */
export function memberStatus(memberId, events, tasks = []) {
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i];
    if (e.member !== memberId) continue;
    if (e.type === 'start') return 'working';
    if (e.type === 'end') return e.status === 'blocked' ? 'blocked' : 'idle';
    if (e.type === 'log') return STATUS_LABEL[e.status] ? e.status : 'working';
  }
  return tasks.some((t) => t.member === memberId && t.status === 'doing') ? 'working' : 'idle';
}

// ── 토큰 사용량 ──
/** 사용량 하나의 토큰 합(입력·출력·캐시 읽기·캐시 쓰기). */
/**
 * 예산용 토큰(비용 기준 환산). 캐시 읽기는 입력 단가의 10%, 캐시 쓰기는 125% 라
 * 그대로 더하면 캐시를 많이 쓰는 멤버가 실제 비용보다 훨씬 빨리 예산을 넘는다(2026-10-19 첫 실제 운영에서 확인).
 */
export const budgetTokens = (u) =>
  u ? Math.round((u.input || 0) + (u.output || 0) + (u.cacheRead || 0) * 0.1 + (u.cacheWrite || 0) * 1.25) : 0;

export const tokenTotal = (u) => (u ? (u.input || 0) + (u.output || 0) + (u.cacheRead || 0) + (u.cacheWrite || 0) : 0);

/** 여러 사용량을 더한다. 비용은 하나라도 있으면 더한다. */
export function sumUsage(list) {
  const s = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 };
  let cost = null;
  for (const u of list) {
    if (!u) continue;
    s.input += u.input || 0;
    s.output += u.output || 0;
    s.cacheRead += u.cacheRead || 0;
    s.cacheWrite += u.cacheWrite || 0;
    if (Number.isFinite(u.costUsd)) cost = (cost || 0) + u.costUsd;
  }
  s.total = tokenTotal(s);
  s.budgetTokens = budgetTokens(s);
  if (cost !== null) s.costUsd = Math.round(cost * 1e6) / 1e6;
  return s;
}

/**
 * 한 멤버의 실행 통계(end 이벤트의 usage) → { runs, avgBase: 실행당 평균 기본 맥락(usage.base), perTask: 작업당 평균 토큰 }.
 * base 없는 옛 이벤트는 avgBase 에서 뺀다. 같은 작업을 여러 번 돌렸으면 작업당 토큰에 합쳐 센다.
 */
export function runStats(events) {
  const ends = events.filter((e) => e.type === 'end' && e.usage);
  const bases = ends.map((e) => e.usage.base).filter(Number.isFinite);
  const byTask = new Map();
  for (const e of ends) byTask.set(e.taskId, (byTask.get(e.taskId) || 0) + tokenTotal(e.usage));
  const avg = (xs) => (xs.length ? Math.round(xs.reduce((a, b) => a + b, 0) / xs.length) : 0);
  return { runs: ends.length, avgBase: avg(bases), perTask: avg([...byTask.values()]) };
}

/**
 * 지시(orderId)별 비용 → { [orderId]: { plan, work, total } } 토큰. plan 은 orderId 가 붙은 plan 이벤트, work 는 그 지시의 작업들의 end 이벤트 usage 합.
 */
export function orderCosts(events, tasks) {
  const orderOf = new Map(tasks.filter((t) => t.orderId).map((t) => [t.id, t.orderId]));
  const out = {};
  const add = (id, k, u) => {
    const o = (out[id] ||= { plan: 0, work: 0, total: 0 });
    const n = tokenTotal(u);
    o[k] += n;
    o.total += n;
  };
  for (const e of events) {
    if (!e.usage) continue;
    if (e.type === 'plan' && e.orderId) add(e.orderId, 'plan', e.usage);
    else if (e.type === 'end' && orderOf.has(e.taskId)) add(orderOf.get(e.taskId), 'work', e.usage);
  }
  return out;
}

/**
 * 사용량 하루 키 'YYYY-MM-DD'. 주간 한도가 목 21:00(한국시간)에 리셋되므로 하루도 한국시간 21:00 에 바뀐다
 * (21:00~다음 날 21:00 은 다음 날짜). 사용자 요청.
 */
export const usageDay = (at) => new Date(new Date(at).getTime() + 12 * 3600e3).toISOString().slice(0, 10);
export const sameDay = (a, b) => usageDay(a) === usageDay(b);

// ── 뒤처지거나 동떨어진 파트 ──
export const WAIT_KINDS = ['handoff', 'question'];

/**
 * 답 없는 인계·질문: 받은 지 limitMs 가 지났는데, 받은 쪽이 그 뒤로 보낸 쪽에게(또는 같은 작업으로) 아무 말도 하지 않은 것.
 * 돌려주는 값: 그런 메시지 목록(오래된 순).
 */
export function findUnanswered(messages, now, limitMs, tasks = []) {
  const out = [];
  // 인계·질문에서 만든 작업이 끝났으면 답한 것으로 본다 — 받은 멤버가 메시지로 답장하지 않아도(2026-10-19 '답 없는 인계' 19건이 다 끝난 일이었다)
  const closed = (t) => t.status === 'done' || t.status === 'cancelled';
  const head = (txt) => String(txt || '').split(/\r?\n/)[0].trim().slice(0, 60);
  for (let i = 0; i < messages.length; i++) {
    const m = messages[i];
    if (!WAIT_KINDS.includes(m.kind) || m.from === m.to) continue;
    const at = Date.parse(m.at);
    if (!(now - at > limitMs)) continue;
    const answered =
      messages.slice(i + 1).some((r) => r.from === m.to && (r.to === m.from || (m.taskId && r.taskId === m.taskId))) ||
      tasks.some((t) => closed(t) && (t.fromMessage === m.id || (t.member === m.to && head(m.text) && String(t.detail || '').includes(head(m.text)))));
    if (!answered) out.push(m);
  }
  return out;
}

/**
 * 멈춤: 할 일(todo)이 있는데 일하는 중이 아니고, 마지막 이벤트와 가장 오래된 할 일 중 늦은 쪽에서 limitMs 가 지났다.
 */
export function isStalled({ status, todos, lastEventAt }, now, limitMs) {
  if (status === 'working' || !todos.length) return false;
  const oldest = Math.min(...todos.map((t) => Date.parse(t.createdAt) || now));
  const since = Math.max(Date.parse(lastEventAt) || 0, oldest);
  return now - since > limitMs;
}

/** 보드에 보낼 상태 한 덩어리. */
export function buildState({ project, members, tasks, messages, events, approvals = [], demo = false, now = Date.now(), stale = { answerMinutes: 30, idleMinutes: 30 }, budget = { daily: 0, memberDaily: 0, task: 0, warn: 0.8 }, inbox = [], limits = null }) {
  const evs = events.filter((e) => e.project === project.id);
  const unanswered = findUnanswered(messages, now, stale.answerMinutes * 60000, tasks);
  const ms = members.map((m) => {
    const mine = evs.filter((e) => e.member === m.id);
    const last = mine.at(-1) || null;
    const status = memberStatus(m.id, evs, tasks);
    const pending = tasks.filter((t) => t.member === m.id && (t.status === 'todo' || t.status === 'doing'));
    const doing = tasks.find((t) => t.member === m.id && t.status === 'doing');
    const used = mine.filter((e) => e.usage);
    // 이번 작업: 하는 중인 작업, 없으면 사용량이 남은 가장 최근 작업
    const lastUsed = tasks.filter((t) => t.member === m.id && t.usage).sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''))[0];
    const taskTokens = doing ? tokenTotal(doing.usage) : tokenTotal(lastUsed?.usage);
    return {
      ...m,
      status,
      current: m.current || doing?.title || '',
      pending: pending.length,
      lastEvent: last ? { ...last, label: describeEvent(last) } : null,
      unanswered: unanswered.filter((x) => x.to === m.id).length,
      stalled: isStalled({ status, todos: pending.filter((t) => t.status === 'todo'), lastEventAt: last?.at }, now, stale.idleMinutes * 60000),
      tokens: { task: taskTokens, today: sumUsage(used.filter((e) => sameDay(e.at, now)).map((e) => e.usage)).total, all: sumUsage(used.map((e) => e.usage)).total },
      budgetLimit: memberLimit(budget, m),
      runStats: runStats(mine),
    };
  });
  const today = sumUsage(evs.filter((e) => e.usage && sameDay(e.at, now)).map((e) => e.usage));
  const byId = new Map(tasks.map((t) => [t.id, t]));
  const week = weekUsage(evs, limits, now);
  // runner 별 사용(예산 환산 토큰): 오늘·이번 주 — 둘 다 weekUsage 의 21시 경계 하루를 쓴다
  const addRunners = (acc, d) => {
    for (const [r, n] of Object.entries(d.byRunner)) acc[r] = (acc[r] || 0) + n;
    return acc;
  };
  const todayKey = usageDay(now);
  return {
    project: { id: project.id, name: project.name },
    demo,
    now,
    members: ms,
    // 선행이 남은 작업은 waitingOn 에 그 id 들(보드의 잠금 표시)
    tasks: tasks.map((t) => (t.dependsOn?.length ? { ...t, waitingOn: waitingOn(t, byId) } : t)),
    messages: messages.slice(-300),
    events: evs.slice(-500),
    unanswered: unanswered.map((m) => m.id),
    approvals: approvals.filter((a) => a.status === 'pending').concat(approvals.filter((a) => a.status !== 'pending').slice(-10)),
    tokensToday: today,
    budget: { daily: budget.daily, task: budget.task, warn: budget.warn, used: today.budgetTokens, ratio: budget.daily > 0 ? today.budgetTokens / budget.daily : 0 },
    inbox: inbox.slice(-20),
    // Claude 가 알려 준 실제 한도(전역)와 스쿼드 탭 '이번 주 사용'
    limits,
    week,
    orders: orderCosts(evs, tasks),
    usage: { byRunner: { today: week.days.filter((d) => d.day === todayKey).reduce(addRunners, {}), week: week.days.reduce(addRunners, {}) } },
    counts: {
      approvals: approvals.filter((a) => a.status === 'pending').length,
      stalled: ms.filter((m) => m.stalled).length,
      unanswered: unanswered.length,
      working: ms.filter((m) => m.status === 'working').length,
      // 막힌 멤버와 막힌 작업은 대개 같은 일이라 더하지 않고 큰 쪽을 쓴다
      blocked: Math.max(ms.filter((m) => m.status === 'blocked').length, tasks.filter((t) => t.status === 'blocked').length),
      pending: tasks.filter((t) => t.status === 'todo').length,
      review: tasks.filter((t) => t.status === 'review').length,
      inbox: inbox.filter((i) => i.status === 'pending').length,
      inboxTaking: inbox.filter((i) => i.status === 'taking').length,
    },
  };
}
