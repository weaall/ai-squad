// 입력 검증 — CLI 와 보드 POST 가 같이 쓴다. 통과하면 저장할 객체를, 아니면 { error } 를 돌려준다.
import { isId } from './store.mjs';
import { MESSAGE_KINDS, TASK_STATUSES } from './state.mjs';

export const LIMITS = { title: 120, detail: 2000, text: 2000, summary: 2000 };

/** 사람(human)·메인 오더·멤버 id 중 하나여야 한다. */
function party(v, memberIds) {
  return v === 'human' || memberIds.includes(v);
}

function str(v, max, name, { required = true } = {}) {
  if (v === undefined || v === null || v === '') return required ? `${name}이(가) 비었습니다` : null;
  if (typeof v !== 'string') return `${name}은(는) 문자열이어야 합니다`;
  if (v.length > max) return `${name}은(는) ${max}자 이하로 써 주세요`;
  return null;
}

export function validateMessage(input, memberIds) {
  const m = input || {};
  const err =
    str(m.text, LIMITS.text, '내용') ||
    (!party(m.from, memberIds) && '보낸 쪽이 멤버가 아닙니다') ||
    (!party(m.to, memberIds) && '받는 쪽이 멤버가 아닙니다') ||
    (m.kind !== undefined && !MESSAGE_KINDS.includes(m.kind) && '메시지 종류가 잘못됐습니다') ||
    (m.taskId !== undefined && m.taskId !== '' && !/^T-[a-z0-9-]{1,40}$/.test(m.taskId) && '작업 id 가 잘못됐습니다');
  if (err) return { error: err };
  const out = { from: m.from, to: m.to, kind: m.kind || 'note', text: m.text.trim() };
  if (m.taskId) out.taskId = m.taskId;
  return out;
}

export function validateTask(input, memberIds) {
  const t = input || {};
  const err =
    str(t.title, LIMITS.title, '제목') ||
    str(t.detail, LIMITS.detail, '내용', { required: false }) ||
    (!memberIds.includes(t.member) && '담당 멤버가 없습니다') ||
    (t.status !== undefined && !TASK_STATUSES.includes(t.status) && '작업 상태가 잘못됐습니다');
  if (err) return { error: err };
  return { title: t.title.trim(), detail: (t.detail || '').trim(), member: t.member, status: t.status || 'todo' };
}

/** 작업 고치기: 담당·상태·요약만 바꿀 수 있다. */
export function validateTaskPatch(input, memberIds) {
  const p = input || {};
  const out = {};
  if (p.member !== undefined) {
    if (!memberIds.includes(p.member)) return { error: '담당 멤버가 없습니다' };
    out.member = p.member;
  }
  if (p.status !== undefined) {
    if (!TASK_STATUSES.includes(p.status)) return { error: '작업 상태가 잘못됐습니다' };
    out.status = p.status;
  }
  if (p.summary !== undefined) {
    const e = str(p.summary, LIMITS.summary, '요약', { required: false });
    if (e) return { error: e };
    out.summary = p.summary;
  }
  if (!Object.keys(out).length) return { error: '바꿀 값이 없습니다' };
  return out;
}

export { isId };

export const ORDER_MAX = 1000;
export const PLAN_MAX = 20;

/** 보드의 "메인 오더에게 지시" 입력. */
export function validateOrder(input) {
  const v = typeof input?.instruction === 'string' ? input.instruction.trim() : input?.instruction;
  const err = str(v, ORDER_MAX, '지시');
  return err ? { error: err } : { instruction: v };
}

/** "이대로 배정" 때 화면이 돌려보낸 계획. 멤버마다 작업 검증을 그대로 쓴다(order 는 받지 않는다). */
export function validatePlan(plan, memberIds) {
  if (!Array.isArray(plan) || !plan.length) return { error: '배정할 계획이 없습니다' };
  if (plan.length > PLAN_MAX) return { error: `계획은 ${PLAN_MAX}개 이하여야 합니다` };
  const workers = memberIds.filter((id) => id !== 'order');
  const out = [];
  for (const p of plan) {
    const v = validateTask({ title: p?.title, detail: p?.detail, member: p?.member }, workers);
    if (v.error) return v;
    const why = p.why === undefined ? '' : p.why;
    if (typeof why !== 'string' || why.length > 300) return { error: '배정 이유는 300자 이하 문자열이어야 합니다' };
    out.push({ member: v.member, title: v.title, detail: v.detail, why: why.trim() });
  }
  return { plan: out };
}
