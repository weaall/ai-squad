// `squad msg` 뒤처리 — 멤버끼리 직접 묻고 답할 때. 순수 함수만(파일은 squad.mjs 가 쓴다).
// question → 받는 멤버에게 '답변' 작업(easy). answer → 원래 작업이 답을 기다리면(입력 대기·막힘) 다시 todo.
import path from 'node:path';

const WAITING = ['input', 'blocked'];

/**
 * msg: 검증된 메시지 {from, to, kind, text, taskId?}. workers: 작업을 받을 수 있는 멤버 id(order·human 제외).
 * → { task?: 새 답변 작업 입력, resume?: 다시 todo 로 돌릴 작업 id }
 */
export function afterMessage(msg, { tasks = [], workers = [], squadRoot = '', project = '' } = {}) {
  if (msg.from === msg.to) return {};
  if (msg.kind === 'question' && workers.includes(msg.to)) {
    const reply = `node "${path.join(squadRoot, 'bin', 'squad.mjs')}" msg ${project} ${msg.to} ${msg.from} "<답>" --kind answer${msg.taskId ? ` --task ${msg.taskId}` : ''}`;
    return {
      task: {
        title: `답변: ${msg.from} 의 질문 — ${msg.text.replace(/\s+/g, ' ').slice(0, 60)}`,
        detail: `${msg.from} 가 물었다${msg.taskId ? ` (작업 ${msg.taskId})` : ''}:\n${msg.text}\n\n답은 이렇게 보낸다: ${reply}`.slice(0, 2000),
        member: msg.to,
        difficulty: 'easy',
      },
    };
  }
  if (msg.kind === 'handoff' && workers.includes(msg.to)) {
    return {
      task: {
        title: `인계: ${msg.text.split('\n')[0].trim().slice(0, 80)}`,
        detail: `${msg.from} 의 인계${msg.taskId ? ` (원래 작업 ${msg.taskId})` : ''}:\n${msg.text}`.slice(0, 2000),
        member: msg.to,
      },
    };
  }
  if (msg.kind === 'answer' && msg.taskId) {
    const t = tasks.find((x) => x.id === msg.taskId);
    // 사람 입력(task.input)을 기다리는 작업은 보드 답으로만 푼다
    if (t && t.member === msg.to && WAITING.includes(t.status) && !t.input) return { resume: t.id };
  }
  return {};
}
