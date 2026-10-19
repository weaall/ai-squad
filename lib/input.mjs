// 입력 요청 — 멤버가 사람의 답이 있어야 이어갈 수 있을 때 작업을 '입력 대기'(status 'input')로 멈추고, 답이 오면 작업에 붙여 todo 로 돌린다. 순수 함수만.
// 요청 종류:
//   preview {to?, subject?, body}            발송 미리보기 → 답 {approve: true|false, note?}
//   choice  {options: [{id, label, capture}]} 디자인안 선택(capture 는 캡처 파일 이름) → 답 {choice: <option id>, note?}
//   fields  {fields: [{name, label, required?}]} 필수 정보 칸 → 답 {values: {<name>: 문자열}, note?}
// 작업에 붙는 모양: 대기 중 task.input = {at, from, kind, title, ...종류별}; 답하면 task.inputs 끝에 {...요청, answer, answeredAt, answeredBy} 를 붙이고 task.input 은 지운다.
import { CAPTURE_RE } from './capture.mjs';

export const INPUT_STATUS = 'input';
export const INPUT_KINDS = { preview: '발송 미리보기', choice: '디자인안 선택', fields: '필수 정보' };
export const INPUT_LIMITS = { title: 120, text: 1000, to: 300, subject: 200, body: 8000, options: 8, label: 120, fields: 12, name: 40, value: 1000, note: 500 };

// 비밀값 칸은 받지 않는다 — 키·토큰은 `squad auth set` 으로만 넣는다.
const SECRET_WORD = /pass(word|wd|phrase|code)|secret|token|api[\s_-]?key|access[\s_-]?key|private[\s_-]?key|credential|\b(otp|pin|cvc|cvv)\b|비밀|비번|암호|토큰|인증\s*(키|코드|번호)|시크릿|api\s*키|주민(등록)?\s*번호|카드\s*번호|계좌\s*비밀/i;
const SECRET_VALUE = /\b(sk-[A-Za-z0-9_-]{16,}|gh[pousr]_[A-Za-z0-9]{20,}|AKIA[0-9A-Z]{16}|xox[abpr]-[A-Za-z0-9-]{10,}|eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,})|-----BEGIN [A-Z ]*PRIVATE KEY-----/;
export const looksSecret = (s) => SECRET_WORD.test(String(s ?? ''));
export const looksSecretValue = (s) => SECRET_VALUE.test(String(s ?? ''));

const NAME_RE = /^[a-zA-Z][a-zA-Z0-9_-]{0,39}$/;
const OPT_ID_RE = /^[a-z0-9-]{1,40}$/;

function text(v, max, label, required) {
  if (v === undefined || v === null || v === '') return required ? `${label}을(를) 입력하세요` : null;
  if (typeof v !== 'string') return `${label}: 문자열이어야 합니다`;
  if (v.length > max) return `${label}: ${max}자 이하로 써 주세요`;
  return null;
}
const trim = (v) => (typeof v === 'string' ? v.replace(/\r\n/g, '\n').trim() : '');

/** 입력 요청 검증 → 저장할 요청 객체 | { error }. memberIds: from 확인용. */
export function validateInputRequest(input, memberIds) {
  const r = input || {};
  const L = INPUT_LIMITS;
  if (!memberIds.includes(r.from)) return { error: '요청한 멤버가 없습니다' };
  if (!Object.hasOwn(INPUT_KINDS, r.kind)) return { error: `요청 종류는 ${Object.keys(INPUT_KINDS).join('|')} 중 하나여야 합니다` };
  const e = text(r.title, L.title, '제목', true) || text(r.text, L.text, '설명');
  if (e) return { error: e };
  const out = { from: r.from, kind: r.kind, title: trim(r.title), ...(trim(r.text) ? { text: trim(r.text) } : {}) };

  if (r.kind === 'preview') {
    const p = r.preview || {};
    const pe = text(p.to, L.to, '받는 곳') || text(p.subject, L.subject, '제목') || text(p.body, L.body, '본문', true);
    if (pe) return { error: pe };
    if (looksSecretValue(p.body) || looksSecretValue(p.subject)) return { error: '미리보기에 비밀값으로 보이는 내용이 있습니다' };
    out.preview = { ...(trim(p.to) ? { to: trim(p.to) } : {}), ...(trim(p.subject) ? { subject: trim(p.subject) } : {}), body: trim(p.body) };
  } else if (r.kind === 'choice') {
    const opts = r.options;
    if (!Array.isArray(opts) || opts.length < 2 || opts.length > L.options) return { error: `고를 안은 2~${L.options}개여야 합니다` };
    const ids = new Set();
    for (const o of opts) {
      if (!o || !OPT_ID_RE.test(o.id) || ids.has(o.id)) return { error: '안 id 는 겹치지 않는 영문 소문자·숫자·- 여야 합니다' };
      ids.add(o.id);
      const oe = text(o.label, L.label, '안 이름', true);
      if (oe) return { error: oe };
      if (typeof o.capture !== 'string' || !CAPTURE_RE.test(o.capture)) return { error: `안 "${o.id}": 캡처 파일 이름이 잘못됐습니다` };
    }
    out.options = opts.map((o) => ({ id: o.id, label: trim(o.label), capture: o.capture }));
  } else {
    const fs = r.fields;
    if (!Array.isArray(fs) || !fs.length || fs.length > L.fields) return { error: `칸은 1~${L.fields}개여야 합니다` };
    const names = new Set();
    for (const f of fs) {
      if (!f || !NAME_RE.test(f.name) || names.has(f.name)) return { error: '칸 이름은 겹치지 않는 영문으로 시작하는 40자 이하여야 합니다' };
      names.add(f.name);
      const fe = text(f.label, L.label, '칸 설명', true);
      if (fe) return { error: fe };
      if (looksSecret(f.name) || looksSecret(f.label)) return { error: `"${f.label}" 칸은 비밀값으로 보여 받을 수 없습니다. 키·토큰은 squad auth set 으로 넣어 주세요` };
    }
    out.fields = fs.map((f) => ({ name: f.name, label: trim(f.label), ...(f.required ? { required: true } : {}) }));
  }
  return out;
}

