// Claude 사용 한도(5시간·주간) — claude -p stream-json 의 rate_limit_event 를 읽고, 보드·오더 프롬프트용으로 바꾼다.
// 한도는 계정 단위라 프로젝트와 상관없이 data/limits.json 하나에 최신값만 둔다.
import fs from 'node:fs';
import path from 'node:path';
import { budgetTokens, usageDay } from './state.mjs';

const HOUR = 3600e3;
const DAY = 24 * HOUR;
export const STALE_MS = 30 * 60e3;
const WINDOWS = { fiveHour: 'five_hour', sevenDay: 'seven_day' };

const win = (x) =>
  x && Number.isFinite(x.utilization)
    ? { used: Math.round(Math.min(Math.max(x.utilization, 0), 1.5) * 1000) / 1000, resetsAt: Number.isFinite(x.resetsAt) ? x.resetsAt * 1000 : null }
    : null;

/**
 * stream-json 한 줄(객체) → { fiveHour?, sevenDay?, status, overage } | null.
 * unifiedWindows 가 없고 rateLimitType·utilization 만 오는 모양도 받는다. resetsAt 은 유닉스 초 → ms.
 */
export function readLimit(j) {
  if (j?.type !== 'rate_limit_event') return null;
  const info = j.rate_limit_info || {};
  const out = { status: String(info.status || '').slice(0, 40), overage: Boolean(info.isUsingOverage) };
  for (const [k, raw] of Object.entries(WINDOWS)) {
    const w = win(info.unifiedWindows?.[raw] || (info.rateLimitType === raw ? info : null));
    if (w) out[k] = w;
  }
  return out;
}

/** 저장된 값에 새 측정을 덮는다(한 이벤트에 창 하나만 올 수 있다). at 은 측정 시각(ms). */
export const mergeLimits = (prev, next, at = Date.now()) => ({ ...prev, ...next, at });

const file = (root) => path.join(root, 'data', 'limits.json');
export function loadLimits(root) {
  try {
    return JSON.parse(fs.readFileSync(file(root), 'utf8'));
  } catch {
    return null;
  }
}
/** 최신값으로 합쳐 저장하고 합친 값을 돌려준다. */
export function saveLimits(root, next, at = Date.now()) {
  const merged = mergeLimits(loadLimits(root), next, at);
  fs.mkdirSync(path.dirname(file(root)), { recursive: true });
  fs.writeFileSync(file(root), JSON.stringify(merged), 'utf8');
  return merged;
}

/**
 * 보드용: { fiveHour:{used,resetsAt}, sevenDay:{used,resetsAt}, at, status, overage, stale, hit, hitResetsAt } | null.
 * 리셋 시각이 지난 창은 used 0(새 측정 전까지), 그때 status 도 모름('')으로 둔다.
 */
export function limitsView(saved, now = Date.now()) {
  if (!saved || !Number.isFinite(saved.at)) return null;
  let status = saved.status || '';
  const out = { at: saved.at, overage: Boolean(saved.overage), stale: now - saved.at > STALE_MS };
  for (const k of Object.keys(WINDOWS)) {
    const w = saved[k];
    if (!w) continue;
    const expired = w.resetsAt && w.resetsAt <= now;
    if (expired) status = '';
    out[k] = expired ? { used: 0, resetsAt: null } : { used: w.used, resetsAt: w.resetsAt };
  }
  const ws = [out.fiveHour, out.sevenDay].filter(Boolean);
  const full = ws.filter((w) => w.used >= 1);
  const hit = status === 'rejected' || full.length > 0;
  // 막힌 창 중 가장 늦게 풀리는 것, rejected 인데 다 찬 창이 없으면 가장 많이 쓴 창
  const top = full.length ? full.reduce((a, b) => ((b.resetsAt || 0) > (a.resetsAt || 0) ? b : a)) : ws.reduce((a, b) => (b.used > a.used ? b : a), ws[0]);
  return { ...out, status, hit, hitResetsAt: hit ? top?.resetsAt || null : null };
}

const DOW = ['일', '월', '화', '수', '목', '금', '토'];
/** 한국시간 'HH:MM', 24시간 넘게 남았으면 '목 21:00'. */
export function fmtReset(ms, now = Date.now()) {
  if (!ms) return '';
  const d = new Date(ms + 9 * HOUR);
  const hm = `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`;
  return ms - now > DAY ? `${DOW[d.getUTCDay()]} ${hm}` : hm;
}

export const LIMIT_REASON = '사용 한도';
/** 막힌 작업 요약: '사용 한도 — 리셋 13:00 이후 또는 계정 전환'. */
export const limitBlockedText = (view, now = Date.now()) =>
  `${LIMIT_REASON} — ${view?.hitResetsAt ? `리셋 ${fmtReset(view.hitResetsAt, now)} 이후` : '리셋 이후'} 또는 계정 전환`;

/** claude 오류 글이 한도 걸림인지(이벤트가 안 온 경우의 대비). */
export const isLimitError = (text) => /usage limit|rate limit|limit reached|사용 한도/i.test(String(text || ''));

/**
 * 오더 계획 프롬프트에 넣을 한 줄. 주간 사용률 50% 미만이거나 측정이 없으면 ''.
 * ponytail: 50%·80% 두 단계 고정, 더 세밀하게 나눌 필요가 생기면 설정으로.
 */
export function limitHint(view, now = Date.now()) {
  const w = view?.sevenDay;
  if (!w || w.used < 0.5) return '';
  const left = Math.max(0, Math.round((1 - w.used) * 100));
  const when = w.resetsAt ? ` (리셋 ${fmtReset(w.resetsAt, now)})` : '';
  return w.used >= 0.8
    ? `남은 주간 한도 ${left}%${when}. 꼭 필요한 작업만 hard 로 두고, 나머지는 easy(문서·작은 수정·조회)나 normal 로 둔다.`
    : `남은 주간 한도 ${left}%${when}. 쉬운 작업(문서·작은 수정·조회)은 difficulty 를 easy 로 둬 작은 모델로 돌린다.`;
}

/**
 * 스쿼드 탭 '이번 주 사용': 주간 창 시작(resetsAt-7일, 모르면 오늘 포함 7일)부터 하루(한국시간 21시 경계)마다
 * 예산 환산 토큰(전체·멤버별)과 그날 마지막 주간 사용률(limit 이벤트, 없으면 null).
 * → { start, resetsAt, days: [{ day, tokens, byMember, used }] }
 */
export function weekUsage(events, view, now = Date.now()) {
  const resetsAt = view?.sevenDay?.resetsAt || null;
  const start = resetsAt ? resetsAt - 7 * DAY : now - 6 * DAY;
  const days = new Map();
  for (let t = start; t <= now; t += DAY) days.set(usageDay(t), { day: usageDay(t), tokens: 0, byMember: {}, used: null });
  for (const e of events) {
    const t = Date.parse(e.at);
    if (!(t >= start && t <= now)) continue;
    const d = days.get(usageDay(t));
    if (!d) continue;
    if (e.usage) {
      const n = budgetTokens(e.usage);
      d.tokens += n;
      d.byMember[e.member] = (d.byMember[e.member] || 0) + n;
    }
    if (e.type === 'limit' && Number.isFinite(e.limits?.sevenDay?.used)) d.used = e.limits.sevenDay.used;
  }
  return { start, resetsAt, days: [...days.values()] };
}
