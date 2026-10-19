// 승인 대기 — 멤버·메인 AI 가 위험 행위를 하기 전에 남기는 요청과 사람의 결정. <project>/.squad/approvals.jsonl 에 덧붙이기만 한다.
// 줄 종류: {type:'request', id, at, from, action, text, reason?, scope?, taskId?}
//          {type:'decision', id, at, decision:'approved'|'rejected', by, note?}  (note: 거절 사유 등)
import { appendJsonl, newId, readJsonl, updateTask } from './store.mjs';
import { LIMITS } from './validate.mjs';
import { sameDay } from './state.mjs';

export const ACTIONS = { push: 'push', deploy: '배포', migrate: 'DB 마이그레이션', send: '외부 발송', delete: '삭제', budget: '예산 확인' };
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
  const d = validateApprovalDetails(r);
  if (d.error) return d;
  return {
    from: r.from, action: r.action, text,
    ...(r.reason?.trim() ? { reason: r.reason.trim() } : {}),
    ...(r.scope?.trim() ? { scope: r.scope.trim() } : {}),
    ...(r.taskId ? { taskId: r.taskId } : {}),
    ...d.details,
  };
}

// ── v0.4 승인 상세: 승인하기 전에 볼 내용 ──
export const RISKS = { low: '낮음', medium: '보통', high: '높음' };
const RISK_ALIAS = { 낮음: 'low', 보통: 'medium', 높음: 'high' };
export const DETAIL_LIMITS = { details: 4000, diffBytes: 20 * 1024, files: 100, file: 300, commands: 10, command: 500, rollback: 1000 };

/**
 * 선택 필드 검증 — 순수 함수. details(마크다운), files(경로 목록), diff(SQL·git diff, 20KB 이하), commands(명령 목록), risk(낮음/보통/높음), rollback.
 * → { details: {...있는 것만} } | { error }
 */
export function validateApprovalDetails(r) {
  const L = DETAIL_LIMITS;
  const out = {};
  const s = (v) => (typeof v === 'string' ? v.replace(/\r\n/g, '\n').trim() : v);
  const details = s(r.details);
  if (details !== undefined && details !== '') {
    if (typeof details !== 'string' || details.length > L.details) return { error: `상세 설명은 ${L.details}자 이하로 써 주세요` };
    out.details = details;
  }
  const diff = typeof r.diff === 'string' ? r.diff.replace(/\r\n/g, '\n').replace(/\s+$/, '') : r.diff;
  if (diff !== undefined && diff !== '') {
    if (typeof diff !== 'string') return { error: 'diff 는 문자열이어야 합니다' };
    if (Buffer.byteLength(diff, 'utf8') > L.diffBytes) return { error: 'diff 는 20KB 이하로 줄여 주세요' };
    out.diff = diff;
  }
  const list = (v, max, each, label) => {
    if (v === undefined || v === '' || (Array.isArray(v) && !v.length)) return null;
    const arr = Array.isArray(v) ? v : [v];
    if (arr.length > max || !arr.every((x) => typeof x === 'string' && x.trim() && x.length <= each)) return { error: `${label}: ${max}개 이하, 하나에 ${each}자 이하로 써 주세요` };
    return arr.map((x) => x.trim());
  };
  const files = list(r.files, L.files, L.file, '파일 목록');
  if (files?.error) return files;
  if (files) out.files = files;
  const commands = list(r.commands, L.commands, L.command, '명령');
  if (commands?.error) return commands;
  if (commands) out.commands = commands;
  if (r.risk !== undefined && r.risk !== '') {
    const risk = RISK_ALIAS[r.risk] || r.risk;
    if (!RISKS[risk]) return { error: '위험도는 낮음·보통·높음(low·medium·high) 중 하나여야 합니다' };
    out.risk = risk;
  }
  const rollback = s(r.rollback);
  if (rollback !== undefined && rollback !== '') {
    if (typeof rollback !== 'string' || rollback.length > L.rollback) return { error: `되돌리는 방법은 ${L.rollback}자 이하로 써 주세요` };
    out.rollback = rollback;
  }
  return { details: out };
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
/**
 * 결정 뒤 멈춘 작업을 이어 실행할 patch — 순수 함수. 이을 게 없으면 null(예산 확인·작업 없음·실행 중·취소됨).
 * 승인이면 detail 에 '[승인됨] <행위 — 내용> · 명령: ...' 을 붙이고 allow(이번 실행에만 허용할 명령)를 싣는다.
 * 거절이면 사유를 붙여 todo 로(대안 찾기).
 */
export function resumePatch(task, d) {
  if (d.action === 'budget' || !task || task.status === 'doing' || task.status === 'cancelled') return null;
  const what = `${ACTIONS[d.action]} — ${d.text}`;
  const line = d.status === 'approved'
    ? `[승인됨] ${what}${d.commands?.length ? ` · 명령: ${d.commands.join(' ; ')}` : ''}`
    : `[거절됨] ${what}${d.note ? ` (사유: ${d.note})` : ''} — 이 행위 없이 대안을 찾을 것`;
  const keep = Math.max(0, LIMITS.detail - line.length - 2);
  const detail = `${(task.detail || '').slice(0, keep)}\n\n${line}`.trim().slice(0, LIMITS.detail);
  return { status: 'todo', detail, summary: '', allow: d.status === 'approved' ? d.commands || [] : [] };
}

/** 결정된 요청의 작업을 이어 실행하게 바꾸고 멤버 상태를 '승인 대기' 에서 풀어 준다. 바뀌었으면 true(대기열을 깨울 것). */
export function resumeAfterDecision(paths, d) {
  const patch = d.taskId && resumePatch(readJsonl(paths.tasks).find((t) => t.id === d.taskId), d);
  if (!patch) return false;
  updateTask(paths.tasks, d.taskId, patch);
  appendJsonl(paths.events, { at: new Date().toISOString(), project: paths.id, member: d.from, type: 'log', status: 'idle', taskId: d.taskId, text: `${DECISIONS[d.status]}됨 · 이어서 실행 대기` });
  return true;
}

export const decisionText = (a) => `${DECISIONS[a.status]}: ${ACTIONS[a.action]} — ${a.text}${a.note ? ` (사유: ${a.note})` : ''}`.slice(0, 2000);

// ── v0.4 예산 확인 ──
/** 그 주체(멤버 id 또는 order)가 오늘 이미 예산 경고를 승인받았는지 — 순수 함수. 한 번 승인하면 그날은 100% 전까지 다시 묻지 않는다. */
export const budgetApproved = (approvals, from, now = Date.now()) =>
  approvals.some((a) => a.action === 'budget' && a.from === from && a.status === 'approved' && sameDay(a.decidedAt, now));

/** 오늘 그 주체의 결정 안 된 예산 확인(있으면 또 만들지 않는다). */
export const pendingBudget = (approvals, from) => approvals.find((a) => a.action === 'budget' && a.from === from && a.status === 'pending');

/** 결정이 날 때까지 approvals.jsonl 을 본다 → 'approved' | 'rejected' | 'timeout'. */
export async function waitDecision(paths, id, { timeoutMs = 10 * 60000, intervalMs = 1500 } = {}) {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    const a = loadApprovals(paths).find((x) => x.id === id);
    if (a && a.status !== 'pending') return a.status;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  return 'timeout';
}
