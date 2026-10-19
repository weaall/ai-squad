// 보드 상태 계산 — 순수 함수. 파일을 읽지 않는다.

export const STATUS_LABEL = { working: '일하는 중', idle: '대기', blocked: '막힘' };
export const KIND_LABEL = {
  order: '지시',
  handoff: '인계',
  question: '질문',
  answer: '답변',
  report: '완료 보고',
  note: '메모',
};
export const TASK_STATUSES = ['todo', 'doing', 'blocked', 'done'];
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

/** 보드에 보낼 상태 한 덩어리. */
export function buildState({ project, members, tasks, messages, events, demo = false, now = Date.now() }) {
  const evs = events.filter((e) => e.project === project.id);
  const ms = members.map((m) => {
    const mine = evs.filter((e) => e.member === m.id);
    const last = mine.at(-1) || null;
    const status = memberStatus(m.id, evs, tasks);
    const pending = tasks.filter((t) => t.member === m.id && (t.status === 'todo' || t.status === 'doing'));
    const doing = tasks.find((t) => t.member === m.id && t.status === 'doing');
    return {
      ...m,
      status,
      current: m.current || doing?.title || '',
      pending: pending.length,
      lastEvent: last ? { ...last, label: describeEvent(last) } : null,
    };
  });
  return {
    project: { id: project.id, name: project.name },
    demo,
    now,
    members: ms,
    tasks,
    messages: messages.slice(-300),
    events: evs.slice(-500),
    counts: {
      working: ms.filter((m) => m.status === 'working').length,
      // 막힌 멤버와 막힌 작업은 대개 같은 일이라 더하지 않고 큰 쪽을 쓴다
      blocked: Math.max(ms.filter((m) => m.status === 'blocked').length, tasks.filter((t) => t.status === 'blocked').length),
      pending: tasks.filter((t) => t.status === 'todo').length,
    },
  };
}
