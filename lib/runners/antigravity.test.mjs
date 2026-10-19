import test from 'node:test';
import assert from 'node:assert/strict';
import { agyArgs, agyBin, pickModel, readAgyLine } from './antigravity.mjs';
import { getRunner } from './index.mjs';

// agy v1.4.2 실측 출력에서 뽑은 줄
const C = '"conversation_id":"c1"';
const LINES = [
  `{"event":"init","conversation_id":"c1","init":{"model":"gemini-3.8-flash-low","tools":["view_file"]}}`,
  `{"event":"step_update","step_update":{${C},"step_index":2,"state":"ACTIVE","step_type":"tool","tool_name":"view_file","tool_info":{"name":"view_file","parameters":{"AbsolutePath":"C:/p/a.txt"}}}}`,
  `{"event":"step_update","step_update":{${C},"step_index":2,"state":"DONE","step_type":"tool","tool_name":"view_file","tool_info":{"name":"view_file","parameters":{"AbsolutePath":"C:/p/a.txt"},"output":"1 lines"}}}`,
  `{"event":"step_update","step_update":{${C},"step_index":3,"state":"DONE","step_type":"agent_response","usage":{"input_tokens":11916,"output_tokens":90,"thinking_tokens":10,"cache_read_tokens":5,"total_tokens":12021}}}`,
  `{"event":"step_update","step_update":{${C},"step_index":4,"state":"ACTIVE","step_type":"tool","tool_name":"write_to_file","tool_info":{"name":"write_to_file","parameters":{"TargetFile":"C:/p/sub/b.txt"}}}}`,
  `{"event":"step_update","step_update":{${C},"step_index":5,"state":"ACTIVE","step_type":"agent_response","text_delta":"done."}}`,
  `{"event":"result","result":{${C},"status":"SUCCESS","response":"done.\\n","num_turns":1,"usage":{"input_tokens":35712,"output_tokens":152,"thinking_tokens":0,"cache_read_tokens":0,"total_tokens":35864}}}`,
];

test('readAgyLine: 도구는 ACTIVE 에서 한 번, 경로는 프로젝트 기준 상대', () => {
  const r = LINES.map((l) => readAgyLine(l, 'C:/p'));
  const tools = r.filter(Boolean).flatMap((x) => x.tools);
  assert.deepEqual(tools.map((t) => t.tool), ['view_file', 'write_to_file']);
  if (process.platform === 'win32') assert.deepEqual(tools.map((t) => t.path), ['a.txt', 'sub/b.txt']);
  assert.equal(r[0], null); // init·text_delta 만 있는 줄은 무시
  assert.equal(r[5], null);
});

test('readAgyLine: 사용량은 runner antigravity, thinking 은 출력에 더함', () => {
  const s = readAgyLine(LINES[3]);
  assert.deepEqual(s.usage, { input: 11916, output: 100, cacheRead: 5, cacheWrite: 0, runner: 'antigravity' });
  assert.equal(s.stepId, 'c1:3');
  const end = readAgyLine(LINES[6]).result;
  assert.equal(end.text, 'done.');
  assert.equal(end.isError, false);
  assert.equal(end.usage.input, 35712);
  assert.equal(readAgyLine('{"event":"result","result":{"status":"ERROR","response":"x"}}').result.isError, true);
  assert.equal(readAgyLine('not json'), null);
  // 실측: 헤드리스가 run_command 를 거부하면 빈 답 + SUCCESS + denied_actions
  const denied = readAgyLine('{"event":"result","result":{"status":"SUCCESS","response":"","denied_actions":[{"action":"command","display_name":"RunCommand"}]}}').result;
  assert.equal(denied.isError, true);
  assert.equal(denied.text, '도구 거부(denied): RunCommand');
});

test('pickModel·agyArgs·agyBin', () => {
  assert.equal(pickModel('claude-sonnet-4-6'), 'claude-sonnet-4-6');
  assert.equal(pickModel('claude-haiku-5-5'), 'gemini-3.8-flash-medium'); // Claude Code 모델은 기본 모델로
  assert.equal(pickModel('', { defaultModel: 'gemini-3.8-flash-low' }), 'gemini-3.8-flash-low');
  const a = agyArgs({ prompt: 'hi "x"', model: 'm', timeoutMs: 90500, addDirs: ['D'] });
  assert.deepEqual(a.slice(-2), ['-p', 'hi "x"']);
  assert.equal(a[a.indexOf('--print-timeout') + 1], '91s');
  assert.equal(a[a.indexOf('--add-dir') + 1], 'D');
  assert.ok(!a.some((x) => /dangerously/.test(x)));
  assert.equal(agyBin({ bin: '%LOCALAPPDATA%\\agy\\bin\\agy.exe' }, { LOCALAPPDATA: 'L:' }), 'L:\\agy\\bin\\agy.exe');
});

test('getRunner: config 에 없어도 antigravity 는 기본 설정으로', () => {
  const r = getRunner({ runners: {} }, 'antigravity');
  assert.equal(r.cfg.type, 'antigravity');
  assert.throws(() => getRunner({ runners: {} }, 'nope'));
});
