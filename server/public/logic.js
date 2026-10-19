// 보드 화면의 판단 부분 — DOM 을 만지지 않는 순수 함수. node --test 로 시험한다(server/logic.test.mjs).

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ESC[c]);

/**
 * 확인할 일 목록 — 급한 것 먼저: 승인 → 막힘 → 답 없는 질문 → 예산 → 계획(배정 기다림) → 로그인.
 * approvals 는 결정 안 된 것만 넘긴다. unanswered: 서버가 오래 답이 없다고 본 메시지 id.
 * → [{key, type: 'approval'|'blocked'|'question'|'budget'|'plan'|'login', ...}]
 */
export function confirmItems({ approvals = [], tasks = [], messages = [], unanswered = [], plan = null, runners = [] }) {
  const ap = approvals.filter((a) => a.action !== 'budget').map((a) => ({ key: `ap:${a.id}`, type: 'approval', a }));
  // 막힐 때마다 새 카드(updatedAt) — 재시도 뒤 또 막히면 다시 올라온다
  const bl = tasks.filter((t) => t.status === 'blocked').map((t) => ({ key: `bl:${t.id}|${t.updatedAt || ''}`, type: 'blocked', t }));
  const late = new Set(unanswered);
  const qu = messages
    .filter((m, i) => m.kind === 'question' && late.has(m.id) && m.from !== 'human' && m.to !== 'human' && !humanReplied(messages, i))
    .map((m) => ({ key: `q:${m.id}`, type: 'question', m }));
  const bu = approvals.filter((a) => a.action === 'budget').map((a) => ({ key: `ap:${a.id}`, type: 'budget', a }));
  const pl = plan ? [{ key: `plan:${plan.instruction}`, type: 'plan' }] : [];
  const lo = runners.filter((r) => r.canLogin).map((r) => ({ key: `login:${r.name}`, type: 'login', r }));
  return [...ap, ...bl, ...qu, ...bu, ...pl, ...lo];
}

/** messages[i] 뒤에 사람이 그 질문한 멤버에게(작업이 있으면 같은 작업으로) 답·메모를 보냈는지 — 대신 답하기·넘기기 포함. */
const humanReplied = (messages, i) => {
  const m = messages[i];
  return messages.slice(i + 1).some((r) => r.from === 'human' && r.to === m.from && (!m.taskId || r.taskId === m.taskId));
};

/** 멤버가 사람에게 물었는데 아직 답하지 않은 질문. */
export const humanQuestions = (messages = []) =>
  messages.filter((m, i) => m.kind === 'question' && m.to === 'human' && m.from !== 'human' && !humanReplied(messages, i));

/** 사람에게 온 질문 → 입력 요청 모달이 다루는 모양(답 칸 하나). input.msg 가 있으면 답은 answer 메시지로 보낸다. */
export const questionInput = (m, tasks = []) => ({
  id: m.taskId || m.id,
  title: tasks.find((t) => t.id === m.taskId)?.title || '질문',
  input: { kind: 'form', from: m.from, title: '질문에 답해 주세요', text: m.text, at: m.at, msg: m, fields: [{ name: 'answer', label: '답', required: true }] },
});

/** 입력 요청 모달 목록: 작업 입력 요청 + 사람에게 온 질문, 먼저 온 것부터. */
export const askItems = (tasks = [], messages = []) =>
  [...pendingInputs(tasks), ...humanQuestions(messages).map((m) => questionInput(m, tasks))]
    .sort((a, b) => String(a.input.at).localeCompare(String(b.input.at)));

