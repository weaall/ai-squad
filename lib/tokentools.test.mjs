import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { graphifyMeter, isGraphifyCall, pathEnv, ponytailState, tokenRules, updateGraph, withTokenTools } from './tokentools.mjs';
import { lockTask } from './runners/lock.mjs';
import { toolSavings } from './state.mjs';
import crypto from 'node:crypto';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'squad-tt-'));

test('ponytail·graphify 는 맵에 없으면 켜짐, 끈 값은 지킨다', () => {
  assert.deepEqual(withTokenTools([{ name: 'a', on: true }, { name: 'graphify', on: false }]), [
    { name: 'a', on: true },
    { name: 'graphify', on: false },
    { name: 'ponytail', on: true },
  ]);
});

test('graphify 질의 명령만 알아본다', () => {
  assert.ok(isGraphifyCall('graphify query "x"'));
  assert.ok(isGraphifyCall('cd a && "C:/py/Scripts/graphify.exe" explain Foo'));
  assert.ok(isGraphifyCall('graphify path "A" "B" --graph g.json'));
  assert.ok(!isGraphifyCall('graphify update .'));
  assert.ok(!isGraphifyCall('grep graphify query.txt'));
});

test('stream-json 에서 graphify 결과 글자와 가리킨 파일 크기로 절감을 추정한다', () => {
  const dir = tmp();
  fs.mkdirSync(path.join(dir, 'src'));
  fs.writeFileSync(path.join(dir, 'src', 'a.ts'), 'x'.repeat(5000));
  fs.writeFileSync(path.join(dir, 'src', 'b.ts'), 'y'.repeat(3000));
  const m = graphifyMeter([dir]);
  const out = 'NODE foo() [src=src/a.ts loc=L3]\nNODE bar [src=src/b.ts loc=L1]\nNODE baz [src=src/a.ts loc=L9]';
  m.line(JSON.stringify({ type: 'assistant', message: { content: [{ type: 'tool_use', id: 't1', name: 'Bash', input: { command: 'graphify query "foo"' } }, { type: 'tool_use', id: 't2', name: 'Bash', input: { command: 'ls' } }] } }));
  m.line(JSON.stringify({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 't2', content: 'src=src/b.ts 무시' }] } }));
  m.line(JSON.stringify({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 't1', content: [{ type: 'text', text: out }] }] } }));
  m.line('깨진 줄 graphify');
  assert.deepEqual(m.result(), { calls: 1, out: out.length, src: 8000, files: 2, saved: 8000 - out.length });
  assert.equal(graphifyMeter([dir]).result(), null);
});

test('토큰 규칙: 켜진 도구만, runner·worktree 에 맞춰', () => {
  assert.equal(tokenRules({}), '');
  assert.equal(tokenRules({ graphify: true }), '', '그래프가 없으면 graphify 규칙 없음');
  const c = tokenRules({ graphify: true, ponytail: true, graph: 'C:/p/graphify-out/graph.json' });
  assert.match(c, /graphify query/);
  assert.match(c, /graphify update \./);
  assert.match(c, /ponytail/);
  const w = tokenRules({ graphify: true, graph: 'C:/p/g.json', worktree: true });
  assert.match(w, /--graph "C:\/p\/g.json"/);
  assert.doesNotMatch(w, /graphify update/);
  assert.doesNotMatch(w, /ponytail/);
  const a = tokenRules({ graphify: true, graph: 'g.json', runner: 'antigravity', prequery: 'NODE x [src=a.ts]' });
  assert.match(a, /graphify 결과/);
  assert.match(a, /NODE x/);
  assert.doesNotMatch(a, /graphify query "/);
});

test('pathEnv 는 Windows Path 키를 그대로 쓴다', () => {
  const bin = path.resolve('/py/Scripts/graphify.exe');
  const e = pathEnv(bin, { Path: 'A' });
  assert.deepEqual(Object.keys(e), ['Path']);
  assert.ok(e.Path.startsWith(path.dirname(bin) + path.delimiter));
  assert.deepEqual(pathEnv('graphify', { PATH: 'A' }), {});
});

test('ponytailState 는 설치·켜짐을 읽기만 한다', () => {
  const home = tmp();
  assert.deepEqual(ponytailState(home), { installed: false, enabled: false });
  fs.mkdirSync(path.join(home, '.claude', 'plugins'), { recursive: true });
  fs.writeFileSync(path.join(home, '.claude', 'plugins', 'installed_plugins.json'), JSON.stringify({ plugins: { 'ponytail@ponytail': [{}] } }));
  fs.writeFileSync(path.join(home, '.claude', 'settings.json'), JSON.stringify({ enabledPlugins: { 'ponytail@ponytail': true } }));
  assert.deepEqual(ponytailState(home), { installed: true, enabled: true });
});

test('updateGraph: 없음·잠김·실패해도 던지지 않는다', async () => {
  const root = tmp();
  const dir = tmp();
  assert.equal((await updateGraph({ root, dir, bin: '' })).status, 'missing');
  const key = crypto.createHash('sha1').update(path.resolve(dir).toLowerCase()).digest('hex').slice(0, 12);
  const release = lockTask(path.join(root, 'data', 'locks'), `graphify-${key}`);
  assert.equal((await updateGraph({ root, dir, bin: process.execPath })).status, 'locked');
  release();
  // node update . → 모듈 없음으로 실패
  const r = await updateGraph({ root, dir, bin: process.execPath, timeoutMs: 20000 });
  assert.equal(r.status, 'failed');
});

test('toolSavings: 멤버별·일별로 더한다', () => {
  const now = Date.parse('2026-10-21T03:00:00Z');
  const ev = (member, at, savings) => ({ type: 'end', member, at, savings });
  const s = toolSavings([
    ev('a', '2026-10-21T01:00:00Z', { on: ['headroom', 'ponytail', 'graphify'], graphify: { calls: 2, out: 100, src: 1000, saved: 900 } }),
    ev('a', '2026-10-20T01:00:00Z', { on: ['ponytail'] }),
    ev('b', '2026-10-01T01:00:00Z', { on: ['ponytail'] }), // 7일 밖
    { type: 'end', member: 'b', at: '2026-10-21T01:00:00Z' }, // savings 없음
  ], now);
  assert.equal(s.days.length, 7);
  assert.equal(s.days.at(-1).graphify.saved, 900);
  assert.equal(s.days.at(-2).on.ponytail, 1);
  assert.deepEqual(s.members.a.on, { headroom: 1, ponytail: 2, graphify: 1 });
  assert.equal(s.members.a.runs, 2);
  assert.equal(s.members.b, undefined);
});
