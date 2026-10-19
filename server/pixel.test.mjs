import test from 'node:test';
import assert from 'node:assert/strict';
import { SIZE, character, characterGrid, characterSpec } from './public/pixel.js';

const QUGO = ['order', 'site', 'org-dashboard', 'admin-dashboard', 'survey-report', 'backend', 'biz-docs', 'ops'];

test('격자는 16×16 이고 모든 칸이 팔레트에 있다', () => {
  for (const id of QUGO) {
    for (const status of ['working', 'idle', 'blocked']) {
      for (const frame of [0, 1]) {
        const { grid, palette } = character(id, { status, frame });
        assert.equal(grid.length, SIZE);
        for (const row of grid) {
          assert.equal(row.length, SIZE);
          for (const ch of row) assert.ok(ch === '.' || palette[ch], `${id} 팔레트에 없는 칸 ${ch}`);
        }
      }
    }
  }
});

test('같은 id 는 늘 같은 모습, QUGO 멤버끼리는 서로 다르다', () => {
  assert.deepEqual(characterSpec('site'), characterSpec('site'));
  assert.deepEqual(characterGrid('site'), characterGrid('site'));
  const looks = new Set(QUGO.map((id) => characterGrid(id).join('')));
  assert.equal(looks.size, QUGO.length);
});

test('상태별 움직임: 일하는 중·대기는 프레임마다 바뀌고, 막힘은 느낌표가 뜨고 멈춰 있다', () => {
  for (const id of QUGO) {
    assert.notDeepEqual(characterGrid(id, { status: 'working', frame: 0 }), characterGrid(id, { status: 'working', frame: 1 }));
    assert.notDeepEqual(characterGrid(id, { status: 'idle', frame: 0 }), characterGrid(id, { status: 'idle', frame: 1 }));
    const b0 = characterGrid(id, { status: 'blocked', frame: 0 });
    assert.deepEqual(b0, characterGrid(id, { status: 'blocked', frame: 1 }));
    assert.ok(b0.slice(0, 5).join('').includes('r'));
    assert.ok(!characterGrid(id).join('').includes('r'));
  }
});
