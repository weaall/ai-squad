import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fmtReset, isLimitError, limitBlockedText, limitHint, limitsView, loadLimits, readLimit, saveLimits, weekUsage } from './limits.mjs';
import { readStreamLine } from './claude.mjs';
import { sameDay, usageDay } from './state.mjs';
import { retryable } from './runners/retry.mjs';

const H = 3600e3;
// 2026-10-22(목) 21:00 KST = 12:00Z
const THU21 = Date.parse('2026-10-22T12:00:00Z');
const event = (five, seven, status = 'allowed') => ({
  type: 'rate_limit_event',
  rate_limit_info: { status, isUsingOverage: false, unifiedWindows: { five_hour: five, seven_day: seven } },
});

test('rate_limit_event 를 읽는다 (unifiedWindows, 창 하나만 오는 모양)', () => {
  const l = readLimit(event({ utilization: 0.52, resetsAt: 1792929600 }, { utilization: 0.15, resetsAt: THU21 / 1000 }));
  assert.deepEqual(l, { status: 'allowed', overage: false, fiveHour: { used: 0.52, resetsAt: 1792929600000 }, sevenDay: { used: 0.15, resetsAt: THU21 } });
  const one = readLimit({ type: 'rate_limit_event', rate_limit_info: { status: 'rejected', rateLimitType: 'five_hour', utilization: 1, resetsAt: 100 } });
  assert.deepEqual(one, { status: 'rejected', overage: false, fiveHour: { used: 1, resetsAt: 100000 } });
  assert.equal(readLimit({ type: 'result' }), null);
  assert.deepEqual(readStreamLine(JSON.stringify(event({ utilization: 0.5 }, null))).limit.fiveHour, { used: 0.5, resetsAt: null });
});

test('보드용 한도: 오래됨·리셋 지난 창·걸림', () => {
  const now = THU21 - 2 * H;
  const saved = { at: now - 31 * 60e3, status: 'allowed', fiveHour: { used: 0.52, resetsAt: now + H }, sevenDay: { used: 0.15, resetsAt: THU21 } };
  const v = limitsView(saved, now);
  assert.equal(v.stale, true);
  assert.equal(v.hit, false);
  assert.deepEqual(v.fiveHour, { used: 0.52, resetsAt: now + H });
  // 5시간 창 리셋이 지나면 0 으로 보고 rejected 도 풀린 것으로 본다
  assert.deepEqual(limitsView({ ...saved, status: 'rejected' }, now + 2 * H).fiveHour, { used: 0, resetsAt: null });
  assert.equal(limitsView({ ...saved, status: 'rejected' }, now + 2 * H).hit, false);
  const hit = limitsView({ ...saved, fiveHour: { used: 1, resetsAt: now + H } }, now);
  assert.equal(hit.hit, true);
  assert.equal(hit.hitResetsAt, now + H);
  assert.equal(limitBlockedText(hit, now), '사용 한도 — 리셋 20:00 이후 또는 계정 전환');
  assert.equal(limitsView(null), null);
});

test('리셋 시각은 한국시간, 하루 넘게 남으면 요일', () => {
  assert.equal(fmtReset(THU21, THU21 - H), '21:00');
  assert.equal(fmtReset(THU21, THU21 - 3 * 24 * H), '목 21:00');
  assert.ok(isLimitError('Claude AI usage limit reached|1792929600'));
  assert.ok(!isLimitError('빌드 실패'));
});

test('하루 경계는 한국시간 21:00', () => {
  assert.equal(usageDay(THU21 - 1), '2026-10-22');
  assert.equal(usageDay(THU21), '2026-10-23');
  assert.ok(sameDay(THU21, THU21 + 23 * H));
  assert.ok(!sameDay(THU21 - 1, THU21));
});

