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
