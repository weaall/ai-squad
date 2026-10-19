// command runner — 다른 AI CLI 를 템플릿으로 붙인다. 예: {"cmd": "some-ai", "args": ["--prompt", "{prompt}"]}
// - args 의 {prompt}·{model}·{cwd} 를 바꿔 넣는다. {prompt} 가 없으면 프롬프트를 stdin 으로 보낸다.
// - 셸을 거치지 않는다(shell: false) → 프롬프트 안의 글자가 명령으로 해석되지 않는다.
//   Windows 의 .cmd/.bat 는 셸 없이 못 띄우니 .exe 를 쓰거나, 프롬프트를 stdin 으로 받는 래퍼를 쓴다.
// - 출력은 텍스트 그대로 받는다. 토큰 사용량은 모른다(usage: null).
// - secret 이 있으면 `squad auth set <runner>` 로 저장한 값을 그 이름의 환경 변수로 넘긴다.
import { spawn } from 'node:child_process';
import { getSecret, hasSecret } from '../secrets.mjs';
import { collect, hasCommand, notFoundHint } from './proc.mjs';

/** 인자 템플릿 채우기 — 순수 함수. */
export function fillArgs(args, vars) {
  let usesPrompt = false;
  const out = (args || []).map((a) =>
    a.replace(/\{(prompt|model|cwd)\}/g, (_, k) => {
      if (k === 'prompt') usesPrompt = true;
      return String(vars[k] ?? '');
    }),
  );
  return { args: out, usesPrompt };
}

export async function exec({ cfg, name, prompt, cwd, model = '', stderr = 'pipe', timeoutMs = 0, onLine }) {
  const { args, usesPrompt } = fillArgs(cfg.args, { prompt, model, cwd });
  const env = { ...process.env };
  if (cfg.secret) {
    const v = getSecret(name);
    if (!v) throw new Error(`${name} 의 키가 없습니다. 터미널에서 node bin/squad.mjs auth set ${name} 로 넣으세요`);
    env[cfg.secret] = v;
  }
  const child = spawn(cfg.cmd, args, { cwd, shell: false, env, stdio: ['pipe', 'pipe', stderr], windowsHide: true });
  child.stdin.on('error', () => {});
  child.stdin.end(usesPrompt ? '' : prompt);
  const r = await collect(child, { timeoutMs, keepOut: true, onLine });
  // ponytail: 출력 전체를 결과로 본다. 그 CLI 가 JSON 을 내면 그때 파서를 붙인다.
  const text = r.out.trim().slice(-4000);
  return { code: r.code, timedOut: r.timedOut, text, isError: r.code !== 0, usage: null, err: r.err + (r.code !== 0 ? notFoundHint(r.err) : '') };
}

export async function status({ cfg, name }) {
  if (!hasCommand(cfg.cmd)) return { state: 'unset', detail: `${cfg.cmd} 명령이 없습니다` };
  if (cfg.secret && !hasSecret(name)) return { state: 'unset', detail: `키 미설정 — node bin/squad.mjs auth set ${name}` };
  return { state: 'ok' };
}
