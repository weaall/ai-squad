import test from 'node:test';
import assert from 'node:assert/strict';
import { afterCrash, isBoardFile, shouldRestart } from './board-watch.mjs';

test('보드 코드 파일만 감시 대상', () => {
  assert.ok(isBoardFile('server/index.mjs'));
  assert.ok(isBoardFile('server\\public\\style.css'));
  assert.ok(isBoardFile('server/public/index.html'));
  assert.ok(!isBoardFile('server/public/logo.png'));
  assert.ok(!isBoardFile('lib/node_modules/x/a.js'));
  assert.ok(!isBoardFile('server/.cache/a.js'));
});

test('커밋이 바뀌면 바로, 파일 변경은 3초 조용한 뒤 재시작', () => {
  const now = 10_000;
  assert.equal(shouldRestart({ head: 'b', runningHead: 'a', changedAt: null, now }), true);
  assert.equal(shouldRestart({ head: 'a', runningHead: 'a', changedAt: null, now }), false);
  assert.equal(shouldRestart({ head: 'a', runningHead: 'a', changedAt: now - 1000, now }), false);
  assert.equal(shouldRestart({ head: 'a', runningHead: 'a', changedAt: now - 3000, now }), true);
  // git 이 없어 HEAD 를 못 읽으면 커밋 비교는 건너뛴다
  assert.equal(shouldRestart({ head: '', runningHead: 'a', changedAt: null, now }), false);
});

test('연속 실패 3번이면 멈춘다', () => {
  assert.equal(afterCrash(1), 'retry');
  assert.equal(afterCrash(2), 'retry');
  assert.equal(afterCrash(3), 'give-up');
});
