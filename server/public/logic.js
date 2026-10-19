// 보드 화면의 판단 부분 — DOM 을 만지지 않는 순수 함수. node --test 로 시험한다(server/logic.test.mjs).

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ESC[c]);

/**
 * 확인할 일 목록 — 급한 것 먼저: 승인 → 예산 → 계획(배정 기다림) → 로그인.
 * approvals 는 결정 안 된 것만 넘긴다. → [{key, type: 'approval'|'budget'|'plan'|'login', ...}]
 */
export function confirmItems({ approvals = [], plan = null, runners = [] }) {
  const ap = approvals.filter((a) => a.action !== 'budget').map((a) => ({ key: `ap:${a.id}`, type: 'approval', a }));
  const bu = approvals.filter((a) => a.action === 'budget').map((a) => ({ key: `ap:${a.id}`, type: 'budget', a }));
  const pl = plan ? [{ key: `plan:${plan.instruction}`, type: 'plan' }] : [];
  const lo = runners.filter((r) => r.canLogin).map((r) => ({ key: `login:${r.name}`, type: 'login', r }));
  return [...ap, ...bu, ...pl, ...lo];
}

/**
 * /api/order 응답 → 자동 배정됐는지, 확인이 필요한지.
 * 서버가 배정까지 끝냈으면(tasks 가 있고 needsConfirm 이 true 가 아님) 'auto', 아니면 'confirm' + 사유.
 * 사유는 서버 reasons 우선, 없으면 오더가 계획 항목에 단 reason 으로 채운다.
 * → { kind: 'auto', count } | { kind: 'confirm', reasons: [string] }
 */
export function orderOutcome(r = {}) {
  if (Array.isArray(r.tasks) && r.needsConfirm !== true) return { kind: 'auto', count: r.tasks.length };
  const own = (r.plan || []).filter((p) => p.needsConfirm).map((p) => `오더 판단: ${p.member} · ${p.reason || p.title}`);
  return { kind: 'confirm', reasons: Array.isArray(r.reasons) && r.reasons.length ? r.reasons.map(String) : own };
}

/**
 * 확인 패널을 어떻게 할지 — 상태가 바뀔 때마다(첫 상태 포함) 부른다.
 * seen: 이미 본 key 들. 처음 받은 상태에서는 seen 이 비어 있어 모든 항목이 "새것"이다 → 닫혀 있어도 펼친다.
 * → { open, fresh: [새 key], seen: 다음 seen }
 */
export function panelDecision({ items, seen, open }) {
  const fresh = items.filter((i) => !seen.has(i.key)).map((i) => i.key);
  return { open: open || fresh.length > 0, fresh, seen: new Set(items.map((i) => i.key)) };
}

/** 위험도가 높음이면 상세를 한 번 펼쳐 봐야 [승인]이 켜진다. */
export const canApprove = (a, viewed) => a?.risk !== 'high' || Boolean(viewed);

/** diff 처럼 보이는지(그래야 +/- 색을 칠한다). SQL 의 `--` 주석을 지움 줄로 보지 않으려고. */
export const looksLikeDiff = (text) => /^(diff --git |@@ |\+\+\+ |--- a\/)/m.test(String(text || ''));

/**
 * diff·SQL → 줄 번호와 +/- 색이 붙은 HTML 표. 모든 글자는 이스케이프한다. maxLines 를 넘는 줄은 "n줄 더".
 */
export function renderDiff(text, maxLines = 1500) {
  const lines = String(text ?? '').replace(/\r\n/g, '\n').split('\n');
  const diff = looksLikeDiff(text);
  const kind = (l) => {
    if (!diff) return 'ctx';
    if (/^(diff |index |\+\+\+ |--- )/.test(l)) return 'meta';
    if (l.startsWith('@@')) return 'hunk';
    if (l.startsWith('+')) return 'add';
    if (l.startsWith('-')) return 'del';
    return 'ctx';
  };
  const rows = lines.slice(0, maxLines).map((l, i) => `<tr class="d-${kind(l)}"><td class="ln">${i + 1}</td><td class="code">${esc(l) || ' '}</td></tr>`);
  if (lines.length > maxLines) rows.push(`<tr class="d-meta"><td class="ln"></td><td class="code">… ${lines.length - maxLines}줄 더</td></tr>`);
  return `<table class="diff${diff ? ' is-diff' : ''}"><tbody>${rows.join('')}</tbody></table>`;
}

/** 예산 막대: 비율 → 단계(ok·warn·over). */
export const budgetLevel = (ratio, warn = 0.8) => (ratio >= 1 ? 'over' : ratio >= warn ? 'warn' : 'ok');

/** 입력 대기 작업: 먼저 요청한 것부터. key 는 같은 요청이면 같다. */
export const inputKey = (t) => `${t.id}|${t.input.at}`;
export const pendingInputs = (tasks = []) =>
  tasks.filter((t) => t.status === 'input' && t.input).sort((a, b) => String(a.input.at).localeCompare(String(b.input.at)));

/** 모달 값 → /api/input/answer 본문 | { error }. 서버도 같은 검증을 하지만 필수 칸은 보내기 전에 알린다. */
export function inputPayload(task, { approve, choice, values = {}, note = '' }) {
  const req = task.input;
  const body = { taskId: task.id, ...(note.trim() ? { note: note.trim() } : {}) };
  if (req.kind === 'preview') {
    if (typeof approve !== 'boolean') return { error: '보낼지 정해 주세요' };
    return { body: { ...body, approve } };
  }
  if (req.kind === 'choice') {
    if (!req.options.some((o) => o.id === choice)) return { error: '안을 하나 고르세요' };
    return { body: { ...body, choice } };
  }
  const miss = req.fields.filter((f) => f.required && !String(values[f.name] ?? '').trim());
  if (miss.length) return { error: `필수 칸을 채워 주세요: ${miss.map((f) => f.label).join(', ')}`, missing: miss.map((f) => f.name) };
  return { body: { ...body, values: Object.fromEntries(req.fields.map((f) => [f.name, String(values[f.name] ?? '').trim()])) } };
}
