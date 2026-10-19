// 막힘 카드 단추(/api/task/:id/:act) — 작업을 어떻게 바꾸고 무슨 메시지를 남길지 정한다. 저장은 서버가 한다.
import { LIMITS } from './validate.mjs';

export const BLOCKED_ACTS = ['retry', 'reassign', 'done', 'cancel'];

/** → { patch, message, wake } | { error }. message 는 validateMessage 에 넣을 모양, wake 는 대기열을 깨울지. */
export function blockedAction(act, task, { note, to } = {}, memberIds = []) {
  if (!BLOCKED_ACTS.includes(act)) return { error: `동작은 ${BLOCKED_ACTS.join('|')} 중 하나여야 합니다` };
  if (note !== undefined && typeof note !== 'string') return { error: '메모는 문자열이어야 합니다' };
  const n = (note || '').trim().slice(0, 500);
  const tail = n ? ` — ${n}` : '';
  const msg = (kind, text, toWho = task.member) => ({ from: 'human', to: toWho, kind, taskId: task.id, text: `${text}: ${task.title}${tail}` });
  if (act === 'retry') {
    const detail = n ? `${task.detail || ''}\n\n[재시도 메모] ${n}`.trim().slice(0, LIMITS.detail) : task.detail;
    return { patch: { status: 'todo', detail, summary: '' }, message: msg('note', '재시도'), wake: true };
  }
  if (act === 'reassign') {
    if (!memberIds.includes(to)) return { error: '넘길 멤버가 없습니다' };
    if (to === task.member) return { error: '이미 그 멤버의 작업입니다' };
    return { patch: { member: to, status: 'todo', summary: '' }, message: msg('handoff', `${task.member} 에게서 넘김`, to), wake: true };
  }
  if (act === 'done') return { patch: { status: 'done', summary: `사람이 완료 처리${tail}` }, message: msg('note', '사람이 완료 처리'), wake: false };
  return { patch: { status: 'cancelled' }, message: msg('note', '취소'), wake: false };
}
