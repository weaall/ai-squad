// 작업 의존 관계와 대기열 — 순수 함수. run-queue 와 보드가 같이 쓴다.

/** 아직 끝나지 않은 선행 작업 id. 없는 id(지워졌거나 잘못 적힌 것)는 기다리지 않는다. */
export function waitingOn(task, byId) {
  return (task.dependsOn || []).filter((id) => byId.has(id) && byId.get(id).status !== 'done');
}

/** 의존 관계에 고리가 있으면 그 고리의 id 하나, 없으면 null. deps: Map(id → [id]) */
export function findCycle(deps) {
  const state = new Map(); // 1: 보는 중, 2: 끝
  const visit = (id) => {
    if (state.get(id) === 2) return null;
    if (state.get(id) === 1) return id;
    state.set(id, 1);
    for (const d of deps.get(id) || []) {
      if (!deps.has(d)) continue;
      const c = visit(d);
      if (c) return c;
    }
    state.set(id, 2);
    return null;
  };
  for (const id of deps.keys()) {
    const c = visit(id);
    if (c) return c;
  }
  return null;
}

/** glob 의 와일드카드 앞 고정 부분을 폴더 단위로. `qugo_fe_web/app/**` → ['qugo_fe_web', 'app'] */
function staticParts(glob) {
  const parts = String(glob).replace(/\\/g, '/').replace(/^\.\//, '').split('/').filter(Boolean);
  const i = parts.findIndex((p) => /[*?[]/.test(p));
  return { parts: i < 0 ? parts : parts.slice(0, i), wild: i >= 0 };
}

/**
 * 두 담당 경로 목록이 겹칠 수 있는지. 한쪽 고정 부분이 다른 쪽 고정 부분의 앞부분이면(와일드카드가 있을 때) 겹친다고 본다.
 * ponytail: 보수적인 근사 — `a/*.ts` 와 `a/*.md` 도 겹친다고 본다. 동시 실행이 아쉬우면 정규식 교집합으로.
 */
export function ownsOverlap(a = [], b = []) {
  const ci = (s) => (process.platform === 'win32' ? s.toLowerCase() : s);
  for (const x of a) {
    for (const y of b) {
      const p = staticParts(ci(x)), q = staticParts(ci(y));
      const n = Math.min(p.parts.length, q.parts.length);
      let same = true;
      for (let i = 0; i < n; i++) if (p.parts[i] !== q.parts[i]) same = false;
      if (!same) continue;
      if (p.parts.length === q.parts.length) return true;
      // 짧은 쪽이 와일드카드로 끝나야 긴 쪽을 품는다
      if ((p.parts.length < q.parts.length ? p : q).wild) return true;
    }
  }
  return false;
}

const byStep = (a, b) => (a.step || 1) - (b.step || 1) || String(a.createdAt || '').localeCompare(String(b.createdAt || ''));

/**
 * 지금 시작할 일 고르기.
 * - 검수(review) 작업은 검수 멤버가, todo 작업은 선행이 모두 끝난 것만 담당 멤버가 한다.
 * - 한 멤버는 한 번에 하나. 담당 경로(owns)가 지금 도는 멤버와 겹치면 기다린다(검수는 파일을 고치지 않아 겹침을 보지 않는다).
 * - runner=external 이나 없는 멤버는 건너뛴다. 모두 합쳐 max 개까지.
 * running: [{member}] 지금 도는 것. → [{kind: 'run'|'review', task, member}]
 */
export function pickRunnable({ tasks, members, running = [], max = 2, reviewerOf = () => '' }) {
  const byId = new Map(tasks.map((t) => [t.id, t]));
  const mem = new Map(members.map((m) => [m.id, m]));
  const busy = new Set(running.map((r) => r.member));
  const editing = running.filter((r) => r.kind !== 'review').map((r) => mem.get(r.member)?.owns || []);
  const out = [];
  const room = () => running.length + out.length < max;
  for (const t of tasks.filter((x) => x.status === 'review').sort(byStep)) {
    if (!room()) return out;
    const rid = t.reviewer || reviewerOf(t);
    const r = mem.get(rid);
    if (!r || r.runner === 'external' || busy.has(rid)) continue;
    busy.add(rid);
    out.push({ kind: 'review', task: t, member: rid });
  }
  for (const t of tasks.filter((x) => x.status === 'todo').sort(byStep)) {
    if (!room()) break;
    const m = mem.get(t.member);
    if (!m || m.id === 'order' || m.runner === 'external' || busy.has(m.id)) continue;
    if (waitingOn(t, byId).length) continue;
    if (editing.some((o) => ownsOverlap(o, m.owns))) continue;
    busy.add(m.id);
    editing.push(m.owns);
    out.push({ kind: 'run', task: t, member: m.id });
  }
  return out;
}