test('주간 한도가 높을수록 오더에 남은 한도를 알린다', () => {
  const v = (used) => ({ sevenDay: { used, resetsAt: THU21 } });
  assert.equal(limitHint(v(0.3), THU21 - H), '');
  assert.equal(limitHint(null), '');
  assert.match(limitHint(v(0.6), THU21 - H), /남은 주간 한도 40% \(리셋 21:00\).*easy/);
  assert.match(limitHint(v(0.85), THU21 - H), /남은 주간 한도 15%.*hard/);
});

test('이번 주 사용: 주간 창 시작부터 21시 경계 하루별 토큰·멤버·사용률', () => {
  const resetsAt = THU21 + 7 * 24 * H;
  const now = THU21 + 30 * H; // 금 21:00 지나 토 03:00 KST
  const evs = [
    { at: new Date(THU21 - H).toISOString(), member: 'a', usage: { input: 999 } }, // 지난 주
    { at: new Date(THU21 + H).toISOString(), member: 'a', usage: { input: 100, cacheRead: 1000 } },
    { at: new Date(THU21 + 2 * H).toISOString(), member: 'b', usage: { output: 50, runner: 'antigravity' } },
    { at: new Date(THU21 + 3 * H).toISOString(), member: 'a', type: 'limit', limits: { sevenDay: { used: 0.1 } } },
    { at: new Date(THU21 + 26 * H).toISOString(), member: 'b', usage: { input: 10 } },
  ];
  const w = weekUsage(evs, { sevenDay: { used: 0.2, resetsAt } }, now);
  assert.equal(w.start, THU21);
  assert.deepEqual(w.days.map((d) => d.day), ['2026-10-23', '2026-10-24']);
  assert.deepEqual(w.days[0], { day: '2026-10-23', tokens: 250, byMember: { a: 200, b: 50 }, byRunner: { claude: 200, antigravity: 50 }, used: 0.1 });
  assert.deepEqual(w.days[1], { day: '2026-10-24', tokens: 10, byMember: { b: 10 }, byRunner: { claude: 10 }, used: null });
  assert.equal(weekUsage([], null, now).days.length, 7);
});

test('한도 저장은 창별로 합친다, 한도 걸림은 재시도하지 않는다', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'limits-'));
  saveLimits(root, { status: 'allowed', fiveHour: { used: 0.5, resetsAt: 1 }, sevenDay: { used: 0.1, resetsAt: 2 } }, 10);
  saveLimits(root, { status: 'allowed', fiveHour: { used: 0.6, resetsAt: 1 } }, 20);
  assert.deepEqual(loadLimits(root), { status: 'allowed', fiveHour: { used: 0.6, resetsAt: 1 }, sevenDay: { used: 0.1, resetsAt: 2 }, at: 20 });
  assert.equal(retryable({ ok: false, limited: true }), false);
  fs.rmSync(root, { recursive: true, force: true });
});

test('계획 난이도는 작업까지 이어지고, 한도 안내는 오더 프롬프트에 들어간다', async () => {
  const { buildOrderPrompt, parsePlan } = await import('./claude.mjs');
  const { validatePlan, validateTask } = await import('./validate.mjs');
  const plan = parsePlan('[{"member":"a","title":"문서","difficulty":"easy"},{"member":"a","title":"x","difficulty":"huge"}]', ['a']);
  assert.equal(plan[0].difficulty, 'easy');
  assert.equal(plan[1].difficulty, undefined);
  assert.equal(validatePlan(plan, ['order', 'a']).plan[0].difficulty, 'easy');
  assert.equal(validateTask({ title: 't', member: 'a', difficulty: 'hard' }, ['a']).difficulty, 'hard');
  const p = buildOrderPrompt({ orderMd: '', squadMd: '', members: [], instruction: '지시', limitHint: '남은 주간 한도 30%' });
  assert.match(p, /# 사용 한도\n남은 주간 한도 30%/);
  assert.doesNotMatch(buildOrderPrompt({ orderMd: '', squadMd: '', members: [], instruction: '지시' }), /# 사용 한도/);
});
