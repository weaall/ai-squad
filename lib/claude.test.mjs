import test from 'node:test';
import assert from 'node:assert/strict';
import { DIGEST_LINE_MAX, DIGEST_MAX, buildOrderPrompt, buildRunPrompt, memberDigest, parsePlan, readStreamLine, readUsage, squadDigest, toolPath } from './claude.mjs';

const members = [
  { id: 'order', name: '메인 오더', runner: 'claude', model: '', owns: [], plugins: [], role: '분배' },
  { id: 'site', name: '사이트', runner: 'claude', model: 'claude-opus-5-5', owns: ['app/page.tsx'], plugins: ['dataviz'], role: '\n사이트 담당\n둘째 줄', pending: 2 },
];

test('오더 프롬프트는 규칙·스쿼드·멤버 요약·지시를 담고 본문 전체는 넣지 않는다', () => {
  const p = buildOrderPrompt({ orderMd: '# 규칙', squadMd: '# QUGO', members, instruction: 'SEO 손보기' });
  assert.match(p, /# 규칙/);
  assert.match(p, /# QUGO/);
  assert.match(p, /id: site \/ 사이트 \/ runner=claude \/ model=claude-opus-5-5/);
  assert.match(p, /역할: 사이트 담당/);
  assert.doesNotMatch(p, /둘째 줄/);
  assert.doesNotMatch(p, /id: order/);
  assert.match(p, /대기 작업: 2/);
  assert.match(p, /SEO 손보기/);
  assert.match(p, /member 는 다음 중 하나: site/);
});

test('계획 파싱: 감싸개·울타리·모르는 멤버', () => {
  const plan = [{ member: 'site', title: ' 제목 ', detail: 'd', why: 'w' }, { member: 'ghost', title: 'x' }, { member: 'site', title: '' }];
  const wrapped = JSON.stringify({ type: 'result', result: '계획입니다\n```json\n' + JSON.stringify(plan) + '\n```' });
  assert.deepEqual(parsePlan(wrapped, ['site']), [{ member: 'site', title: '제목', detail: 'd', why: 'w', step: 1 }]);
  assert.equal(parsePlan(JSON.stringify([{ member: 'site', title: 'a', step: 3 }, { member: 'site', title: 'b', step: 'x' }]), ['site']).map((p) => p.step).join(), '3,1');
  assert.equal(parsePlan(JSON.stringify(plan), ['site']).length, 1);
  assert.throws(() => parsePlan('없음', ['site']));
});

test('실행 프롬프트에 멤버 문서·작업·규칙이 들어간다', () => {
  const memberMd = '---\nid: site\nplugins:\n  dataviz: false\n  design:ux-copy: true\n---\n\n## 역할\n\nMD 본문\n';
  const p = buildRunPrompt({ memberMd, notesMd: '', task: { id: 'T-1', title: '고치기' }, squadRoot: 'C:/sq', project: 'qugo', member: 'site', owns: ['app/**'], plugins: ['design:ux-copy'] });
  assert.match(p, /MD 본문/);
  assert.doesNotMatch(p, /dataviz/, '꺼진 플러그인과 frontmatter 는 넣지 않는다');
  assert.match(p, /플러그인·스킬·MCP: design:ux-copy/);
  assert.match(p, /owns\): app\/\*\*/);
  assert.match(p, /approve request qugo site/);
  assert.match(p, /\(없음\)/);
  assert.match(p, /제목: 고치기/);
  assert.match(p, /msg qugo site <멤버id>/);
  assert.match(p, /push 는 하지 않는다/);
});

test('stream-json 에서 도구 이름·경로만 꺼낸다', () => {
  const line = JSON.stringify({
    type: 'assistant',
    message: {
      content: [
        { type: 'text', text: '보자' },
        { type: 'tool_use', name: 'Edit', input: { file_path: '/p/app/page.tsx', old_string: '비밀', new_string: 'x' } },
        { type: 'tool_use', name: 'Bash', input: { command: 'cat .env' } },
      ],
    },
  });
  const r = readStreamLine(line, '/p');
  assert.deepEqual(r.tools, [{ tool: 'Edit', path: 'app/page.tsx' }, { tool: 'Bash', path: '' }]);
  assert.doesNotMatch(JSON.stringify(r), /비밀|\.env/);
  assert.deepEqual(readStreamLine(JSON.stringify({ type: 'result', result: ' 끝 ', is_error: false }), '/p').result, { text: '끝', isError: false, usage: null });
  assert.equal(readStreamLine('not json'), null);
  assert.equal(readStreamLine(JSON.stringify({ type: 'system' })), null);
  assert.equal(toolPath({ pattern: '**/*.ts' }), '**/*.ts');
  assert.equal(toolPath({ file_path: '/other/x' }, '/p'), '/other/x');
});

test('사용량: result 의 usage·비용을 읽는다', () => {
  const u = readUsage({ usage: { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 100, cache_creation_input_tokens: 7 }, total_cost_usd: 0.0123456789 });
  assert.deepEqual(u, { input: 10, output: 5, cacheRead: 100, cacheWrite: 7, costUsd: 0.012346 });
  assert.equal(readUsage({}), null);
  assert.deepEqual(readUsage({ usage: { input_tokens: -1, output_tokens: 'x' } }), { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 });
  const line = JSON.stringify({ type: 'result', result: 'ok', usage: { input_tokens: 3, output_tokens: 4 } });
  assert.equal(readStreamLine(line, '/p').result.usage.output, 4);
});

test('오더 요약: 상태·지금 작업·대기·최근 인계·주의만, 길이 상한을 지킨다', () => {
  const m = {
    id: 'site', name: '사이트', runner: 'claude', model: '', status: 'idle', current: '메인 손보기\n둘째', pending: 3,
    role: '역할', owns: ['a/**'], plugins: [], handoff: '인계 1줄\n인계 2줄', stalled: true, unanswered: 2,
  };
  const d = memberDigest(m);
  assert.match(d, /상태: 대기 · 지금: 메인 손보기 · 대기 작업: 3/);
  assert.match(d, /최근 인계: 인계 1줄/);
  assert.doesNotMatch(d, /인계 2줄|둘째/);
  assert.match(d, /주의: 멈춤 · 답 없는 인계 2/);
  const huge = memberDigest({ ...m, owns: Array(200).fill('qugo_fe_web/app/very/long/path/**'), role: '가'.repeat(900), handoff: '나'.repeat(900) });
  assert.ok(huge.length <= DIGEST_MAX);
  for (const l of huge.split('\n')) assert.ok([...l].length <= DIGEST_LINE_MAX);
  const many = Array.from({ length: 60 }, (_, i) => ({ ...m, id: `m${i}`, role: '가'.repeat(150), owns: ['x/'.repeat(60)] }));
  const all = squadDigest(many, 4000);
  assert.ok(all.length <= 4000, `${all.length}`);
  assert.match(all, /명 더/);
});
