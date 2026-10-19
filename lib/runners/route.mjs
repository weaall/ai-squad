// 작업 단위 runner 라우팅 — 작업마다 어느 runner·모델로 돌릴지 고르고, antigravity 가 실패하면 한 번 claude 로 대체한다.
// - 프로젝트에서 antigravity 가 켜져 있을 때만(projects.json 의 runners). 꺼져 있으면 MEMBER.md runner 그대로.
// - 작업에 runner·model 이 적혀 있으면(메인 오더 계획) 그것이 MEMBER.md runner 보다 우선.
// - easy·가벼운 종류(검수·일일 보고·로그 요약·조사·긴 문서 읽기) → antigravity 기본 모델.
// - 그 밖의 작업도 antigravity 우선(그 안의 claude-sonnet-4-6). hard·화면 판단만 claude.
import { DEFAULT_MODEL } from './antigravity.mjs';

export const LIGHT_KINDS = ['review', 'report', 'summary', 'research', 'read'];
export const BUSY_MODEL = 'claude-sonnet-4-6';
export const CLAUDE_BUSY = 0.7;

/**
 * → { runner, model, reason }. model 이 '' 이면 평소대로(modelFor) 고른다.
 * task: { difficulty?, kind?, runner?, model? } · member: { runner } · projectRunners: projects.json runners · limits: limitsView 결과
 */
export function routeTask({ task = {}, member = {}, projectRunners = ['claude'], limits = null }) {
  const base = { runner: member.runner || 'claude', model: '', reason: '' };
  const agy = projectRunners.includes('antigravity');
  if (task.runner && (task.runner !== 'antigravity' || agy)) return { runner: task.runner, model: task.model || '', reason: '작업 지정' };
  if (!agy || base.runner !== 'claude' || task.difficulty === 'hard' || task.kind === 'screen') return base;
  if (task.difficulty === 'easy' || LIGHT_KINDS.includes(task.kind)) return { runner: 'antigravity', model: DEFAULT_MODEL, reason: task.difficulty === 'easy' ? '쉬운 작업' : '가벼운 작업' };
  // Antigravity 우선(2026-10-19 사용자: headroom 처럼 기본으로 먼저 쓴다) — hard·화면 판단이 아니면 보통 작업도
  // Antigravity 의 Claude Sonnet 으로 돌려 Claude Code 한도를 아낀다. 실패하면 withRoute 가 claude 로 한 번 대체한다.
  return { runner: 'antigravity', model: BUSY_MODEL, reason: limits?.fiveHour?.used > CLAUDE_BUSY ? `Claude 5시간 ${Math.round(limits.fiveHour.used * 100)}%` : 'Antigravity 우선' };
}

/** antigravity 실패 사유 — 이벤트·보드에 남길 짧은 말. */
export function failReason(r) {
  const s = `${r.text || ''} ${r.err || ''}`;
  if (/log(ged)? ?in|auth|credential|401/i.test(s)) return '로그인 필요';
  if (/quota|rate.?limit|429|exhaust|usage limit/i.test(s)) return '한도';
  if (/denied|not allowed|permission|reject|refus/i.test(s)) return '도구 거부';
  return r.code !== 0 ? `종료 코드 ${r.code}` : '실패';
}

/**
 * route 대로 도는 runner. getRunner 가 주입된다(index.mjs 의 routedRunner).
 * antigravity 가 실패하거나 빈 답이면(도구 거부는 어댑터가 실패로 준다. 시간 초과·예산 초과는 빼고 — 다시 돌려도 같다) 한 번 claude 로 다시 돌리고 onFallback(사유)을 부른다.
 * 결과에 fallback: { from, reason } 이 붙는다.
 */
export function withRoute(getRunner, route, { fallback = 'claude', onFallback } = {}) {
  const r = getRunner(route.runner);
  const exec = (o) => r.exec(route.model ? { ...o, model: route.model } : o);
  if (route.runner !== 'antigravity') return { ...r, route, exec };
  return {
    ...r,
    route,
    exec: async (o) => {
      const res = await exec(o);
      const empty = res.code === 0 && !res.isError && !String(res.text || '').trim();
      if ((res.code === 0 && !res.isError && !empty) || res.timedOut || res.stopped) return res;
      const reason = empty ? '빈 답' : failReason(res);
      onFallback?.({ from: 'antigravity', to: fallback, reason });
      // agy 대화 id 는 claude 가 모른다 → 대체 실행은 새 세션
      return { ...(await getRunner(fallback).exec({ ...o, resume: '' })), fallback: { from: 'antigravity', reason } };
    },
  };
}
