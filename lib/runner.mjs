// claude 실행과 메인 오더 계획 — CLI(order·run)와 보드 서버(/api/order)가 같이 쓴다.
import fs from 'node:fs';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { appendJsonl, newId, readJsonl } from './store.mjs';
import { buildOrderPrompt, parsePlan } from './claude.mjs';
import { validateMessage, validateTask } from './validate.mjs';

const isWin = process.platform === 'win32';

// 기본은 claude 를 바로 실행한다. headroom(토큰 압축 프록시)은 --headroom 이나 MEMBER.md 의 headroom: true 일 때만 감싼다.
function launcher(useHeadroom) {
  if (!useHeadroom) return { cmd: 'claude', pre: [] };
  const found = spawnSync(isWin ? 'where' : 'which', ['headroom'], { stdio: 'ignore' }).status === 0;
  if (found) return { cmd: 'headroom', pre: ['wrap', 'claude', '--'] };
  console.warn('경고: headroom 이 켜져 있지만 설치돼 있지 않아 claude 를 바로 실행합니다');
  return { cmd: 'claude', pre: [] };
}

// Windows 에서 claude 는 .cmd 라 셸을 거쳐야 한다 → 인자를 직접 따옴표로 감싼다. 프롬프트는 stdin 으로 보내 명령줄 길이 제한을 피한다.
const quote = (a) => (isWin ? `"${String(a).replace(/"/g, '\\"')}"` : `'${String(a).replace(/'/g, `'\\''`)}'`);
export function spawnClaude(args, prompt, cwd, useHeadroom = false, stderr = 'inherit') {
  const { cmd, pre } = launcher(useHeadroom);
  const child = spawn(cmd, [...pre, ...args].map(quote), { cwd, shell: true, stdio: ['pipe', 'pipe', stderr] });
  child.stdin.on('error', () => {}); // claude 가 먼저 끝나면 EPIPE — 무시하고 종료 코드로 판단
  child.stdin.end(prompt);
  return child;
}

/** 오더 프롬프트 조립: ORDER.md + SQUAD.md + 멤버 요약(대기 작업 수 포함) + 지시. */
export function orderPrompt({ root, paths, members, instruction }) {
  const tasks = readJsonl(paths.tasks);
  const read = (f) => {
    try {
      return fs.readFileSync(f, 'utf8');
    } catch {
      return '';
    }
  };
  return buildOrderPrompt({
    orderMd: read(path.join(root, 'ORDER.md')),
    squadMd: read(path.join(paths.squad, 'SQUAD.md')),
    members: members.map((m) => ({ ...m, pending: tasks.filter((t) => t.member === m.id && t.status !== 'done').length })),
    instruction,
  });
}

/**
 * 계획만 받는다(`order --dry` 와 같다). 실패하면 한국어 문구의 Error 를 던진다. 저장하지 않는다.
 * ponytail: 시간 제한은 하나(기본 5분). 길게 걸리는 지시가 잦으면 설정으로.
 */
export function planOrder({ root, paths, members, instruction, headroom = false, timeoutMs = 300000, stderr = 'inherit' }) {
  const prompt = orderPrompt({ root, paths, members, instruction });
  return new Promise((resolve, reject) => {
    let child;
    try {
      child = spawnClaude(['-p', '--output-format', 'json'], prompt, paths.path, headroom, stderr);
    } catch (e) {
      return reject(new Error(`claude 를 실행하지 못했습니다: ${e.message}`));
    }
    let out = '';
    let err = '';
    child.stdout.on('data', (d) => (out += d));
    child.stderr?.on('data', (d) => (err = (err + d).slice(-400)));
    const timer = setTimeout(() => child.kill(), timeoutMs);
    child.on('error', (e) => {
      clearTimeout(timer);
      reject(new Error(`claude 를 실행하지 못했습니다: ${e.message}`));
    });
    child.on('close', (code, signal) => {
      clearTimeout(timer);
      if (signal) return reject(new Error('claude 가 시간 안에 끝나지 않았습니다'));
      if (code !== 0) {
        const hint = /not recognized|not found|인식되지|찾을 수 없/i.test(err) ? ' (claude CLI 가 설치돼 있는지 확인하세요)' : '';
        return reject(new Error(`claude 가 ${code} 로 끝났습니다${hint}`));
      }
      try {
        resolve(parsePlan(out, members.filter((m) => m.id !== 'order').map((m) => m.id)));
      } catch (e) {
        reject(e);
      }
    });
  });
}

/** 계획을 저장한다: 사람 → 오더 지시 1건 + 멤버마다 작업과 오더 → 멤버 지시. 검증에 걸리면 아무것도 쓰지 않고 던진다. */
export function saveOrder({ paths, members, instruction, plan }) {
  const ids = members.map((m) => m.id);
  const at = new Date().toISOString();
  const first = validateMessage({ from: 'human', to: 'order', kind: 'order', text: instruction.slice(0, 2000) }, ids);
  if (first.error) throw new Error(first.error);
  const tasks = plan.map((p) => {
    const v = validateTask({ title: p.title, detail: p.detail, member: p.member }, ids.filter((id) => id !== 'order'));
    if (v.error) throw new Error(v.error);
    return { v, why: p.why || '' };
  });
  appendJsonl(paths.messages, { id: newId('M'), at, ...first });
  return tasks.map(({ v, why }) => {
    const t = appendJsonl(paths.tasks, { id: newId('T'), ...v, createdBy: 'order', createdAt: at, updatedAt: at, summary: '' });
    const text = [v.title, why].filter(Boolean).join(' — ').slice(0, 2000);
    appendJsonl(paths.messages, { id: newId('M'), at, from: 'order', to: v.member, kind: 'order', taskId: t.id, text });
    return t;
  });
}
