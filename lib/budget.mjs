// 토큰 예산 — 순수 함수. squad.config.json 의 budget(하루 전체·멤버별 하루·작업당)과 MEMBER.md 의 budget(멤버별 하루 덮어쓰기).
// 토큰은 보드와 같이 입력·출력·캐시 읽기·캐시 쓰기를 모두 더한 값(tokenTotal)으로 센다. 0 은 상한 없음.
import { sameDay, sumUsage, tokenTotal } from './state.mjs';

/** 멤버의 하루 상한: MEMBER.md budget 이 있으면 그것, 없으면 config.memberDaily. */
export function memberLimit(budget, member) {
  const own = Number(member?.budget);
  return Number.isFinite(own) && own > 0 ? Math.round(own) : budget.memberDaily || 0;
}

/** 그날 쓴 토큰: 전체와 멤버별. events 의 usage(end·plan 이벤트)를 더한다. */
export function usageOn(events, now = Date.now()) {
  const today = events.filter((e) => e.usage && sameDay(e.at, now));
  const byMember = {};
  for (const e of today) byMember[e.member] = (byMember[e.member] || 0) + tokenTotal(e.usage);
  return { total: sumUsage(today.map((e) => e.usage)).total, byMember };
}

/**
 * 실행 전 예산 판단. 하루 전체와 그 멤버의 하루 중 더 많이 쓴 쪽 비율로 정한다.
 * → { level: 'ok'|'warn'|'over', ratio, reason }  (warn: budget.warn 이상, over: 100% 이상)
 */
export function checkBudget({ budget, used, memberUsed = 0, memberCap = 0 }) {
  const parts = [];
  if (budget.daily > 0) parts.push({ ratio: used / budget.daily, label: `오늘 전체 ${fmt(used)} / ${fmt(budget.daily)}토큰` });
  if (memberCap > 0) parts.push({ ratio: memberUsed / memberCap, label: `이 멤버 오늘 ${fmt(memberUsed)} / ${fmt(memberCap)}토큰` });
  if (!parts.length) return { level: 'ok', ratio: 0, reason: '예산 상한 없음' };
  const top = parts.reduce((a, b) => (b.ratio > a.ratio ? b : a));
  const level = top.ratio >= 1 ? 'over' : top.ratio >= budget.warn ? 'warn' : 'ok';
  return { level, ratio: Math.round(top.ratio * 1000) / 1000, reason: `${top.label} (${Math.round(top.ratio * 100)}%)` };
}

/** 작업 하나가 실행 중에 쓴 토큰이 작업 상한을 넘었는지. */
export const overTaskCap = (budget, tokens) => budget.task > 0 && tokens > budget.task;

const fmt = (n) => Math.round(n || 0).toLocaleString('ko-KR');

/**
 * stream-json 의 assistant 줄마다 붙는 message.usage 를 누적한다. 같은 메시지(id)가 여러 줄로 오면 마지막 값만 센다.
 * add(id, usage) → 지금까지 합(토큰).
 */
export function usageMeter() {
  const byId = new Map();
  let n = 0;
  return {
    add(id, usage) {
      byId.set(id || `#${n++}`, usage);
      return tokenTotal(sumUsage(byId.values()));
    },
    usage: () => sumUsage(byId.values()),
  };
}
