// 승인 대기 — 멤버·메인 AI 가 위험 행위를 하기 전에 남기는 요청과 사람의 결정. <project>/.squad/approvals.jsonl 에 덧붙이기만 한다.
// 줄 종류: {type:'request', id, at, from, action, text, reason?, scope?, taskId?}
//          {type:'decision', id, at, decision:'approved'|'rejected', by, note?}  (note: 거절 사유 등)
import { appendJsonl, newId, readJsonl } from './store.mjs';

export const ACTIONS = { push: 'push', deploy: '배포', migrate: 'DB 마이그레이션', send: '외부 발송', delete: '삭제' };
export const DECISIONS = { approved: '승인', rejected: '거절' };

export function validateApprovalRequest(input, memberIds) {
  const r = input || {};
  if (!memberIds.includes(r.from)) return { error: '요청한 멤버가 없습니다' };
  if (!Object.hasOwn(ACTIONS, r.action)) return { error: `행위는 ${Object.keys(ACTIONS).join('|')} 중 하나여야 합니다` };
  const text = typeof r.text === 'string' ? r.text.trim() : '';
  if (!text) return { error: '무엇을 하려는지 적어 주세요' };
  if (text.length > 500) return { error: '요청 내용은 500자 이하로 써 주세요' };
  if (r.taskId !== undefined && r.taskId !== '' && !/^T-[a-z0-9-]{1,40}$/.test(r.taskId)) return { error: '작업 id 가 잘못됐습니다' };
  const opt = (v, n, label) => (v === undefined || v === '' ? '' : typeof v !== 'string' || v.length > n ? `${label}: ${n}자 이하 문자열로 써 주세요` : null);
  const e = opt(r.reason, 300, '이유') || opt(r.scope, 300, '영향 범위');
  if (e) return { error: e };
  return {
    from: r.from, action: r.action, text,
    ...(r.reason?.trim() ? { reason: r.reason.trim() } : {}),
    ...(r.scope?.trim() ? { scope: r.scope.trim() } : {}),
    ...(r.taskId ? { taskId: r.taskId } : {}),
  };
}

/** 줄들을 요청 단위로 접는다 — 순수 함수. 결정은 처음 것만 인정한다(두 번 결정되지 않게). */
export function foldApprovals(rows) {
  const byId = new Map();
  for (const r of rows) {
    if (r.type === 'request' && !byId.has(r.id)) byId.set(r.id, { ...r, type: undefined, status: 'pending' });
    else if (r.type === 'decision' && byId.get(r.id)?.status === 'pending' && DECISIONS[r.decision]) {
      Object.assign(byId.get(r.id), { status: r.decision, decidedAt: r.at, decidedBy: r.by, ...(r.note ? { note: r.note } : {}) });
    }
  }
  return [...byId.values()].map(({ type, ...a }) => a);
}

export const loadApprovals = (paths) => foldApprovals(readJsonl(paths.approvals));

export function requestApproval(paths, input) {
  return appendJsonl(paths.approvals, { type: 'request', id: newId('A'), at: new Date().toISOString(), ...input });
}

/** 결정을 남긴다. 없거나 이미 결정된 요청이면 Error. 결정된 요청을 돌려준다. */
export function decideApproval(paths, id, decision, by = 'human', note = '') {
  if (!DECISIONS[decision]) throw new Error('결정은 approved 또는 rejected');
  if (typeof note !== 'string' || note.length > 300) throw new Error('사유는 300자 이하로 써 주세요');
  note = note.trim();
  const a = loadApprovals(paths).find((x) => x.id === id);
  if (!a) throw new Error(`승인 요청이 없습니다: ${id}`);
  if (a.status !== 'pending') throw new Error(`이미 ${DECISIONS[a.status]}된 요청입니다`);
  const at = new Date().toISOString();
  appendJsonl(paths.approvals, { type: 'decision', id, at, decision, by, ...(note ? { note } : {}) });
  return { ...a, status: decision, decidedAt: at, decidedBy: by, ...(note ? { note } : {}) };
}

/** 결정을 요청한 멤버에게 알리는 메시지 본문. */
export const decisionText = (a) => `${DECISIONS[a.status]}: ${ACTIONS[a.action]} — ${a.text}${a.note ? ` (사유: ${a.note})` : ''}`.slice(0, 2000);
