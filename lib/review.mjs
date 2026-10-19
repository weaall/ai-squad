// 검수(review) — 작업이 끝나면 검수 멤버가 git diff 요약과 작업 요약만 읽고 통과/반려를 낸다. 여기는 순수 함수만.

/** 그 작업의 검수 멤버: MEMBER.md reviewer, 없으면 config.review.default. 자기 자신·없는 멤버면 ''. */
export function reviewerFor(member, review, memberIds) {
  const id = member?.reviewer || review?.default || '';
  return id && id !== member?.id && memberIds.includes(id) ? id : '';
}

/**
 * `git diff --numstat` 줄들 → [{path, add, del}]. 바이너리는 `-` 라 0 으로 센다.
 * prefix 는 하위 저장소 이름(예: `qugo_fe_web/`).
 */
export function parseNumstat(text, prefix = '') {
  const out = [];
  for (const line of String(text || '').split(/\r?\n/)) {
    const m = line.match(/^(\d+|-)\t(\d+|-)\t(.+)$/);
    if (!m) continue;
    // 이름 바꾸기 `a => b` 나 `{a => b}` 는 새 이름만
    const p = m[3].replace(/\{[^}]* => ([^}]*)\}/, '$1').replace(/^.* => /, '');
    out.push({ path: prefix + p, add: m[1] === '-' ? 0 : Number(m[1]), del: m[2] === '-' ? 0 : Number(m[2]) });
  }
  return out;
}

/** 파일 목록과 줄 수 요약 — 상한(maxFiles) 넘는 파일은 "외 n개"로. 검수 프롬프트에 그대로 들어간다. */
export function summarizeDiff(stats, maxFiles = 30) {
  if (!stats?.length) return '(바뀐 파일 없음)';
  const sorted = [...stats].sort((a, b) => b.add + b.del - (a.add + a.del));
  const add = stats.reduce((n, s) => n + s.add, 0), del = stats.reduce((n, s) => n + s.del, 0);
  const lines = sorted.slice(0, maxFiles).map((s) => `${s.path} +${s.add} -${s.del}`.slice(0, 220));
  if (stats.length > maxFiles) lines.push(`외 ${stats.length - maxFiles}개 파일`);
  return [`파일 ${stats.length}개, +${add} -${del}`, ...lines].join('\n');
}

export function buildReviewPrompt({ reviewer, task, member, diff }) {
  return [
    `너는 AI Squad 의 검수 멤버 "${reviewer}" 다. 파일을 열지 말고 아래 요약만 보고 판단한다.`,
    '',
    '# 작업',
    `id: ${task.id}`,
    `담당: ${member}`,
    `제목: ${task.title}`,
    task.detail ? `내용: ${task.detail}` : '',
    '',
    '# 담당 멤버의 결과 요약',
    (task.summary || '(없음)').slice(0, 1500),
    '',
    '# 바뀐 파일 (git diff 요약)',
    diff,
    '',
    '# 답 형식',
    'JSON 객체 하나만 답한다. 설명·코드 울타리 없이.',
    '{"verdict": "pass" 또는 "reject", "note": "<반려면 무엇을 고칠지, 통과면 한 줄 소감. 3줄 이내>"}',
    '작업 내용과 바뀐 파일이 맞지 않거나, 요약에 실패·미완성이 보이면 reject.',
  ]
    .filter((l) => l !== '')
    .join('\n');
}

/** 검수 답 → {pass, note}. JSON 을 못 찾으면 반려로 본다(사람이 다시 보게). */
export function parseVerdict(text) {
  let s = String(text ?? '').trim();
  try {
    const j = JSON.parse(s);
    if (j && typeof j.result === 'string') s = j.result;
  } catch {
    // 감싸개가 아니면 그대로
  }
  const a = s.indexOf('{'), b = s.lastIndexOf('}');
  if (a >= 0 && b > a) {
    try {
      const j = JSON.parse(s.slice(a, b + 1));
      const v = String(j.verdict || '').toLowerCase();
      if (v === 'pass' || v === 'reject') return { pass: v === 'pass', note: String(j.note || '').trim().slice(0, 600) };
    } catch {
      // 아래로
    }
  }
  return { pass: false, note: `검수 답을 읽지 못했습니다: ${s.slice(0, 200)}` };
}