/** 답 검증 → { answer } | { error }. request 는 task.input. */
export function validateInputAnswer(request, input) {
  const a = input || {};
  const L = INPUT_LIMITS;
  const ne = text(a.note, L.note, '메모');
  if (ne) return { error: ne };
  if (looksSecretValue(a.note)) return { error: '메모에 비밀값으로 보이는 내용이 있습니다' };
  const note = trim(a.note) ? { note: trim(a.note) } : {};
  if (request.kind === 'preview') {
    if (typeof a.approve !== 'boolean') return { error: '보낼지(approve) 정해 주세요' };
    return { answer: { approve: a.approve, ...note } };
  }
  if (request.kind === 'choice') {
    if (!request.options.some((o) => o.id === a.choice)) return { error: '고른 안이 없습니다' };
    return { answer: { choice: a.choice, ...note } };
  }
  const v = a.values && typeof a.values === 'object' && !Array.isArray(a.values) ? a.values : {};
  const values = {};
  for (const f of request.fields) {
    const raw = v[f.name];
    const fe = text(raw, L.value, f.label, f.required);
    if (fe) return { error: fe };
    if (looksSecretValue(raw)) return { error: `"${f.label}" 에 비밀값으로 보이는 내용이 있습니다` };
    if (trim(raw)) values[f.name] = trim(raw);
  }
  return { answer: { values, ...note } };
}

/** 작업을 입력 대기로 멈춘다 → 새 작업 객체. 끝났거나 이미 기다리는 작업은 throw. */
export function requestInput(task, request, at) {
  if (task.status === 'done') throw new Error('끝난 작업에는 입력을 요청할 수 없습니다');
  if (task.status === INPUT_STATUS) throw new Error('이미 입력을 기다리는 작업입니다');
  return { ...task, status: INPUT_STATUS, input: { at, ...request }, updatedAt: at };
}

/** 답을 멤버에게 알릴 한 줄(메시지 내용). entry 는 task.inputs 의 한 항목. */
export function answerText(entry) {
  const a = entry.answer;
  const what = entry.kind === 'preview' ? (a.approve ? '보내도 됨' : '보내지 말 것')
    : entry.kind === 'choice' ? `고른 안: ${entry.options.find((o) => o.id === a.choice)?.label} (${a.choice})`
    : Object.entries(a.values).map(([k, v]) => `${k}=${v}`).join(', ') || '(빈 칸)';
  return `입력 답(${INPUT_KINDS[entry.kind]}): ${entry.title} — ${what}${a.note ? ` (메모: ${a.note})` : ''}`.slice(0, 2000);
}

/** 답을 작업에 붙이고 todo 로 돌린다 → { task } | { error }. */
export function answerInput(task, input, at, by = 'human') {
  if (task.status !== INPUT_STATUS || !task.input) return { error: '입력을 기다리는 작업이 아닙니다' };
  const r = validateInputAnswer(task.input, input);
  if (r.error) return r;
  const { input: req, ...rest } = task;
  return { task: { ...rest, status: 'todo', inputs: [...(task.inputs || []), { ...req, answer: r.answer, answeredAt: at, answeredBy: by }], updatedAt: at } };
}
