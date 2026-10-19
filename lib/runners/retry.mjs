// 실패 시 1회 재시도 — run·run-queue 의 --retry. 시간 초과·잠금 충돌·예산 초과·경로 밖 수정은 다시 돌려도 같으므로 재시도하지 않는다.

/** 재시도할 만한 실패인지: 실패했고, 위 네 경우가 아닐 때만. */
export const retryable = (res) => Boolean(res) && !res.ok && !res.locked && !res.timedOut && !res.stopped && !res.outside?.length;

/** fn 을 돌리고, retry 가 켜져 있고 재시도할 만한 실패면 한 번만 더 돌린다. onRetry(첫 결과)로 알린다. */
export async function retryOnce(fn, { retry = false, onRetry = () => {} } = {}) {
  const res = await fn();
  if (!retry || !retryable(res)) return res;
  onRetry(res);
  return fn();
}
