// Claude CLI 와 주고받는 글을 만들고 읽는 순수 함수.
import path from 'node:path';
import { STATUS_LABEL } from './state.mjs';
import { parseFrontmatter } from './md.mjs';
import { readLimit } from './limits.mjs';
import { DIFFICULTIES } from './validate.mjs';

export const DIGEST_LINE_MAX = 160;
export const DIGEST_MAX = 520;
export const SQUAD_DIGEST_MAX = 4000;

const firstLine = (s) => (String(s || '').split('\n').find((l) => l.trim()) || '').trim();
const clipText = (s, n) => ([...s].length > n ? [...s].slice(0, n - 1).join('') + '…' : s);

/**
 * 메인 오더에게 줄 멤버 요약 — 멤버 문서 전체가 아니라 짧은 요약만 넣는다(토큰 절약).
 * 상태·지금 작업·대기 수·최근 인계 1줄·주의(멈춤, 답 없는 인계). 줄마다 DIGEST_LINE_MAX, 전체 DIGEST_MAX 자 이하.
 */
export function memberDigest(m) {
  const head = [STATUS_LABEL[m.status] && `상태: ${STATUS_LABEL[m.status]}`, m.current && `지금: ${firstLine(m.current)}`, m.pending !== undefined && `대기 작업: ${m.pending}`]
    .filter(Boolean)
    .join(' · ');
  const warn = [m.stalled && '멈춤', m.unanswered && `답 없는 인계 ${m.unanswered}`].filter(Boolean).join(' · ');
  const lines = [
    `- id: ${m.id} / ${m.name} / runner=${m.runner}${m.model ? ' / model=' + m.model : ''}`,
    head && `  ${head}`,
    firstLine(m.role) && `  역할: ${firstLine(m.role)}`,
    m.owns?.length && `  owns: ${m.owns.join(', ')}`,
    m.plugins?.length && `  plugins: ${m.plugins.join(', ')}`,
    firstLine(m.handoff) && `  최근 인계: ${firstLine(m.handoff)}`,
    warn && `  주의: ${warn}`,
  ]
    .filter(Boolean)
    .map((l) => clipText(l, DIGEST_LINE_MAX));
  return clipText(lines.join('\n'), DIGEST_MAX);
}

/** 멤버 요약 묶음. 전체가 SQUAD_DIGEST_MAX 를 넘으면 뒤 멤버는 "n명 더"로 줄인다. */
export function squadDigest(members, max = SQUAD_DIGEST_MAX) {
  const out = [];
  let len = 0;
  for (let i = 0; i < members.length; i++) {
    const d = memberDigest(members[i]);
    if (len + d.length + 1 > max - 210) { // 끝의 "n명 더" 줄(200자 이하) 자리를 남긴다
      out.push(`… (멤버 ${members.length - i}명 더 — id: ${members.slice(i).map((m) => m.id).join(', ')})`.slice(0, 200));
      break;
    }
    out.push(d);
    len += d.length + 1;
  }
  return out.join('\n');
}

