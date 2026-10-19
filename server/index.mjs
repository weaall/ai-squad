// 보드 서버 — node 표준 모듈만. 127.0.0.1 에만 묶는다.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import {
  appendJsonl, isId, loadMembers, loadProjects, newId, projectPaths, readJsonl, readMemberDocs, setMemberToggle, updateTask,
} from '../lib/store.mjs';
import { buildState } from '../lib/state.mjs';
import { validateMessage, validateOrder, validatePlan, validateTask, validateTaskPatch } from '../lib/validate.mjs';
import { planOrder, saveOrder } from '../lib/runner.mjs';
import { loadConfig } from '../lib/config.mjs';
import { LOGIN_COMMAND, runnerStatuses } from '../lib/runners/index.mjs';
import { decideApproval, decisionText, loadApprovals } from '../lib/approvals.mjs';

const PUBLIC = path.join(path.dirname(fileURLToPath(import.meta.url)), 'public');
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml' };
const MAX_BODY = 16 * 1024;

function send(res, code, body, type = 'application/json; charset=utf-8', extra = {}) {
  res.writeHead(code, { 'Content-Type': type, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', ...extra });
  res.end(type.startsWith('application/json') ? JSON.stringify(body) : body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY) {
        reject(new Error('요청이 너무 큽니다'));
        req.destroy();
      } else chunks.push(c);
    });
    req.on('end', () => {
      try {
        const v = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        if (!v || typeof v !== 'object' || Array.isArray(v)) throw new Error();
        resolve(v);
      } catch {
        reject(new Error('JSON 객체가 아닙니다'));
      }
    });
    req.on('error', reject);
  });
}

/** 바뀌었는지 볼 파일들의 (수정 시각, 크기) 지문. */
function signature(paths) {
  const files = [paths.tasks, paths.messages, paths.events, paths.approvals, paths.toggles].filter(Boolean);
  try {
    for (const d of fs.readdirSync(paths.members)) {
      if (isId(d)) files.push(path.join(paths.members, d, 'MEMBER.md'), path.join(paths.members, d, 'NOTES.md'));
    }
  } catch {
    // 멤버 폴더가 없으면 그대로
  }
  return files
    .map((f) => {
      try {
        const s = fs.statSync(f);
        return `${s.mtimeMs}:${s.size}`;
      } catch {
        return '-';
      }
    })
    .join('|');
}

/** 쿠키 머리에서 값 하나. */
export function readCookie(header, name) {
  for (const part of String(header || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === name) {
      try {
        return decodeURIComponent(part.slice(i + 1).trim());
      } catch {
        return '';
      }
    }
  }
  return '';
}

const same = (a, b) => {
  const x = Buffer.from(String(a)), y = Buffer.from(String(b));
  return x.length === y.length && timingSafeEqual(x, y);
};

/** 로그인 창: 서버가 보이는 새 콘솔 창을 띄운다. 로그인은 그 창과 브라우저에서 사람이 직접 한다. */
function openLoginWindow() {
  if (process.platform !== 'win32') throw new Error(`이 OS 에서는 터미널에서 직접 ${LOGIN_COMMAND} 를 실행하세요`);
  spawn('cmd.exe', ['/c', 'start', '""', 'cmd', '/k', LOGIN_COMMAND], { windowsVerbatimArguments: true, detached: true, stdio: 'ignore' }).unref();
}

/**
 * planner: 계획을 만드는 함수(기본은 메인 AI 를 부르는 planOrder → {plan, usage}). 시험에서는 가짜를 넣는다.
 * token: 접속 토큰(기본은 시작할 때마다 무작위). openLogin: 로그인 창 띄우기, statuses: runner 연결 상태(시험에서는 가짜).
 */
