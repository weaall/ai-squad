// 화면 캡처 — 시스템에 설치된 Chrome/Edge 를 headless 로 띄우고 DevTools 프로토콜을 Node 표준 WebSocket 으로 직접 다룬다.
// 추가 패키지(puppeteer·playwright)는 쓰지 않는다.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { killTree } from './runners/proc.mjs';

/** 찾아볼 브라우저 경로. SQUAD_CHROME 환경 변수가 있으면 그것만. */
export function browserCandidates(env = process.env, platform = process.platform) {
  if (env.SQUAD_CHROME) return [env.SQUAD_CHROME];
  if (platform === 'win32') {
    const roots = [env.PROGRAMFILES, env['PROGRAMFILES(X86)'], env.LOCALAPPDATA].filter(Boolean);
    return roots.flatMap((r) => [path.join(r, 'Google', 'Chrome', 'Application', 'chrome.exe'), path.join(r, 'Microsoft', 'Edge', 'Application', 'msedge.exe')]);
  }
  if (platform === 'darwin') return ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge'];
  return ['/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/microsoft-edge'];
}

export function findBrowser() {
  return browserCandidates().find((p) => {
    try {
      return fs.statSync(p).isFile();
    } catch {
      return false;
    }
  });
}

export const NO_BROWSER = 'Chrome 이나 Edge 를 찾지 못했습니다. 설치하거나 SQUAD_CHROME 환경 변수에 chrome.exe(또는 msedge.exe) 경로를 넣으세요';

/** 캡처 파일 이름: <project>-<member|human>-<시각>.png — 보드가 이 모양만 내준다. */
export const CAPTURE_RE = /^[a-z0-9-]{1,40}-[a-z0-9-]{1,40}-\d{8}-\d{6}(-\d+)?\.png$/;
export function captureName(project, who, at = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${project}-${who}-${at.getFullYear()}${p(at.getMonth() + 1)}${p(at.getDate())}-${p(at.getHours())}${p(at.getMinutes())}${p(at.getSeconds())}.png`;
}

/** CDP 연결: send(method, params, sessionId) → Promise(result), on(method, fn). */
function cdp(wsUrl) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    let n = 0;
    const waits = new Map();
    const subs = [];
    ws.onmessage = (e) => {
      const m = JSON.parse(typeof e.data === 'string' ? e.data : Buffer.from(e.data).toString('utf8'));
      if (m.id && waits.has(m.id)) {
        const w = waits.get(m.id);
        waits.delete(m.id);
        m.error ? w.reject(new Error(`${w.method}: ${m.error.message}`)) : w.resolve(m.result);
      } else if (m.method) for (const s of subs) s(m);
    };
    ws.onerror = () => reject(new Error('DevTools 에 연결하지 못했습니다'));
    ws.onopen = () =>
      resolve({
        send: (method, params = {}, sessionId) =>
          new Promise((res, rej) => {
            const id = ++n;
            waits.set(id, { resolve: res, reject: rej, method });
            ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
          }),
        once: (method, sessionId) => new Promise((res) => subs.push((m) => m.method === method && (!sessionId || m.sessionId === sessionId) && res(m.params))),
        close: () => ws.close(),
      });
  });
}

/**
 * url 을 width×height 로 열어 PNG 를 file 에 쓴다. → { file, bytes }
 * 로드가 끝난 뒤 settleMs 만큼 더 기다린다(화면이 그려질 시간). 전체 시간 제한 timeoutMs.
 */
export async function capture({ url, file, width = 1440, height = 900, settleMs = 1200, timeoutMs = 30000, browser = findBrowser() }) {
  if (!browser) throw new Error(NO_BROWSER);
  if (!/^https?:\/\//.test(url)) throw new Error('주소는 http:// 나 https:// 로 시작해야 합니다');
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'squad-cap-'));
  const child = spawn(browser, [
    '--headless=new', '--remote-debugging-port=0', `--user-data-dir=${profile}`, '--no-first-run', '--no-default-browser-check',
    '--disable-gpu', '--hide-scrollbars', '--mute-audio', `--window-size=${width},${height}`, 'about:blank',
  ], { stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true });
  let timer;
  try {
    const wsUrl = await new Promise((resolve, reject) => {
      let buf = '';
      timer = setTimeout(() => reject(new Error('브라우저가 DevTools 주소를 내놓지 않았습니다')), 15000);
      child.on('error', (e) => reject(new Error(`브라우저를 띄우지 못했습니다: ${e.message}`)));
      child.on('exit', (c) => reject(new Error(`브라우저가 바로 끝났습니다 (${c})`)));
      child.stderr.on('data', (d) => {
        buf += d;
        const m = buf.match(/DevTools listening on (ws:\/\/\S+)/);
        if (m) resolve(m[1]);
      });
    });
    clearTimeout(timer);
    const work = (async () => {
      const c = await cdp(wsUrl);
      const { targetId } = await c.send('Target.createTarget', { url: 'about:blank' });
      const { sessionId } = await c.send('Target.attachToTarget', { targetId, flatten: true });
      await c.send('Page.enable', {}, sessionId);
      await c.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false }, sessionId);
      const loaded = c.once('Page.loadEventFired', sessionId);
      const nav = await c.send('Page.navigate', { url }, sessionId);
      if (nav.errorText) throw new Error(`페이지를 열지 못했습니다: ${nav.errorText}`);
      await loaded;
      await new Promise((r) => setTimeout(r, settleMs));
      const shot = await c.send('Page.captureScreenshot', { format: 'png' }, sessionId);
      await c.send('Browser.close').catch(() => {});
      c.close();
      return Buffer.from(shot.data, 'base64');
    })();
    const png = await Promise.race([work, new Promise((_, rej) => (timer = setTimeout(() => rej(new Error('캡처 시간이 지났습니다')), timeoutMs)))]);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, png);
    return { file, bytes: png.length };
  } finally {
    clearTimeout(timer);
    killTree(child);
    setTimeout(() => fs.rm(profile, { recursive: true, force: true }, () => {}), 500);
  }
}
