// 빠른 길: 지시가 한 멤버 일로 분명하면 계획 LLM 없이 그 멤버 작업 1개로 바로 배정한다(2026-10-19 사용자: 스쿼드 비용이 직접 시키는 것보다 크다).
// 둘 이상이거나 애매하면 null — 그때만 메인 AI 가 계획한다.

const HARD = /설계|아키텍처|리팩터|마이그레이션|보안|전체|여러|모든/;
// 화면 멤버(owns 에 public·web 등)는 역할에 안 적혀도 이 낱말로 알아본다
const SCREEN = ['화면', '버튼', '헤더', '드롭다운', '메뉴', '레이아웃', '스타일', '아이콘', 'css'];
const MULTI =/그리고|또한|및|\n|;|\d+\)|①|②/;

/** 멤버를 가리키는 낱말: id·이름·owns 경로 조각·역할 낱말. */
function wordsOf(m) {
  const owns = (m.owns || []).flatMap((p) => p.split(/[\/*.]+/));
  const role = String(m.role || '').split(/[^0-9A-Za-z가-힣_-]+/);
  const screen = (m.owns || []).some((p) => /public|client|web|front|ui/i.test(p)) ? SCREEN : [];
  return new Set([m.id, m.name, ...owns, ...role, ...screen].map((w) => String(w || '').toLowerCase()).filter((w) => w.length >= 2));
}

const hit = (text, w) => (/^[a-z0-9_-]+$/.test(w) ? new RegExp(`(^|[^a-z0-9_])${w.replace(/-/g, '\\-')}($|[^a-z0-9_])`).test(text) : text.includes(w));

/**
 * → { member, title, detail, why, step, difficulty } 또는 null.
 * 여러 멤버에 겹치는 낱말은 버리고, 남은 낱말이 한 멤버에만 걸릴 때만 그 멤버로 정한다.
 * ponytail: 낱말 대조뿐이다. 오배정이 잦으면 멤버별 keywords frontmatter 를 둔다.
 */
export function fastPlan(instruction, members = []) {
  const text = String(instruction || '').trim();
  if (!text || text.length > 300 || MULTI.test(text)) return null;
  const cands = members.filter((m) => m.id !== 'order').map((m) => ({ id: m.id, words: wordsOf(m) }));
  const count = new Map();
  for (const c of cands) for (const w of c.words) count.set(w, (count.get(w) || 0) + 1);
  const low = text.toLowerCase();
  const matched = cands.filter((c) => [...c.words].some((w) => count.get(w) === 1 && hit(low, w)));
  if (matched.length !== 1) return null;
  const difficulty = text.length <= 60 && !HARD.test(text) ? 'easy' : 'normal';
  return { member: matched[0].id, title: text.split('\n')[0].slice(0, 80), detail: text, why: '빠른 길(계획 생략)', step: 1, difficulty };
}
