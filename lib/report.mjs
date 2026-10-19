// 일일 보고 — 그날의 작업·메시지·승인·토큰을 모아 한 장(한 일, 막힌 일, 내일 할 일, 토큰)으로. 순수 함수.
import { KIND_LABEL, sumUsage } from './state.mjs';
import { waitingOn } from './queue.mjs';

const ACTION = { push: 'push', deploy: '배포', migrate: 'DB 마이그레이션', send: '외부 발송', delete: '삭제', budget: '예산 확인' };
const LIST_MAX = 15;

/** 시각 → 이 컴퓨터 기준 YYYY-MM-DD */
export function dateKey(at) {
  const d = new Date(at);
  if (Number.isNaN(d.getTime())) return '';
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
export const isDateKey = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && dateKey(`${s}T12:00:00`) === s;

const firstLine = (s) => (String(s || '').split('\n').find((l) => l.trim()) || '').trim().slice(0, 140);
const fmt = (n) => Math.round(n || 0).toLocaleString('ko-KR');
const tok = (u) => (u ? (u.input || 0) + (u.output || 0) + (u.cacheRead || 0) + (u.cacheWrite || 0) : 0);

function list(items, line, empty) {
  if (!items.length) return [`- ${empty}`];
  const out = items.slice(0, LIST_MAX).map(line);
  if (items.length > LIST_MAX) out.push(`- 외 ${items.length - LIST_MAX}건`);
  return out;
}

/**
 * → { date, markdown, counts: {done, blocked, next, tokens, messages} }
 * budget 은 squad.config.json 의 budget(없으면 상한 표시 없음).
 */
export function buildReport({ project, date, tasks = [], messages = [], approvals = [], events = [], members = [], budget = { daily: 0 } }) {
  const name = (id) => (id === 'human' ? '사람' : members.find((m) => m.id === id)?.name || id);
  const on = (at) => dateKey(at) === date;
  const byId = new Map(tasks.map((t) => [t.id, t]));

  const done = tasks.filter((t) => t.status === 'done' && on(t.updatedAt));
  const blocked = tasks.filter((t) => t.status === 'blocked');
  const waiting = approvals.filter((a) => a.status === 'pending');
  const next = tasks
    .filter((t) => t.status === 'todo' || t.status === 'review' || t.status === 'doing')
    .sort((a, b) => (a.step || 1) - (b.step || 1) || String(a.createdAt).localeCompare(String(b.createdAt)));
  const evs = events.filter((e) => e.usage && on(e.at));
  const total = sumUsage(evs.map((e) => e.usage)).total;
  const per = {};
  for (const e of evs) per[e.member] = (per[e.member] || 0) + tok(e.usage);
  const top = Object.entries(per).sort((a, b) => b[1] - a[1]);
  const msgs = messages.filter((m) => on(m.at));
  const kinds = {};
  for (const m of msgs) kinds[m.kind] = (kinds[m.kind] || 0) + 1;
  const decided = approvals.filter((a) => a.decidedAt && on(a.decidedAt));

  const md = [
    `# ${project?.name || project?.id || ''} 일일 보고 — ${date}`,
    '',
    `## 한 일 (${done.length})`,
    ...list(done, (t) => `- ${name(t.member)}: ${t.title}${t.summary ? ` — ${firstLine(t.summary)}` : ''}${t.usage ? ` (${fmt(tok(t.usage))}토큰)` : ''}`, '끝낸 작업이 없습니다'),
    '',
    `## 막힌 일 (${blocked.length + waiting.length})`,
    ...list(
      [...blocked.map((t) => ({ t })), ...waiting.map((a) => ({ a }))],
      ({ t, a }) => (t ? `- ${name(t.member)}: ${t.title}${t.summary ? ` — ${firstLine(t.summary)}` : ''}` : `- 승인 대기 · ${name(a.from)}: ${ACTION[a.action] || a.action} — ${firstLine(a.text)}`),
      '막힌 일이 없습니다',
    ),
    '',
    `## 내일 할 일 (${next.length})`,
    ...list(next, (t) => {
      const wait = waitingOn(t, byId);
      const note = t.status === 'review' ? ' (검수 대기)' : t.status === 'doing' ? ' (진행 중)' : wait.length ? ` (선행 대기: ${wait.map((id) => byId.get(id)?.title || id).join(', ')})` : '';
      return `- ${t.step ? `[${t.step}] ` : ''}${name(t.member)}: ${t.title}${note}`;
    }, '남은 작업이 없습니다'),
    '',
    '## 토큰',
    `- 오늘 ${fmt(total)}토큰${budget.daily > 0 ? ` / 상한 ${fmt(budget.daily)} (${Math.round((total / budget.daily) * 100)}%)` : ''}`,
    ...top.slice(0, 5).map(([id, n]) => `- ${name(id)}: ${fmt(n)}`),
    '',
    '## 커뮤니케이션',
    `- 메시지 ${msgs.length}건${msgs.length ? ` (${Object.entries(kinds).map(([k, n]) => `${KIND_LABEL[k] || k} ${n}`).join(' · ')})` : ''}`,
    `- 승인 결정 ${decided.length}건, 승인 대기 ${waiting.length}건`,
    '',
  ].join('\n');
  return { date, markdown: md, counts: { done: done.length, blocked: blocked.length + waiting.length, next: next.length, tokens: total, messages: msgs.length } };
}

/** --ai 다듬기 프롬프트: 규칙 기반 보고를 넣고 같은 절 구조로 문장만 다듬게 한다. */
export function polishPrompt(markdown) {
  return [
    '아래는 AI Squad 의 규칙 기반 일일 보고다. 내용을 더하거나 빼지 말고, 같은 제목·절 구조를 지키며 문장만 읽기 좋게 다듬어라.',
    '숫자·이름·작업 제목은 그대로 둔다. 이모지를 쓰지 않는다. 마크다운만 답한다(코드 울타리 없이).',
    '',
    markdown,
  ].join('\n');
}