/** 막힘 카드 단추 → 서버 요청. act: retry|reassign|done|cancel. 다른 멤버에게는 member 가 있어야 한다. */
export function blockedAction(act, taskId, { note = '', member = '' } = {}) {
  if (!['retry', 'reassign', 'done', 'cancel'].includes(act)) return { error: '모르는 동작입니다' };
  if (act === 'reassign' && !member) return { error: '넘길 멤버를 고르세요' };
  const body = { ...(note.trim() ? { note: note.trim() } : {}), ...(act === 'reassign' ? { member } : {}) };
  return { url: `/api/task/${encodeURIComponent(taskId)}/${act}`, body };
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

/** 상태 이름. 서버가 statusLabels(lib/state.mjs STATUS_LABEL)를 주면 그것을 쓴다 — 이 표는 서버 반영 전 대비. */
export const STATUS_FALLBACK = { working: '일하는 중', idle: '쉬는 중', blocked: '막힘', input: '입력 대기', approval: '승인 대기' };

/** 상단 '할 일' 칩: todo 수와 그중 선행이 남아 잠긴 수. */
export function todoCounts(tasks = []) {
  const todo = tasks.filter((t) => t.status === 'todo');
  return { todo: todo.length, locked: todo.filter((t) => t.waitingOn?.length).length };
}

/** 보이는 멤버 상태: 일하는 중이 아니고 사람 답을 기다리면 입력 대기·승인 대기로 나눈다. */
export function viewStatus(m, { tasks = [], approvals = [] } = {}) {
  if (m.status === 'working') return 'working';
  if (tasks.some((t) => t.member === m.id && t.status === 'input' && t.input)) return 'input';
  if (approvals.some((a) => a.from === m.id && a.status === 'pending')) return 'approval';
  return m.status;
}

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

// ── 토큰·한도 ──
const HOUR = 3600e3;
const DAY = 24 * HOUR;
const DOW = ['일', '월', '화', '수', '목', '금', '토'];
/** Claude 한도 칩 단계: 70% 노랑, 90% 빨강. */
export const limitLevel = (used) => (used >= 0.9 ? 'over' : used >= 0.7 ? 'warn' : 'ok');
/** 리셋 시각(한국시간): 24시간 안이면 'HH:MM', 넘으면 '목 21:00'. */
export function resetText(ms, now = Date.now()) {
  if (!ms) return '';
  const d = new Date(ms + 9 * HOUR);
  const hm = `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`;
  return ms - now > DAY ? `${DOW[d.getUTCDay()]} ${hm}` : hm;
}
/** 한도 창 하나 → 칩에 쓸 값. 창 정보가 없으면 null. */
export function limitChip(w, now = Date.now()) {
  if (!w || !Number.isFinite(w.used)) return null;
  const pct = Math.round(w.used * 100);
  return { pct, left: Math.max(0, 100 - pct), reset: resetText(w.resetsAt, now), lv: limitLevel(w.used) };
}
/** 21시 경계 하루 키 — 서버 lib/state.mjs usageDay 와 같은 규칙. */
const dayKey = (t) => new Date(t + 12 * HOUR).toISOString().slice(0, 10);
/** 이번 주 7칸: 주간 창 시작부터 하루씩, 아직 오지 않은 날은 빈 칸(future). */
export function weekSlots(week) {
  if (!week?.start) return [];
  const got = new Map((week.days || []).map((d) => [d.day, d]));
  return Array.from({ length: 7 }, (_, i) => {
    const t = week.start + i * DAY;
    const day = dayKey(t);
    const d = got.get(day);
    return { day, dow: DOW[new Date(day).getUTCDay()], tokens: d?.tokens || 0, byRunner: d?.byRunner || {}, used: d?.used ?? null, future: !d };
  });
}
/** 이번 주 멤버별 합계 상위 n. */
export function topMembers(week, n = 5) {
  const sum = {};
  for (const d of week?.days || []) for (const [m, v] of Object.entries(d.byMember || {})) sum[m] = (sum[m] || 0) + v;
  return Object.entries(sum).sort((a, b) => b[1] - a[1]).slice(0, n);
}

// ── 사용량 탭 ──
const tokOf = (u) => (u.input || 0) + (u.output || 0) + (u.cacheRead || 0) + (u.cacheWrite || 0);
/** 예산 기준 토큰 — 서버 lib/state.mjs budgetTokens 와 같은 환산(캐시 읽기 10%, 쓰기 125%). */
export const budgetTok = (u) => Math.round((u.input || 0) + (u.output || 0) + (u.cacheRead || 0) * 0.1 + (u.cacheWrite || 0) * 1.25);
const blank = () => ({ total: 0, budget: 0, cost: 0, costed: false });
const addUse = (s, u) => {
  s.total += tokOf(u);
  s.budget += budgetTok(u);
  if (Number.isFinite(u.costUsd)) (s.cost += u.costUsd), (s.costed = true);
  return s;
};

/**
 * 이번 주(since 이후) usage 이벤트로 사용량 탭 숫자를 만든다 — 작업 단위는 end 이벤트(taskId)를 더한다.
 * truncated: 서버가 보낸 이벤트(최근 500개)가 since 까지 닿지 않아 실제보다 적을 수 있음.
 * agEstUsd: Antigravity 로 돈 토큰을 Claude 의 같은 주 단가(US$/예산 토큰)로 바꾼 추정값. Claude 비용 기록이 없으면 null.
 */
export function usageReport({ events = [], tasks = [], members = [] }, since) {
  const evs = events.filter((e) => e.usage && Date.parse(e.at) >= since);
  const week = blank();
  const runner = {};
  const mem = {};
  const task = {};
  for (const e of evs) {
    const u = e.usage;
    const r = u.runner || 'claude';
    addUse(week, u);
    addUse((runner[r] ??= blank()), u);
    const m = (mem[e.member] ??= { ...blank(), ids: new Set(), bases: [], runners: {} });
    addUse(m, u);
    if (Number.isFinite(u.base)) m.bases.push(u.base);
    m.runners[r] = (m.runners[r] || 0) + budgetTok(u);
    if (e.taskId) {
      m.ids.add(e.taskId);
      addUse((task[e.taskId] ??= { id: e.taskId, member: e.member, runner: r, ...blank() }), u);
    }
  }
  const title = new Map(tasks.map((t) => [t.id, t.title]));
  const model = new Map(members.map((m) => [m.id, m.model || '']));
  const c = runner.claude;
  const rate = c?.costed && c.budget ? c.cost / c.budget : null;
  return {
    truncated: events.length >= 500 && Date.parse(events[0]?.at) > since,
    week,
    runner,
    members: Object.entries(mem)
      .map(([id, m]) => ({
        id, total: m.total, budget: m.budget, cost: m.costed ? m.cost : null, tasks: m.ids.size,
        avgBase: m.bases.length ? Math.round(m.bases.reduce((a, b) => a + b, 0) / m.bases.length) : null,
        perTask: m.ids.size ? Math.round(m.total / m.ids.size) : null,
        runner: Object.entries(m.runners).sort((a, b) => b[1] - a[1])[0][0],
        model: model.get(id) || '',
      }))
      .sort((a, b) => b.budget - a.budget),
    top: Object.values(task)
      .map((t) => ({ ...t, title: title.get(t.id) || t.id, cost: t.costed ? t.cost : null }))
      .sort((a, b) => (b.cost ?? -1) - (a.cost ?? -1) || b.budget - a.budget)
      .slice(0, 10),
    agEstUsd: rate === null || !runner.antigravity ? null : runner.antigravity.budget * rate,
  };
}

/**
 * 서버 week.days(전체 기록 집계) 합 → 이번 주 예산 기준·날것 토큰·비용, runner 별 같은 값.
 * agEstUsd: Antigravity 예산 토큰 × Claude 이번 주 단가(비용 ÷ 예산 토큰). Claude 비용이 없으면 null.
 */
export function weekTotals(week) {
  const w = { budget: 0, total: 0, cost: 0, runner: {} };
  for (const d of week?.days || []) {
    w.budget += d.tokens || 0;
    w.total += d.total || 0;
    w.cost += d.costUsd || 0;
    for (const r of new Set([...Object.keys(d.byRunner || {}), ...Object.keys(d.runners || {})])) {
      const s = (w.runner[r] ??= { budget: 0, total: 0, cost: 0 });
      s.budget += d.byRunner?.[r] || 0;
      s.total += d.runners?.[r]?.total || 0;
      s.cost += d.runners?.[r]?.costUsd || 0;
    }
  }
  const c = w.runner.claude;
  const ag = w.runner.antigravity;
  w.agEstUsd = ag && c?.budget && c.cost ? ag.budget * (c.cost / c.budget) : null;
  return w;
}

/** 'headroom savings --json' 캐시 → 오늘·7일 절약. 서버 응답이 {at, data} 로 감싸도, 날것이어도 읽는다. 모르면 null. */
export function headroomView(h) {
  const w = h?.windows || h?.data?.windows;
  if (!w) return null;
  const pick = (x) => (x ? { saved: x.tokens_saved || 0, before: x.tokens_before || 0, pct: x.savings_percent ?? (x.tokens_before ? Math.round((x.tokens_saved / x.tokens_before) * 1000) / 10 : null), newPct: x.new_input_savings_percent ?? null, usd: x.cost_usd ?? null, calls: x.calls || 0 } : null);
  return { at: h.at || null, today: pick(w.today), week: pick(w.last_7_days) };
}