export function startBoard({
  root, port = 4777, demo = false, host = '127.0.0.1', quiet = false, planner = planOrder,
  token = randomBytes(24).toString('base64url'), openLogin = openLoginWindow, statuses = runnerStatuses,
}) {
  const cookieName = `squad_t_${port}`; // 쿠키는 포트를 가리지 않아서 이름에 포트를 넣는다
  const authed = (req) => same(readCookie(req.headers.cookie, cookieName), token);
  // ponytail: 서버 전체에 계획 1건만. 프로젝트별로 동시에 돌려야 하면 Map 으로.
  let ordering = false;
  const clients = new Set(); // { res, project }
  const sigs = new Map();
  const allowedOrigins = new Set([`http://127.0.0.1:${port}`, `http://localhost:${port}`]);

  const pathsOf = (id) => projectPaths(root, id, { demo });

  function check() {
    for (const id of Object.keys(loadProjects(root))) {
      let s;
      try {
        s = signature(pathsOf(id));
      } catch {
        continue;
      }
      if (sigs.has(id) && sigs.get(id) !== s) {
        for (const c of clients) if (c.project === id) c.res.write(`event: change\ndata: ${JSON.stringify({ project: id, at: Date.now() })}\n\n`);
      }
      sigs.set(id, s);
    }
  }
  check();
  // fs.watch 가 바로 알려 주고, 놓친 변경은 2초 폴링이 잡는다
  let timer = null;
  const soon = () => {
    clearTimeout(timer);
    timer = setTimeout(check, 120);
  };
  const watchers = [];
  const watchDirs = new Set([path.join(root, 'data')]);
  for (const id of Object.keys(loadProjects(root))) {
    try {
      watchDirs.add(pathsOf(id).squad);
    } catch {
      // 등록이 깨진 프로젝트는 폴링만
    }
  }
  for (const d of watchDirs) {
    try {
      fs.mkdirSync(d, { recursive: true });
      watchers.push(fs.watch(d, { recursive: true }, soon));
    } catch {
      // 감시를 못 하면 폴링만
    }
  }
  const poll = setInterval(check, 2000);
  const beat = setInterval(() => {
    for (const c of clients) c.res.write(': ping\n\n');
  }, 15000);

  function state(id) {
    const p = pathsOf(id);
    return buildState({
      project: p, members: loadMembers(p), tasks: readJsonl(p.tasks), messages: readJsonl(p.messages), events: readJsonl(p.events),
      approvals: loadApprovals(p), stale: loadConfig(root).stale, demo,
    });
  }

  async function handle(req, res) {
    // DNS 리바인딩 막기: 주소창 이름이 로컬일 때만 응답
    if (!allowedOrigins.has(`http://${req.headers.host}`)) return send(res, 403, { error: '허용되지 않은 호스트' });
    const url = new URL(req.url, `http://${host}`);
    const project = url.searchParams.get('project') || '';

    // 접속 토큰: ?t= 로 처음 오면 HttpOnly 쿠키로 바꾸고 주소창에서 지운다
    if (req.method === 'GET' && url.searchParams.has('t')) {
      if (!same(url.searchParams.get('t'), token)) return send(res, 401, '접속 토큰이 맞지 않습니다. 보드를 띄운 터미널에 찍힌 주소로 여세요.', 'text/plain; charset=utf-8');
      url.searchParams.delete('t');
      return send(res, 302, '', 'text/plain; charset=utf-8', {
        Location: url.pathname + url.search,
        'Set-Cookie': `${cookieName}=${encodeURIComponent(token)}; HttpOnly; SameSite=Strict; Path=/`,
      });
    }
    if (url.pathname.startsWith('/api/') && !authed(req)) return send(res, 401, { error: '접속 토큰이 필요합니다. 보드를 띄운 터미널에 찍힌 주소(?t=...)로 다시 여세요' });

    if (req.method === 'POST') {
      // 다른 사이트에서 보낸 요청(CSRF)을 막는다
      const origin = req.headers.origin;
      if ((origin && !allowedOrigins.has(origin)) || !String(req.headers['content-type'] || '').startsWith('application/json')) {
        return send(res, 403, { error: '허용되지 않은 요청' });
      }
      const body = await readBody(req);
      if (url.pathname === '/api/runners/login') {
        const cfg = loadConfig(root).runners[body.runner];
        if (!cfg) return send(res, 404, { error: 'runner 가 없습니다' });
        if (cfg.type !== 'claude') return send(res, 400, { error: `키는 터미널에서 넣습니다: node bin/squad.mjs auth set ${body.runner}` });
        try {
          openLogin();
        } catch (e) {
          return send(res, 501, { error: e.message });
        }
        return send(res, 200, { ok: true, command: LOGIN_COMMAND });
      }
      const pid = body.project;
      if (!isId(pid) || !loadProjects(root)[pid]) return send(res, 404, { error: '프로젝트가 없습니다' });
      const p = pathsOf(pid);
      const ids = loadMembers(p).map((m) => m.id);
      const at = new Date().toISOString();
      if (url.pathname === '/api/messages') {
        const v = validateMessage(body, ids);
        if (v.error) return send(res, 400, v);
        return send(res, 201, appendJsonl(p.messages, { id: newId('M'), at, ...v }));
      }
      if (url.pathname === '/api/tasks') {
        const v = validateTask(body, ids);
        if (v.error) return send(res, 400, v);
        return send(res, 201, appendJsonl(p.tasks, { id: newId('T'), ...v, createdBy: 'human', createdAt: at, updatedAt: at, summary: '' }));
      }
      if (url.pathname === '/api/order') {
        const v = validateOrder(body);
        if (v.error) return send(res, 400, v);
        if (ordering) return send(res, 409, { error: '이미 계획을 만드는 중입니다. 끝난 뒤 다시 보내 주세요' });
        ordering = true;
        try {
          const { plan, usage } = await planner({ root, paths: p, members: loadMembers(p), instruction: v.instruction, stderr: 'pipe' });
          appendJsonl(p.events, { at, project: pid, member: 'order', type: 'plan', text: `계획 ${plan.length}개`, ...(usage ? { usage } : {}) });
          if (!plan.length) return send(res, 502, { error: '메인 오더가 배정할 작업을 내놓지 않았습니다. 지시를 더 구체적으로 써 주세요' });
          return send(res, 200, { instruction: v.instruction, plan, usage: usage || null });
        } catch (e) {
          return send(res, 502, { error: `계획을 만들지 못했습니다: ${e.message}` });
        } finally {
          ordering = false;
        }
      }
      if (url.pathname === '/api/order/confirm') {
        const o = validateOrder(body);
        if (o.error) return send(res, 400, o);
        const v = validatePlan(body.plan, ids);
        if (v.error) return send(res, 400, v);
        return send(res, 201, { tasks: saveOrder({ paths: p, members: loadMembers(p), instruction: o.instruction, plan: v.plan }) });
      }
      if (url.pathname === '/api/approvals/decide') {
        if (typeof body.id !== 'string' || body.id.length > 60) return send(res, 400, { error: '승인 요청 id 가 잘못됐습니다' });
        try {
          const d = decideApproval(p, body.id, body.decision, 'human', body.note ?? '');
          const msg = validateMessage({ from: 'human', to: d.from, kind: 'answer', taskId: d.taskId, text: decisionText(d) }, ids);
          if (!msg.error) appendJsonl(p.messages, { id: newId('M'), at, ...msg });
          return send(res, 200, d);
        } catch (e) {
          return send(res, /이미/.test(e.message) ? 409 : 400, { error: e.message });
        }
      }
      if (url.pathname === '/api/member/toggle') {
        const m = loadMembers(p).find((x) => x.id === body.id);
        if (!m) return send(res, 404, { error: '멤버가 없습니다' });
        if (typeof body.on !== 'boolean') return send(res, 400, { error: '켜기·끄기 값이 잘못됐습니다' });
        if (body.kind === 'plugin') {
          if (!m.pluginList.some((x) => x.name === body.name)) return send(res, 400, { error: '그 멤버에게 없는 플러그인입니다' });
        } else if (body.kind !== 'headroom') return send(res, 400, { error: '바꿀 수 있는 것은 plugin 과 headroom 입니다' });
        setMemberToggle(p, m.id, { kind: body.kind, name: body.name, on: body.on });
        const after = loadMembers(p).find((x) => x.id === m.id);
        return send(res, 200, { id: m.id, pluginList: after.pluginList, headroom: after.headroom });
      }
      if (url.pathname === '/api/tasks/update') {
        if (typeof body.id !== 'string' || body.id.length > 60) return send(res, 400, { error: '작업 id 가 잘못됐습니다' });
        const v = validateTaskPatch(body.patch, ids);
        if (v.error) return send(res, 400, v);
        const t = updateTask(p.tasks, body.id, v);
        return t ? send(res, 200, t) : send(res, 404, { error: '작업이 없습니다' });
      }
      return send(res, 404, { error: '없는 경로' });
    }

    if (req.method !== 'GET') return send(res, 405, { error: '지원하지 않는 방식' });

    if (url.pathname === '/api/runners') {
      return send(res, 200, { runners: await statuses(loadConfig(root), { force: url.searchParams.get('refresh') === '1' }) });
    }
    if (url.pathname === '/api/projects') {
      const ps = loadProjects(root);
      return send(res, 200, { demo, projects: Object.entries(ps).map(([id, v]) => ({ id, name: v.name || id })) });
    }
    if (url.pathname.startsWith('/api/')) {
      if (!isId(project) || !loadProjects(root)[project]) return send(res, 404, { error: '프로젝트가 없습니다' });
    }
    if (url.pathname === '/api/state') return send(res, 200, state(project));
    if (url.pathname === '/api/member') {
      const id = url.searchParams.get('id') || '';
      if (!isId(id)) return send(res, 400, { error: '멤버 id 가 잘못됐습니다' });
      return send(res, 200, readMemberDocs(pathsOf(project), id));
    }
    if (url.pathname === '/api/stream') {
      res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-store', Connection: 'keep-alive' });
      res.write(`retry: 2000\nevent: hello\ndata: ${JSON.stringify({ project })}\n\n`);
      const c = { res, project };
      clients.add(c);
      req.on('close', () => clients.delete(c));
      return;
    }
    if (url.pathname.startsWith('/api/')) return send(res, 404, { error: '없는 경로' });

    // 정적 파일 — public 폴더 밖으로 못 나간다
    const rel = url.pathname === '/' ? 'index.html' : decodeURIComponent(url.pathname).replace(/^\/+/, '');
    const file = path.resolve(PUBLIC, rel);
    if (!file.startsWith(PUBLIC + path.sep) || !TYPES[path.extname(file)]) return send(res, 404, '없음', 'text/plain; charset=utf-8');
    fs.readFile(file, (err, data) => (err ? send(res, 404, '없음', 'text/plain; charset=utf-8') : send(res, 200, data, TYPES[path.extname(file)])));
  }

  const server = http.createServer((req, res) => {
    handle(req, res).catch((e) => {
      if (!res.headersSent) send(res, 400, { error: e.message });
    });
  });

  return new Promise((resolve) => {
    server.listen(port, host, () => {
      if (!quiet) {
        console.log(`AI Squad 보드: http://localhost:${port}/?t=${token}${demo ? '  (시연 데이터)' : ''}`);
        console.log('이 주소는 이번 실행에만 맞습니다. 다른 사람에게 보내지 마세요.');
      }
      resolve({
        server,
        token,
        cookieName,
        close() {
          clearInterval(poll);
          clearInterval(beat);
          for (const w of watchers) w.close();
          for (const c of clients) c.res.end();
          return new Promise((r) => server.close(r));
        },
      });
    });
  });
}
