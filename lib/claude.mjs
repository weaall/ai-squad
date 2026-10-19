// Claude CLI 와 주고받는 글을 만들고 읽는 순수 함수.
import path from 'node:path';

/** 메인 오더에게 줄 멤버 요약 — frontmatter 와 역할 첫 줄만 (본문 전체는 넣지 않는다, 토큰 절약). */
export function memberDigest(m) {
  const role = (m.role || '').split('\n').find((l) => l.trim()) || '';
  return [
    `- id: ${m.id} / ${m.name} / runner=${m.runner}${m.model ? ' / model=' + m.model : ''}`,
    role && `  역할: ${role.trim()}`,
    m.owns.length && `  owns: ${m.owns.join(', ')}`,
    m.plugins.length && `  plugins: ${m.plugins.join(', ')}`,
    m.pending !== undefined && `  대기 작업: ${m.pending}`,
  ]
    .filter(Boolean)
    .join('\n');
}

export function buildOrderPrompt({ orderMd, squadMd, members, instruction }) {
  const workers = members.filter((m) => m.id !== 'order');
  return [
    '너는 AI Squad 의 메인 오더다. 아래 운영 규칙과 스쿼드 구성을 보고 지시를 멤버별 작업으로 나눈다.',
    '코드를 읽거나 고치지 말고 계획만 답한다.',
    '',
    '# 운영 규칙 (ORDER.md)',
    orderMd.trim(),
    '',
    '# 프로젝트 (SQUAD.md)',
    squadMd.trim(),
    '',
    '# 멤버 요약',
    workers.map(memberDigest).join('\n'),
    '',
    '# 지시',
    instruction.trim(),
    '',
    '# 답 형식',
    'JSON 배열 하나만 답한다. 설명·코드 울타리 없이.',
    '[{"member": "<멤버 id>", "title": "<작업 제목, 60자 이내>", "detail": "<무엇을·어디까지, 3줄 이내>", "why": "<이 멤버인 이유, 1줄>"}]',
    `member 는 다음 중 하나: ${workers.map((m) => m.id).join(', ')}`,
  ].join('\n');
}

/**
 * claude 답에서 계획 배열을 꺼낸다. `--output-format json` 의 {result} 감싸개, 코드 울타리, 앞뒤 말을 허용한다.
 * 모르는 멤버·빈 제목은 버린다.
 */
export function parsePlan(output, memberIds) {
  let text = String(output ?? '').trim();
  try {
    const j = JSON.parse(text);
    if (Array.isArray(j)) return cleanPlan(j, memberIds);
    if (j && typeof j.result === 'string') text = j.result;
  } catch {
    // 감싸개가 아니면 그대로 찾는다
  }
  const s = text.indexOf('[');
  const e = text.lastIndexOf(']');
  if (s < 0 || e <= s) throw new Error('계획 JSON 배열을 찾지 못했습니다');
  return cleanPlan(JSON.parse(text.slice(s, e + 1)), memberIds);
}

function cleanPlan(arr, memberIds) {
  if (!Array.isArray(arr)) throw new Error('계획이 배열이 아닙니다');
  return arr
    .filter((p) => p && memberIds.includes(p.member) && typeof p.title === 'string' && p.title.trim())
    .map((p) => ({
      member: p.member,
      title: p.title.trim().slice(0, 120),
      detail: String(p.detail ?? '').trim().slice(0, 2000),
      why: String(p.why ?? '').trim().slice(0, 300),
    }));
}

export function runRules({ squadRoot, project, member }) {
  const cli = `node "${path.join(squadRoot, 'bin', 'squad.mjs')}"`;
  return [
    '# 실행 규칙',
    `- 자기 owns 밖 파일은 고치지 않는다. 필요하면 \`${cli} msg ${project} ${member} <멤버id> "<무엇이 필요한지>" --kind handoff\` 로 그 멤버에게 넘긴다.`,
    `- 끝나면 \`.squad/members/${member}/NOTES.md\` 의 인계 메모를 3줄 이내로 갱신한다.`,
    '- 커밋은 그 저장소 CLAUDE.md 규칙대로 한다. push 는 하지 않는다(사람·오더가 정한다).',
    '- 비밀값(.env, 토큰, 키)은 읽거나 출력하지 않는다.',
    '- 마지막 답은 한국어 3줄 이내 결과 요약으로 끝낸다.',
  ].join('\n');
}

export function buildRunPrompt({ memberMd, notesMd, task, squadRoot, project, member }) {
  return [
    `너는 AI Squad 의 멤버 "${member}" 다. 아래 멤버 문서가 너의 역할과 경계다.`,
    '',
    '# 멤버 문서 (MEMBER.md)',
    memberMd.trim(),
    '',
    '# 작업 메모 (NOTES.md)',
    (notesMd || '(없음)').trim(),
    '',
    '# 이번 작업',
    `id: ${task.id}`,
    `제목: ${task.title}`,
    task.detail ? `내용: ${task.detail}` : '',
    '',
    runRules({ squadRoot, project, member }),
  ]
    .filter((l) => l !== '')
    .join('\n');
}

const PATH_KEYS = ['file_path', 'notebook_path', 'path'];

/** 도구 입력에서 보드에 올릴 경로만 꺼낸다(내용·명령은 올리지 않는다). 프로젝트 안이면 상대 경로로. */
export function toolPath(input, projectPath) {
  if (!input || typeof input !== 'object') return '';
  const key = PATH_KEYS.find((k) => typeof input[k] === 'string' && input[k]);
  let p = key ? input[key] : typeof input.pattern === 'string' ? input.pattern : '';
  if (!p) return '';
  if (projectPath && path.isAbsolute(p)) {
    const rel = path.relative(projectPath, p);
    if (!rel.startsWith('..') && !path.isAbsolute(rel)) p = rel;
  }
  return p.replace(/\\/g, '/').slice(0, 200);
}

/**
 * stream-json 한 줄을 읽어 { tools: [{tool, path}], result?: {text, isError} } 로 바꾼다. 모르는 줄은 null.
 */
export function readStreamLine(line, projectPath) {
  let j;
  try {
    j = JSON.parse(line);
  } catch {
    return null;
  }
  if (j.type === 'assistant' && Array.isArray(j.message?.content)) {
    const tools = j.message.content
      .filter((c) => c.type === 'tool_use')
      .map((c) => ({ tool: String(c.name || '').slice(0, 60), path: toolPath(c.input, projectPath) }));
    return tools.length ? { tools } : null;
  }
  if (j.type === 'result') {
    return { tools: [], result: { text: String(j.result ?? '').trim(), isError: Boolean(j.is_error) } };
  }
  return null;
}
