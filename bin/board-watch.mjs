// squad board 감시 프로세스: 실제 보드 서버는 자식으로 띄우고, 보드 코드가 바뀌면 자식만 다시 띄운다.
// 접속 토큰은 여기서 한 번 만들어 자식에 넘기므로 재시작해도 주소·쿠키가 그대로다.
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { spawn, execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';

export const WATCH_DIRS = ['server', 'lib', 'bin'];
export const QUIET_MS = 3000;
export const RETRY_MS = 2000;
export const MAX_FAILURES = 3;

/** 보드 코드로 치는 파일인지(node_modules·숨김 폴더 제외). */
export function isBoardFile(rel) {
  const parts = String(rel).split(/[\\/]/);
  if (parts.some((p) => p === 'node_modules' || p.startsWith('.'))) return false;
  return /\.(mjs|js|css|html)$/.test(rel);
}

/** 지금 자식을 다시 띄울지: 커밋(HEAD)이 바뀌었거나, 마지막 변경 뒤 quietMs 동안 조용하면. */
export function shouldRestart({ head, runningHead, changedAt, now, quietMs = QUIET_MS }) {
  if (head && runningHead && head !== runningHead) return true;
  return changedAt != null && now - changedAt >= quietMs;
}

/** 자식이 오류로 죽은 뒤: 연속 실패가 MAX_FAILURES 에 닿으면 멈추고(give-up) 코드가 바뀌길 기다린다. */
export function afterCrash(failures, max = MAX_FAILURES) {
  return failures >= max ? 'give-up' : 'retry';
}

function gitHead(root) {
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return '';
  }
}

/** 폴링 대체용: 감시 파일들의 (경로·mtime) 서명. */
function scanSignature(root) {
  let sig = '';
  const walk = (dir) => {
    let entries = [];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const full = path.join(dir, e.name);
      const rel = path.relative(root, full);
      if (e.isDirectory()) { if (e.name !== 'node_modules' && !e.name.startsWith('.')) walk(full); }
      else if (isBoardFile(rel)) { try { sig += `${rel}:${fs.statSync(full).mtimeMs};`; } catch {} }
    }
  };
  for (const d of WATCH_DIRS) walk(path.join(root, d));
  return sig;
}

/** 자식이 못 뜨는 동안 같은 포트에서 오류 글을 보여 주는 작은 서버. */
function errorPage(port, host, message) {
  const html = `<!doctype html><meta charset="utf-8"><title>보드 오류</title><meta http-equiv="refresh" content="5">
<div style="background:#b00020;color:#fff;padding:12px;font:14px sans-serif">보드 서버가 ${MAX_FAILURES}번 연속 실패했습니다. 코드를 고치면 자동으로 다시 띄웁니다.</div>
<pre style="padding:12px;white-space:pre-wrap">${message.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c])}</pre>`;
  const srv = http.createServer((req, res) => {
    res.writeHead(503, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(html);
  });
  srv.on('error', () => {}); // 포트가 아직 안 풀렸으면 그냥 터미널 안내만
  srv.listen(port, host);
  return srv;
}

/** 감시 프로세스 본체. squad.mjs 를 SQUAD_BOARD_CHILD=1 로 다시 실행해 자식 보드를 띄운다. */
export function superviseBoard({ root, port, demo = false, host = '127.0.0.1', script }) {
  const token = randomBytes(24).toString('base64url');
  let child = null;
  let runningHead = '';
  let changedAt = null;
  let failures = 0;
  let lastErr = '';
  let gaveUp = null; // 오류 페이지 서버
  let restarting = false;
  let pollSig = null; // fs.watch 를 못 쓰면 폴링 서명

  const start = () => {
    gaveUp?.close();
    gaveUp = null;
    runningHead = gitHead(root);
    changedAt = null;
    lastErr = '';
    const args = [script, 'board', '--port', String(port), ...(demo ? ['--demo'] : [])];
    child = spawn(process.execPath, args, {
      cwd: process.cwd(),
      env: { ...process.env, SQUAD_BOARD_CHILD: '1', SQUAD_BOARD_TOKEN: token, SQUAD_BOARD_VERSION: runningHead },
      stdio: ['ignore', 'inherit', 'pipe'],
    });
    child.stderr.on('data', (d) => {
      process.stderr.write(d);
      lastErr = (lastErr + d).slice(-4000);
    });
    child.on('exit', (code, signal) => {
      child = null;
      if (restarting) return; // 우리가 끈 것
      failures++;
      const why = `보드 서버가 꺼졌습니다(code ${code ?? signal}).`;
      if (afterCrash(failures) === 'retry') {
        console.error(`${why} ${RETRY_MS / 1000}초 뒤 다시 띄웁니다 (${failures}/${MAX_FAILURES}).`);
        setTimeout(() => { if (!child && !gaveUp) start(); }, RETRY_MS);
      } else {
        console.error(`${why} ${MAX_FAILURES}번 연속 실패 — 코드가 바뀌면 다시 띄웁니다.\n${lastErr}`);
        gaveUp = errorPage(port, host, lastErr || why);
      }
    });
  };

  const restart = (reason) => {
    console.log(`보드 코드가 바뀌어 다시 띄웁니다 (${reason}).`);
    failures = 0;
    if (!child) return start();
    restarting = true;
    child.once('exit', () => { restarting = false; start(); });
    child.kill();
  };

  const onChange = (_, file) => {
    if (!file || isBoardFile(file)) changedAt = Date.now();
  };
  const watchers = [];
  try {
    for (const d of WATCH_DIRS) watchers.push(fs.watch(path.join(root, d), { recursive: true }, onChange));
  } catch {
    for (const w of watchers) w.close();
    watchers.length = 0;
    pollSig = scanSignature(root);
  }

  // ponytail: 2초마다 git rev-parse 한 번. 느리면 .git/HEAD·ref 파일 mtime 으로.
  const tick = setInterval(() => {
    if (restarting) return;
    if (pollSig !== null) {
      const sig = scanSignature(root);
      if (sig !== pollSig) { pollSig = sig; changedAt = Date.now(); }
    }
    const head = gitHead(root);
    if (shouldRestart({ head, runningHead, changedAt, now: Date.now() })) {
      restart(head && head !== runningHead ? `커밋 ${head.slice(0, 7)}` : '파일 변경');
    }
  }, 2000);

  const stop = () => {
    clearInterval(tick);
    for (const w of watchers) w.close();
    gaveUp?.close();
    restarting = true;
    child?.kill();
    process.exit(0);
  };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);

  console.log(`보드 감시 중 — ${WATCH_DIRS.join('/')} 코드가 바뀌면 보드를 다시 띄웁니다 (주소는 그대로).`);
  start();
}