export function buildOrderPrompt({ orderMd, squadMd, members, instruction, limitHint = '' }) {
  const workers = members.filter((m) => m.id !== 'order');
  return [
    '너는 AI Squad 의 메인 오더다. 아래 운영 규칙과 스쿼드 구성을 보고 지시를 멤버별 작업으로 나누고 실행 순서를 정한다.',
    '코드를 읽거나 고치지 말고 계획만 답한다. 멈춘 멤버·답 없는 인계가 있으면 그것부터 풀 작업을 앞 순서에 둔다.',
    '',
    '# 운영 규칙 (ORDER.md)',
    orderMd.trim(),
    '',
    '# 프로젝트 (SQUAD.md)',
    squadMd.trim(),
    '',
    '# 멤버 요약',
    squadDigest(workers),
    '',
    ...(limitHint ? ['# 사용 한도', limitHint, ''] : []),
    '# 지시',
    instruction.trim(),
    '',
    '# 답 형식',
    'JSON 배열 하나만 답한다. 설명·코드 울타리 없이.',
    '[{"key": "<이 계획 안에서만 쓰는 짧은 이름, 예: k1>", "member": "<멤버 id>", "title": "<작업 제목, 60자 이내>", "detail": "<무엇을·어디까지, 3줄 이내>", "why": "<이 멤버인 이유, 1줄>", "step": <실행 순서 1부터. 같은 숫자는 동시에 해도 되고, 앞 결과가 필요하면 큰 숫자>, "dependsOn": ["<먼저 끝나야 하는 작업의 key>"], "difficulty": "<easy|normal|hard — easy 는 작은 모델로 돈다>", "needsConfirm": <사람 확인이 먼저 필요하면 true, 아니면 false>, "reason": "<needsConfirm 이 true 인 이유, 1줄>"}]',
    'dependsOn 은 그 결과가 꼭 있어야 시작할 수 있을 때만 적는다(없으면 빈 배열). 고리(서로 기다림)를 만들지 않는다.',
    '작업 하나는 파일 5개·실행 40턴 안에 끝날 크기로 쪼갠다. 같은 멤버의 아주 작은 작업 여러 개는 하나로 묶는다.',
    'needsConfirm 은 push·배포·DB 변경·외부 발송·삭제가 들어가거나, 지시가 모호해 사람이 골라야 할 때 true 로 둔다.',
    `member 는 다음 중 하나: ${workers.map((m) => m.id).join(', ')}`,
  ].join('\n');
}

/**
 * claude 답에서 계획 배열을 꺼낸다. `--output-format json` 의 {result} 감싸개, 코드 울타리, 앞뒤 말을 허용한다.
 * 모르는 멤버·빈 제목은 버린다.
 */
export function parsePlan(output, memberIds) {
  let text = String(output ?? '').trim();
  // headroom wrap 은 답 앞에 안내 글을 찍는다 → 줄마다 보며 {result} 감싸개를 찾는다(2026-10-19 빈 계획 원인)
  const lines = [text, ...text.split(/\r?\n/).reverse()];
  for (const line of lines) {
    const t = line.trim();
    if (!t.startsWith('{') && !t.startsWith('[')) continue;
    try {
      const j = JSON.parse(t);
      if (Array.isArray(j) && j.some((x) => x && typeof x === 'object' && 'member' in x)) return cleanPlan(j, memberIds);
      if (j && typeof j.result === 'string') {
        text = j.result;
        break;
      }
    } catch {
      // 다음 줄을 본다
    }
  }
  // 첫 '[' 부터 괄호 짝을 맞춰 배열 하나만 잘라 낸다 — 뒤에 설명·'[1]' 같은 글이 붙어도 깨지지 않게(2026-10-19 실사용 오류)
  for (let s = text.indexOf('['); s >= 0; s = text.indexOf('[', s + 1)) {
    const e = matchBracket(text, s);
    if (e < 0) continue;
    try {
      const arr = JSON.parse(text.slice(s, e + 1));
      if (Array.isArray(arr) && arr.some((x) => x && typeof x === 'object' && 'member' in x)) return cleanPlan(arr, memberIds);
    } catch {
      // 다음 '[' 를 본다
    }
  }
  throw new Error('계획 JSON 배열을 찾지 못했습니다');
}

/** text[s] 가 '[' 일 때 짝이 맞는 ']' 위치. 문자열 안의 괄호는 센다에서 뺀다. 없으면 -1. */
export function matchBracket(text, s) {
  let depth = 0;
  let inStr = false;
  for (let i = s; i < text.length; i++) {
    const c = text[i];
    if (inStr) {
      if (c === '\\') i++;
      else if (c === '"') inStr = false;
    } else if (c === '"') inStr = true;
    else if (c === '[' || c === '{') depth++;
    else if (c === ']' || c === '}') {
      depth--;
      if (depth === 0) return c === ']' ? i : -1;
    }
  }
  return -1;
}

