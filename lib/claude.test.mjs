import test from 'node:test';
import assert from 'node:assert/strict';
import { buildOrderPrompt, buildRunPrompt, parsePlan, readStreamLine, toolPath } from './claude.mjs';

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
  assert.deepEqual(parsePlan(wrapped, ['site']), [{ member: 'site', title: '제목', detail: 'd', why: 'w' }]);
  assert.equal(parsePlan(JSON.stringify(plan), ['site']).length, 1);
  assert.throws(() => parsePlan('없음', ['site']));
});

test('실행 프롬프트에 멤버 문서·작업·규칙이 들어간다', () => {
  const p = buildRunPrompt({ memberMd: 'MD', notesMd: '', task: { id: 'T-1', title: '고치기' }, squadRoot: 'C:/sq', project: 'qugo', member: 'site' });
  assert.match(p, /MD/);
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
  assert.deepEqual(readStreamLine(JSON.stringify({ type: 'result', result: ' 끝 ', is_error: false }), '/p').result, { text: '끝', isError: false });
  assert.equal(readStreamLine('not json'), null);
  assert.equal(readStreamLine(JSON.stringify({ type: 'system' })), null);
  assert.equal(toolPath({ pattern: '**/*.ts' }), '**/*.ts');
  assert.equal(toolPath({ file_path: '/other/x' }, '/p'), '/other/x');
});
