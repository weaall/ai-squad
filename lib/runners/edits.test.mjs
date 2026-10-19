import test from 'node:test';
import assert from 'node:assert/strict';
import { readStreamLine } from '../claude.mjs';
import { judgeEdits } from './edits.mjs';

const root = process.platform === 'win32' ? 'C:\\qugo' : '/qugo';
const abs = (p) => (process.platform === 'win32' ? `${root}\\${p.replace(/\//g, '\\')}` : `${root}/${p}`);
const line = (name, input) => JSON.stringify({ type: 'assistant', message: { id: 'm', content: [{ type: 'tool_use', name, input }] } });
const toolsOf = (lines) => lines.flatMap((l) => readStreamLine(l, root)?.tools || []);

test('judgeEdits: 두 멤버 동시 실행 — git 차이에 섞인 남의 수정은 경로 밖으로 보지 않고 그 멤버 몫으로 표시', () => {
  const web = { id: 'web-core', owns: ['qugo_fe_web/app/**'] };
  const be = { id: 'backend-org', owns: ['qugo_be_api/**'] };
  // 같은 작업 트리라 두 멤버 모두 실행 전후 git 차이가 같다
  const changed = ['qugo_be_api/src/admin.pseudonym.service.ts', 'qugo_fe_web/app/page.tsx', 'stray.txt'];
  const webTools = toolsOf([line('Read', { file_path: abs('qugo_be_api/src/admin.pseudonym.service.ts') }), line('Edit', { file_path: abs('qugo_fe_web/app/page.tsx') })]);
  const beTools = toolsOf([line('Write', { file_path: abs('qugo_be_api/src/admin.pseudonym.service.ts') })]);

  const w = judgeEdits({ tools: webTools, changed, owns: web.owns, memberId: web.id, others: [be] });
  assert.deepEqual(w.outside, []);
  assert.equal(w.bash, false);
  assert.deepEqual(w.gitOnly, [
    { path: 'qugo_be_api/src/admin.pseudonym.service.ts', member: 'backend-org' },
    { path: 'stray.txt', member: '' },
  ]);

  const b = judgeEdits({ tools: beTools, changed, owns: be.owns, memberId: be.id, others: [web] });
  assert.deepEqual(b.outside, []);
  assert.deepEqual(b.gitOnly, [
    { path: 'qugo_fe_web/app/page.tsx', member: 'web-core' },
    { path: 'stray.txt', member: '' },
  ]);
});

test('judgeEdits: 자기 도구로 owns 밖을 고치면 경로 밖, Bash 는 판단 불가로 표시', () => {
  const tools = toolsOf([
    line('MultiEdit', { file_path: abs('qugo_be_api/x.ts') }),
    line('NotebookEdit', { notebook_path: abs('qugo_fe_web/app/n.ipynb') }),
    line('Edit', { file_path: abs('.squad/members/web-core/NOTES.md') }),
    line('Bash', { command: 'sed -i s/a/b/ qugo_be_api/y.ts' }),
  ]);
  const r = judgeEdits({ tools, changed: ['qugo_be_api/x.ts', 'qugo_be_api/y.ts'], owns: ['qugo_fe_web/app/**'], memberId: 'web-core' });
  assert.deepEqual(r.outside, ['qugo_be_api/x.ts']);
  assert.equal(r.bash, true);
  assert.deepEqual(r.gitOnly, [{ path: 'qugo_be_api/y.ts', member: '' }]);
});