/** 실행 순서: 1~20 정수, 아니면 1. */
export const toStep = (v) => (Number.isInteger(Number(v)) && Number(v) >= 1 ? Math.min(20, Number(v)) : 1);

const KEY_RE = /^[\w-]{1,20}$/;

/** 계획 항목의 key·dependsOn 정리: key 가 없거나 겹치면 k<번호>, dependsOn 은 같은 계획 안의 다른 key 만. */
export function cleanDeps(items) {
  const used = new Set();
  const keyed = items.map((p, i) => {
    let key = typeof p.key === 'string' && KEY_RE.test(p.key) && !used.has(p.key) ? p.key : `k${i + 1}`;
    while (used.has(key)) key += 'x';
    used.add(key);
    return { ...p, key };
  });
  return keyed.map((p) => ({
    ...p,
    dependsOn: [...new Set((Array.isArray(p.dependsOn) ? p.dependsOn : []).map(String))].filter((k) => k !== p.key && used.has(k)).slice(0, 10),
  }));
}

function cleanPlan(arr, memberIds) {
  if (!Array.isArray(arr)) throw new Error('계획이 배열이 아닙니다');
  return cleanDeps(
    arr
      .filter((p) => p && memberIds.includes(p.member) && typeof p.title === 'string' && p.title.trim())
      .map((p) => ({
        key: p.key,
        member: p.member,
        title: p.title.trim().slice(0, 120),
        detail: String(p.detail ?? '').trim().slice(0, 2000),
        why: String(p.why ?? '').trim().slice(0, 300),
        step: toStep(p.step),
        dependsOn: p.dependsOn,
        ...(DIFFICULTIES.includes(p.difficulty) ? { difficulty: p.difficulty } : {}),
        ...(p.needsConfirm === true ? { needsConfirm: true, reason: String(p.reason ?? '').trim().slice(0, 300) } : {}),
      })),
  );
}

export function runRules({ squadRoot, project, member }) {
  const cli = `node "${path.join(squadRoot, 'bin', 'squad.mjs')}"`;
  return [
    '# 실행 규칙',
    `- 자기 owns 밖 파일은 고치지 않는다. 필요하면 \`${cli} msg ${project} ${member} <멤버id> "<무엇이 필요한지>" --kind handoff\` 로 그 멤버에게 넘긴다.`,
    `- 끝나면 \`.squad/members/${member}/NOTES.md\` 의 인계 메모를 3줄 이내로 갱신한다.`,
    '- 커밋은 그 저장소 CLAUDE.md 규칙대로 한다. push 는 하지 않는다(사람·오더가 정한다).',
    `- 위험 행위(push, 배포, DB 마이그레이션, 외부 발송, 삭제)는 직접 하지 말고 승인을 요청한다: \`${cli} approve request ${project} ${member} <push|deploy|migrate|send|delete> "<무엇을>" --reason "<왜>" --scope "<저장소·경로>" --task <작업id>\` — 승인 결과는 대화(answer)로 온다.`,
    '- 승인된 행위는 이번 작업 내용의 [승인됨] 절에 적힌 명령만 실행할 수 있다(이번 실행에만 허용 도구에 더해진다). [거절됨] 절이 있으면 그 행위 없이 대안을 찾는다.',
    '- 승인 요청 시 details·files·diff(또는 SQL)·commands·rollback 을 채운다: --details-file <설명.md> --files <경로,경로> --diff-file <diff 나 SQL 파일, 20KB 이하> --cmd "<실제로 실행할 명령>" --risk <낮음|보통|높음> --rollback "<되돌리는 방법>". 사람이 그것을 보고 결정한다.',
    `- 화면을 바꿨으면 \`${cli} capture ${project} <주소> --member ${member} --task <작업id>\` 로 캡처를 남길 수 있다.`,
    `- 지시가 모호해 사람 답이 있어야 이어갈 수 있으면 추측하지 말고 입력을 요청한 뒤 멈춘다: \`${cli} ask ${project} ${member} form "<무엇을 묻는지>" --task <작업id> --text "<왜 필요한지>" --field "answer*|답"\` — 답은 대화(answer)로 온다.`,
    '- 보드 서버(squad board·server/index.mjs)를 직접 띄우지 않는다 — 떠 있는 보드가 코드 변경을 감지해 스스로 다시 띄운다.',
    '- 비밀값(.env, 토큰, 키)은 읽거나 출력하지 않는다.',
    '- 마지막 답(최종 보고)은 한국어 요약 8줄 이내로 끝낸다.',
  ].join('\n');
}

