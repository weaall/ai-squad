// 대화형 세션 다리(inbox) — 보드에서 "데스크톱 Claude 세션"으로 보낸 지시. <project>/.squad/inbox.jsonl 에 덧붙이기만 한다.
// 줄 종류: {type:'add', id, at, from, text}  {type:'take', id, at}  {type:'done', id, at, result}
// 상태: pending(대기) → taking(처리 중) → done(끝). 거꾸로 가거나 건너뛰는 줄은 무시한다.
import { appendJsonl, newId, readJsonl } from './store.mjs';

export const INBOX_LABEL = { pending: '대기', taking: '처리 중', done: '끝' };
const NEXT = { take: ['pending', 'taking'], done: ['taking', 'done'] };

/** 한 항목에 줄 하나를 적용한다 — 순수 함수. 허용되지 않는 전이면 null. */
export function inboxStep(item, row) {
  const rule = NEXT[row.type];
  if (!item || !rule || item.status !== rule[0]) return null;
  return { ...item, status: rule[1], ...(row.type === 'take' ? { takenAt: row.at } : { doneAt: row.at, result: row.result || '' }) };
}

export function foldInbox(rows) {
  const byId = new Map();
  for (const r of rows) {
    if (r.type === 'add' && !byId.has(r.id)) byId.set(r.id, { id: r.id, at: r.at, from: r.from || 'human', text: r.text, status: 'pending' });
    else if (byId.has(r.id)) {
      const next = inboxStep(byId.get(r.id), r);
      if (next) byId.set(r.id, next);
    }
  }
  return [...byId.values()];
}

export const loadInbox = (paths) => foldInbox(readJsonl(paths.inbox));

export function validateInboxText(text) {
  const t = typeof text === 'string' ? text.trim() : '';
  if (!t) return { error: '지시를 입력하세요' };
  if (t.length > 1000) return { error: '지시: 1000자 이하로 써 주세요' };
  return { text: t };
}

export function addInbox(paths, text, from = 'human') {
  const v = validateInboxText(text);
  if (v.error) throw new Error(v.error);
  return appendJsonl(paths.inbox, { type: 'add', id: newId('I'), at: new Date().toISOString(), from, text: v.text });
}

/** 가장 오래된 대기 지시를 처리 중으로 바꾸고 돌려준다. 없으면 null. */
export function takeInbox(paths) {
  const item = loadInbox(paths).find((i) => i.status === 'pending');
  if (!item) return null;
  const row = { type: 'take', id: item.id, at: new Date().toISOString() };
  appendJsonl(paths.inbox, row);
  return inboxStep(item, row);
}

export function doneInbox(paths, id, result) {
  const item = loadInbox(paths).find((i) => i.id === id);
  if (!item) throw new Error(`inbox 지시가 없습니다: ${id}`);
  if (item.status !== 'taking') throw new Error(item.status === 'done' ? '이미 끝난 지시입니다' : '먼저 --take 로 가져와야 끝낼 수 있습니다');
  const r = typeof result === 'string' ? result.trim().slice(0, 2000) : '';
  const row = { type: 'done', id, at: new Date().toISOString(), result: r };
  appendJsonl(paths.inbox, row);
  return inboxStep(item, row);
}
