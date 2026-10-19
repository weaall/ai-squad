// runner 고르기 — squad.config.json 의 runners[name].type 으로 어댑터를 찾는다.
import * as claude from './claude.mjs';
import * as command from './command.mjs';
import * as antigravity from './antigravity.mjs';
import { hasSecret } from '../secrets.mjs';

const ADAPTERS = { claude, command, antigravity };
// config 에 없어도 쓸 수 있는 runner — MEMBER.md runner: antigravity 만으로 동작한다(bin 은 기본 설치 경로)
const BUILTIN = { antigravity: { type: 'antigravity', label: 'Antigravity', defaultModel: antigravity.DEFAULT_MODEL } };
export const STATE_LABEL = { ok: '연결됨', login: '로그인 필요', unset: '미설정' };

export function getRunner(config, name) {
  const cfg = config.runners[name] || BUILTIN[name];
  if (!cfg) throw new Error(`runner 가 설정돼 있지 않습니다: ${name} (squad.config.json 의 runners 를 보세요)`);
  const a = ADAPTERS[cfg.type];
  return {
    name,
    cfg,
    exec: (o) => a.exec({ ...o, cfg, name }),
    status: (o = {}) => a.status({ ...o, cfg, name }),
  };
}

/** 보드 상단에 보일 runner 별 연결 상태. 비밀값은 "설정됨" 여부만. */
export async function runnerStatuses(config, { force = false } = {}) {
  return Promise.all(
    Object.entries(config.runners).map(async ([name, cfg]) => {
      let s;
      try {
        s = await getRunner(config, name).status({ force });
      } catch (e) {
        s = { state: 'unset', detail: e.message };
      }
      return {
        name,
        label: cfg.label || name,
        type: cfg.type,
        state: s.state,
        stateLabel: STATE_LABEL[s.state],
        detail: s.detail || '',
        main: config.mainAi.runner === name,
        canLogin: cfg.type === 'claude' && s.state === 'login',
        ...(cfg.secret ? { secretSet: hasSecret(name) } : {}),
      };
    }),
  );
}

export const LOGIN_COMMAND = claude.LOGIN_COMMAND;