/**
 * 멤버 실행 프롬프트. MEMBER.md 는 frontmatter 를 빼고 본문만 넣고, 경계와 도구는 따로 짧게 적는다.
 * 플러그인·스킬·MCP 는 켜진 것(member.plugins)만 넣는다 — 꺼진 것은 토큰을 쓰지 않게 뺀다.
 */
export function buildRunPrompt({ memberMd, notesMd, task, squadRoot, project, member, owns = [], reads = [], tools = [], plugins = [], map = '' }) {
  const body = parseFrontmatter(memberMd).body.trim();
  return [
    `너는 AI Squad 의 멤버 "${member}" 다. 아래 멤버 문서가 너의 역할과 경계다.`,
    '',
    '# 멤버 문서 (MEMBER.md 본문)',
    body,
    '',
    '# 경계',
    `- 고칠 수 있는 경로(owns): ${owns.join(', ') || '(없음)'}`,
    reads.length ? `- 참고만 하는 경로(reads): ${reads.join(', ')}` : '',
    '',
    '# 사용할 수 있는 도구',
    `- 도구: ${(tools.length ? tools : ['Read', 'Edit', 'Write', 'Glob', 'Grep']).join(', ')}`,
    `- 플러그인·스킬·MCP: ${plugins.join(', ') || '(없음)'}`,
    '',
    '# 작업 메모 (NOTES.md)',
    (notesMd || '(없음)').trim(),
    '',
    ...(map ? ['## 파일 지도', map, ''] : []),
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
 * stream-json 한 줄을 읽어 { tools: [{tool, path}], result?: {text, isError}, limit? } 로 바꾼다(limit: lib/limits.mjs readLimit). 모르는 줄은 null.
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
    // 실행 중 예산 확인용: 메시지마다 붙는 usage (같은 메시지 id 가 여러 줄로 올 수 있다)
    const usage = readUsage(j.message);
    if (!tools.length && !usage) return null;
    return { tools, ...(usage ? { usage, msgId: String(j.message.id || '') } : {}) };
  }
  if (j.type === 'rate_limit_event') {
    const limit = readLimit(j);
    return limit ? { tools: [], limit } : null;
  }
  if (j.type === 'result') {
    return { tools: [], result: { text: String(j.result ?? '').trim(), isError: Boolean(j.is_error), usage: readUsage(j) } };
  }
  return null;
}

/**
 * claude 의 result(마지막 줄 또는 --output-format json 한 덩어리)에서 사용량을 꺼낸다. 없으면 null.
 * { input, output, cacheRead, cacheWrite, costUsd? }
 */
export function readUsage(j) {
  const u = j?.usage;
  if (!u || typeof u !== 'object') return null;
  const n = (v) => (Number.isFinite(v) && v >= 0 ? Math.round(v) : 0);
  const out = { input: n(u.input_tokens), output: n(u.output_tokens), cacheRead: n(u.cache_read_input_tokens), cacheWrite: n(u.cache_creation_input_tokens) };
  const cost = j.total_cost_usd ?? j.cost_usd;
  if (Number.isFinite(cost) && cost >= 0) out.costUsd = Math.round(cost * 1e6) / 1e6;
  return out;
}
