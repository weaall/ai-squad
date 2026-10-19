// 계획 자동 배정 판단 — 사람 확인이 먼저 필요한 계획인지 본다. 오더 계획(parsePlan 결과)과 멤버 owns, config.order 만 쓴다.

// push·배포·DB·외부 발송·삭제. 영어는 단어 경계로(deleteTask·sendMessage 같은 식별자는 빼려고).
const RISKY = /\b(?:push|deploy|db|migrat\w*|drop|send|delete)\b|배포|마이그레이션|데이터베이스|발송|삭제/i;

/** glob 의 와일드카드 앞 고정 부분. */
const fixedPart = (g) => String(g).replace(/\\/g, '/').replace(/^\.\//, '').split(/[*?]/)[0].toLowerCase();

/**
 * 두 owns 목록이 같은 경로를 덮을 수 있는지.
 * ponytail: 고정 부분이 서로의 앞부분이면 겹친다고 본다 — `*.md` 처럼 앞이 비면 다 겹침(확인 쪽으로 틀림). 오탐이 잦으면 glob 교집합으로.
 */
export function ownsOverlap(a = [], b = []) {
  return a.some((x) => b.some((y) => {
    const p = fixedPart(x);
    const q = fixedPart(y);
    return p.startsWith(q) || q.startsWith(p);
  }));
}

/**
 * 계획을 바로 배정해도 되는지 판단한다. → { needsConfirm, reasons: [한국어 1줄] }
 * - config.order.autoAssign 이 false 면 늘 확인
 * - 항목 제목·내용에 push·배포·DB·외부 발송·삭제
 * - 같은 step 의 서로 다른 멤버 owns 가 겹침
 * - 오더가 계획 항목에 needsConfirm 을 단 경우(reason 그대로)
 */
export function planNeedsConfirm({ plan = [], members = [], config = {} }) {
  const reasons = [];
  if (config.order?.autoAssign === false) reasons.push('자동 배정이 꺼져 있습니다 (order.autoAssign)');
  for (const p of plan) {
    if (RISKY.test(`${p.title} ${p.detail || ''}`)) reasons.push(`위험 작업 포함: ${p.member} · ${p.title}`);
    if (p.needsConfirm) reasons.push(`오더 판단: ${p.member} · ${p.reason || p.title}`);
  }
  const ownsOf = (id) => members.find((m) => m.id === id)?.owns || [];
  for (let i = 0; i < plan.length; i++) {
    for (let j = i + 1; j < plan.length; j++) {
      const [a, b] = [plan[i], plan[j]];
      if ((a.step || 1) === (b.step || 1) && a.member !== b.member && ownsOverlap(ownsOf(a.member), ownsOf(b.member))) {
        reasons.push(`같은 step ${a.step || 1} 에서 owns 겹침: ${a.member} · ${b.member}`);
      }
    }
  }
  const uniq = [...new Set(reasons)];
  return { needsConfirm: uniq.length > 0, reasons: uniq };
}
