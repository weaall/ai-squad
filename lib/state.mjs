// 보드 상태 계산 — 순수 함수. 파일을 읽지 않는다.
import { memberLimit } from './budget.mjs';
import { waitingOn } from './queue.mjs';

export const STATUS_LABEL = { working: '일하는 중', idle: '대기', blocked: '막힘' };
export const KIND_LABEL = {
  order: '지시',
  handoff: '인계',
  question: '질문',
  answer: '답변',
  report: '완료 보고',
  note: '메모',
};
export const TASK_STATUSES = ['todo', 'doing', 'review', 'blocked', 'done'];
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
  if (cost !== null) s.costUsd = Math.round(cost * 1e6) / 1e6;
  return s;
}

export const sameDay = (a, b) => {
  const x = new Date(a), y = new Date(b);
  return x.getFullYear() === y.getFullYear() && x.getMonth() === y.getMonth() && x.getDate() === y.getDate();
};

// ── 뒤처지거나 동떨어진 파트 ──
export const WAIT_KINDS = ['handoff', 'question'];

/**
 * 답 없는 인계·질문: 받은 지 limitMs 가 지났는데, 받은 쪽이 그 뒤로 보낸 쪽에게(또는 같은 작업으로) 아무 말도 하지 않은 것.
 * 돌려주는 값: 그런 메시지 목록(오래된 순).
 */
export function findUnanswered(messages, now, limitMs) {
  const out = [];
  for (let i = 0; i < messages.length; i++) {
    const m = messages[i];
    if (!WAIT_KINDS.includes(m.kind) || m.from === m.to) continue;
    const at = Date.parse(m.at);
    if (!(now - at > limitMs)) continue;
    const answered = messages.slice(i + 1).some((r) => r.from === m.to && (r.to === m.from || (m.taskId && r.taskId === m.taskId)));
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
export function buildState({ project, members, tasks, messages, events, approvals = [], demo = false, now = Date.now(), stale = { answerMinutes: 30, idleMinutes: 30 }, budget = { daily: 0, memberDaily: 0, task: 0, warn: 0.8 }, inbox = [] }) {
  const evs = events.filter((e) => e.project === project.id);
  const unanswered = findUnanswered(messages, now, stale.answerMinutes * 60000);
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
    };
  });
  const today = sumUsage(evs.filter((e) => e.usage && sameDay(e.at, now)).map((e) => e.usage));
  const byId = new Map(tasks.map((t) => [t.id, t]));
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
    budget: { daily: budget.daily, task: budget.task, warn: budget.warn, ratio: budget.daily > 0 ? today.total / budget.daily : 0 },
    inbox: inbox.slice(-20),
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
