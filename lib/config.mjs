// squad.config.json — 메인 AI(오더가 쓸 runner·모델)와 runner 목록. 비밀값은 여기에 두지 않는다(lib/secrets.mjs).
import fs from 'node:fs';
import path from 'node:path';

export const RUNNER_TYPES = ['claude', 'command'];
export const MAIN_MODEL = 'claude-sonnet-5-5';
export const PLAN_RETRY_MODEL = 'claude-opus-5-5';
const NAME_RE = /^[a-z0-9][a-z0-9-]{0,39}$/;
const ENV_RE = /^[A-Z_][A-Z0-9_]{0,63}$/;

/**
 * 읽은 JSON 을 쓸 수 있는 모양으로 고친다. 잘못된 runner 는 빼고 errors 에 이유를 남긴다.
 * claude runner 는 늘 있다(없으면 기본값으로 넣는다).
 */
export function normalizeConfig(raw) {
  const src = raw && typeof raw === 'object' ? raw : {};
  const errors = [];
  const runners = {};
  for (const [name, r] of Object.entries(src.runners && typeof src.runners === 'object' ? src.runners : {})) {
    if (!NAME_RE.test(name)) { errors.push(`runner 이름이 잘못됐습니다: ${name}`); continue; }
    if (!r || !RUNNER_TYPES.includes(r.type)) { errors.push(`${name}: type 은 claude 또는 command`); continue; }
    const label = typeof r.label === 'string' ? r.label.slice(0, 60) : name;
    if (r.type === 'claude') { runners[name] = { type: 'claude', label }; continue; }
    if (typeof r.cmd !== 'string' || !r.cmd.trim()) { errors.push(`${name}: cmd 가 없습니다`); continue; }
    const args = r.args === undefined ? [] : r.args;
    if (!Array.isArray(args) || !args.every((a) => typeof a === 'string')) { errors.push(`${name}: args 는 문자열 배열`); continue; }
    if (r.secret !== undefined && !ENV_RE.test(r.secret)) { errors.push(`${name}: secret 은 환경 변수 이름(대문자·숫자·_)`); continue; }
    runners[name] = { type: 'command', label, cmd: r.cmd.trim(), args, ...(r.secret ? { secret: r.secret } : {}) };
  }
  if (!runners.claude) runners.claude = { type: 'claude', label: 'Claude Code' };
  // 계획은 싼 모델이 기본(비면 Sonnet). 계획이 비거나 실패하면 planOrder 가 Opus 로 한 번만 다시 한다.
  let mainAi = { runner: 'claude', model: MAIN_MODEL };
  if (src.mainAi && typeof src.mainAi === 'object') {
    if (runners[src.mainAi.runner]) mainAi = { runner: src.mainAi.runner, model: typeof src.mainAi.model === 'string' && src.mainAi.model.trim() ? src.mainAi.model.trim() : src.mainAi.runner === 'claude' ? MAIN_MODEL : '' };
    else errors.push(`mainAi.runner 가 runners 에 없습니다: ${src.mainAi.runner}`);
  }
  const mins = (v, d) => (Number.isFinite(v) && v > 0 ? v : d);
  const stale = { answerMinutes: mins(src.stale?.answerMinutes, 30), idleMinutes: mins(src.stale?.idleMinutes, 30) };
  // v0.4: 토큰 예산(0 은 상한 없음), 검수, 일일 보고
  const tok = (v, d) => (Number.isFinite(v) && v >= 0 ? Math.round(v) : d);
  const b = src.budget || {};
  const budget = {
    daily: tok(b.daily, 0),
    memberDaily: tok(b.memberDaily, 0),
    task: tok(b.task, 0),
    warn: Number.isFinite(b.warn) && b.warn > 0 && b.warn < 1 ? b.warn : 0.8,
  };
  const reviewDefault = typeof src.review?.default === 'string' && NAME_RE.test(src.review.default) ? src.review.default : '';
  const review = { default: reviewDefault, maxFiles: tok(src.review?.maxFiles, 30) || 30 };
  const report = { copyTo: typeof src.report?.copyTo === 'string' ? src.report.copyTo.trim() : '' };
  // 계획을 사람 확인 없이 바로 배정할지(기본 true). 위험한 계획은 lib/confirm.mjs 가 따로 멈춘다.
  const order = { autoAssign: src.order?.autoAssign !== false };
  // 난이도별 모델 덮어쓰기(lib/runners/claude.mjs DEFAULT_MODELS)
  const models = Object.fromEntries(['easy', 'normal', 'hard'].filter((k) => typeof src.models?.[k] === 'string').map((k) => [k, src.models[k].trim()]));
  // 멤버 실행을 headroom 으로 감쌀지 기본값(기본 true). 멤버는 MEMBER.md headroom: false 로 끈다(lib/store.mjs resolveHeadroom)
  const headroom = { default: src.headroom?.default !== false };
  return { mainAi, runners, stale, budget, review, report, order, models, headroom, errors };
}

export function loadConfig(root) {
  let raw = {};
  try {
    raw = JSON.parse(fs.readFileSync(path.join(root, 'squad.config.json'), 'utf8'));
  } catch {
    // 없거나 깨졌으면 기본값
  }
  return normalizeConfig(raw);
}
