// AI Squad 보드 화면. 프레임워크 없이 상태 하나를 받아 전부 다시 그린다.
const $ = (s) => document.querySelector(s);
const STATUS = { working: '일하는 중', idle: '대기', blocked: '막힘' };
const KIND = { order: '지시', handoff: '인계', question: '질문', answer: '답변', report: '완료 보고', note: '메모' };
const TASK_COLS = [['todo', '할 일'], ['doing', '진행 중'], ['blocked', '막힘'], ['done', '완료']];
const PALETTE = ['#5b6fd6', '#3f8fbf', '#2f9e86', '#8a63d2', '#c2753a', '#c25674', '#4b7bd8', '#6c8a3a', '#9a5bb5'];
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)');

const ui = {
  projects: [],
  project: '',
  data: null,
  view: 'network',
  selected: null,
  openRows: new Set(),
  seenMsgs: null,
  seenEvents: null,
  newMsgIds: new Set(),
};

// ── 도우미 ──
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
function store(key, val) {
  try {
    if (val === undefined) return localStorage.getItem(key);
    localStorage.setItem(key, val);
  } catch {
    return null;
  }
}
function rel(at) {
  const t = typeof at === 'number' ? at : Date.parse(at);
  if (!t) return '';
  const s = Math.max(0, Math.round((Date.now() - t) / 1000));
  if (s < 5) return '방금';
  if (s < 60) return `${s}초 전`;
  if (s < 3600) return `${Math.floor(s / 60)}분 전`;
  if (s < 86400) return `${Math.floor(s / 3600)}시간 전`;
  if (s < 172800) return '어제';
  const d = new Date(t);
  return `${d.getMonth() + 1}월 ${d.getDate()}일`;
}
const fullTime = (at) => new Date(at).toLocaleString('ko-KR');
function colorOf(id) {
  let h = 0;
  for (const c of id) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return PALETTE[h % PALETTE.length];
}
function initials(m) {
  if (m.initials) return m.initials.slice(0, 2);
  const parts = m.id.split('-');
  return (parts.length > 1 ? parts.map((p) => p[0]).join('') : m.id.slice(0, 2)).slice(0, 2).toUpperCase();
}
const member = (id) => ui.data?.members.find((m) => m.id === id);
const nameOf = (id) => (id === 'human' ? '사람' : member(id)?.name || id);
function avatar(id, size = '') {
  if (id === 'human') return `<span class="avatar is-human ${size}" aria-hidden="true">나</span>`;
  const m = member(id) || { id };
  return `<span class="avatar ${size} st-${m.status || 'idle'}" style="--c:${colorOf(id)}" aria-hidden="true">${esc(initials(m))}</span>`;
}
const pill = (s) => `<span class="pill st-${s}"><i class="dot st-${s}"></i>${STATUS[s] || s}</span>`;
const kindTag = (k) => `<span class="kind" style="--kc:var(--k-${esc(k)})">${esc(KIND[k] || k)}</span>`;
function eventLabel(e) {
  if (!e) return '';
  if (e.label) return e.label;
  if (e.type === 'tool') return [e.tool, e.path].filter(Boolean).join(' · ');
  if (e.type === 'start') return `작업 시작${e.text ? ' · ' + e.text : ''}`;
  if (e.type === 'end') return `작업 끝${e.text ? ' · ' + e.text : ''}`;
  return e.text || '';
}
const ICON_CHEV = '<svg class="chev" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg>';
const ICON_ARROW = '<svg class="arrow" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6"/></svg>';

function toast(text) {
  const t = $('#toast');
  t.textContent = text;
  t.hidden = false;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => (t.hidden = true), 2600);
}

async function api(url, body) {
  const res = await fetch(url, body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : undefined);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `요청 실패 (${res.status})`);
  return data;
}

// ── 불러오기·실시간 ──
let loading = null;
async function load() {
  if (loading) return loading;
  loading = (async () => {
    try {
      const data = await api(`/api/state?project=${encodeURIComponent(ui.project)}`);
      const first = ui.seenMsgs === null;
      const fresh = first ? [] : data.messages.filter((m) => !ui.seenMsgs.has(m.id));
      const freshEvents = first ? [] : data.events.filter((e) => !ui.seenEvents.has(evKey(e)));
      ui.seenMsgs = new Set(data.messages.map((m) => m.id));
      ui.seenEvents = new Set(data.events.map(evKey));
      ui.newMsgIds = new Set(fresh.map((m) => m.id));
      ui.data = data;
      render();
      net.sync(data, first);
      for (const m of fresh) net.message(m);
      for (const e of freshEvents) net.event(e);
    } catch (e) {
      toast(e.message);
    } finally {
      loading = null;
    }
  })();
  return loading;
}
const evKey = (e) => `${e.at}|${e.member}|${e.type}|${e.tool || ''}|${e.path || ''}`;

let source = null;
function connect() {
  source?.close();
  source = new EventSource(`/api/stream?project=${encodeURIComponent(ui.project)}`);
  const live = $('#live');
  source.addEventListener('hello', () => {
    live.classList.add('is-on');
    live.lastElementChild.textContent = '실시간';
  });
  source.addEventListener('change', () => load());
  source.onerror = () => {
    live.classList.remove('is-on');
    live.lastElementChild.textContent = '다시 연결 중';
  };
}

// ── 그리기 ──
function render() {
  const d = ui.data;
  if (!d) return;
  $('#demo-badge').hidden = !d.demo;
  $('#stats').innerHTML = [
    ['is-working', '일하는 중', d.counts.working],
    ['', '대기 작업', d.counts.pending],
    ['is-blocked', '막힘', d.counts.blocked],
  ].map(([c, l, n]) => `<span class="stat ${c}">${l} <b>${n}</b></span>`).join('');
  fillSelects();
  renderCards();
  renderRows();
  renderKanban();
  renderConvo();
  if (ui.selected) renderDrawer(false);
}

function fillSelects() {
  const ms = ui.data.members;
  const opts = (list, keep) => list.map(([v, l]) => `<option value="${esc(v)}"${v === keep ? ' selected' : ''}>${esc(l)}</option>`).join('');
  const people = [['human', '사람'], ...ms.map((m) => [m.id, m.name])];
  const sets = [
    ['#task-member', ms.filter((m) => m.id !== 'order').map((m) => [m.id, m.name]), null],
    ['#msg-from', people, 'human'],
    ['#msg-to', people, 'order'],
    ['#filter-member', [['', '전체'], ...ms.map((m) => [m.id, m.name])], ''],
  ];
  for (const [sel, list, def] of sets) {
    const el = $(sel);
    const sig = list.map((x) => x[0]).join(',');
    if (el.dataset.sig === sig) continue;
    const keep = el.value || def;
    el.innerHTML = opts(list, keep);
    el.dataset.sig = sig;
  }
}

function renderCards() {
  const html = ui.data.members.map((m) => {
    const ev = m.lastEvent;
    const chips = [m.model && `<span class="chip is-model">${esc(m.model)}</span>`, m.runner !== 'claude' && `<span class="chip">${esc(m.runner)}</span>`,
      ...m.plugins.slice(0, 3).map((p) => `<span class="chip">${esc(p)}</span>`), m.plugins.length > 3 && `<span class="chip">+${m.plugins.length - 3}</span>`].filter(Boolean).join('');
    return `<button type="button" class="card${ui.selected === m.id ? ' is-selected' : ''}" data-member="${esc(m.id)}">
      <div class="card-head">${avatar(m.id)}<div><div class="card-name">${esc(m.name)}</div><div class="card-id">${esc(m.id)}${m.pending ? ` · 대기 ${m.pending}` : ''}</div></div>${pill(m.status)}</div>
      <div class="card-task${m.current ? '' : ' is-empty'}" title="${esc(m.current)}">${esc(m.current || '맡은 작업 없음')}</div>
      <div class="card-event">${ev ? `<span title="${esc(eventLabel(ev))}">${esc(eventLabel(ev))}</span><time datetime="${esc(ev.at)}" title="${esc(fullTime(ev.at))}">${rel(ev.at)}</time>` : '<span>이벤트 없음</span>'}</div>
      ${m.owns.length ? `<div class="card-owns" title="${esc(m.owns.join('\n'))}">${esc(m.owns.slice(0, 2).join(', '))}${m.owns.length > 2 ? ` 외 ${m.owns.length - 2}` : ''}</div>` : ''}
      ${chips ? `<div class="chips">${chips}</div>` : ''}
    </button>`;
  }).join('');
  $('#cards').innerHTML = html || '<p class="empty">멤버가 없습니다. <code>node bin/squad.mjs init</code> 으로 스쿼드를 만드세요.</p>';
}

function eventList(events, n) {
  const list = events.slice(-n).reverse();
  if (!list.length) return '<p class="empty">이벤트 없음</p>';
  return `<ul class="mini-list">${list.map((e) => `<li><span class="grow" title="${esc(eventLabel(e))}">${esc(eventLabel(e))}</span><time title="${esc(fullTime(e.at))}">${rel(e.at)}</time></li>`).join('')}</ul>`;
}
function taskList(tasks) {
  if (!tasks.length) return '<p class="empty">없음</p>';
  const label = Object.fromEntries(TASK_COLS);
  return `<ul class="mini-list">${tasks.map((t) => `<li><span class="grow" title="${esc(t.detail || t.title)}">${esc(t.title)}</span><span class="tag">${label[t.status]}</span></li>`).join('')}</ul>`;
}
const pathList = (ps) => (ps.length ? `<ul class="paths">${ps.map((p) => `<li class="mono" title="${esc(p)}">${esc(p)}</li>`).join('')}</ul>` : '<p class="empty">없음</p>');

function renderRows() {
  const fs = $('#filter-status').value;
  const fm = $('#filter-member').value;
  const d = ui.data;
  const ms = d.members.filter((m) => (!fs || m.status === fs) && (!fm || m.id === fm));
  $('#rows').innerHTML = ms.map((m) => {
    const ev = m.lastEvent;
    const mine = d.events.filter((e) => e.member === m.id);
    const pending = d.tasks.filter((t) => t.member === m.id && t.status !== 'done');
    return `<details class="row" data-member="${esc(m.id)}"${ui.openRows.has(m.id) ? ' open' : ''}>
      <summary>
        ${avatar(m.id)}
        <span class="row-name">${esc(m.name)}<small>${esc(m.id)}</small></span>
        ${pill(m.status)}
        <span class="row-cell${m.current ? '' : ' is-empty'}" title="${esc(m.current)}">${esc(m.current || '맡은 작업 없음')}</span>
        <span class="row-cell${ev ? '' : ' is-empty'}">${ev ? `${esc(eventLabel(ev))}<time>${rel(ev.at)}</time>` : '이벤트 없음'}</span>
        <span class="row-num" title="대기 작업">${m.pending}</span>
        ${ICON_CHEV}
      </summary>
      <div class="row-body">
        <div>
          <h3>AI·도구</h3>
          <dl class="kv"><dt>실행</dt><dd>${esc(m.runner)}</dd><dt>모델</dt><dd>${esc(m.model || '기본값')}</dd><dt>도구</dt><dd>${esc(m.tools.join(', ') || '기본(Read·Edit·Write·Glob·Grep)')}</dd></dl>
          <h3>플러그인·스킬·MCP</h3>
          ${m.plugins.length ? `<div class="chips" style="margin-bottom:14px">${m.plugins.map((p) => `<span class="chip">${esc(p)}</span>`).join('')}</div>` : '<p class="empty">없음</p>'}
          <h3>담당 경로</h3>${pathList(m.owns)}
        </div>
        <div>
          <h3>대기 작업 ${pending.length}</h3>${taskList(pending)}
          <h3>인계 메모</h3><p class="handoff">${esc(m.handoff || '없음')}</p>
        </div>
        <div>
          <h3>최근 이벤트 10</h3>${eventList(mine, 10)}
          <button type="button" class="btn btn-ghost" data-open="${esc(m.id)}">자세히 보기</button>
        </div>
      </div>
    </details>`;
  }).join('') || '<p class="empty">조건에 맞는 멤버가 없습니다.</p>';
}

function renderKanban() {
  const d = ui.data;
  const memberOpts = (sel) => d.members.filter((m) => m.id !== 'order').map((m) => `<option value="${esc(m.id)}"${m.id === sel ? ' selected' : ''}>${esc(m.name)}</option>`).join('');
  const statusOpts = (sel) => TASK_COLS.map(([v, l]) => `<option value="${v}"${v === sel ? ' selected' : ''}>${l}</option>`).join('');
  $('#kanban').innerHTML = TASK_COLS.map(([s, label]) => {
    let list = d.tasks.filter((t) => t.status === s);
    const total = list.length;
    // 완료는 최근 것만
    if (s === 'done') list = list.slice().sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || '')).slice(0, 8);
    return `<div class="col" data-s="${s}">
      <div class="col-head"><i></i>${label}<span class="count">${total}</span></div>
      ${list.map((t) => `<article class="tcard" data-task="${esc(t.id)}">
        <div class="tcard-title">${esc(t.title)}</div>
        ${t.summary || t.detail ? `<div class="tcard-sum" title="${esc(t.summary || t.detail)}">${esc(t.summary || t.detail)}</div>` : ''}
        <div class="tcard-foot">${avatar(t.member, 'sm')}
          <select class="select" data-field="member" aria-label="담당 바꾸기">${memberOpts(t.member)}</select>
          <select class="select st" data-field="status" aria-label="상태 바꾸기">${statusOpts(t.status)}</select>
        </div>
      </article>`).join('') || '<p class="empty">비어 있음</p>'}
      ${total > list.length ? `<div class="more">${total - list.length}개 더</div>` : ''}
    </div>`;
  }).join('');
}

function renderConvo() {
  const box = $('#convo');
  const nearBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 60;
  const msgs = ui.data.messages.slice(-120);
  $('#convo-count').textContent = ui.data.messages.length ? `${ui.data.messages.length}개` : '';
  box.innerHTML = msgs.map((m) => `<li class="msg${ui.newMsgIds.has(m.id) ? ' is-new' : ''}">
    ${avatar(m.from, 'sm')}
    <div>
      <div class="msg-meta"><b>${esc(nameOf(m.from))}</b>${ICON_ARROW}<b>${esc(nameOf(m.to))}</b>${kindTag(m.kind)}<time title="${esc(fullTime(m.at))}">${rel(m.at)}</time></div>
      <div class="msg-text">${esc(m.text)}</div>
      ${m.taskId ? `<div class="msg-task mono">${esc(m.taskId)}</div>` : ''}
    </div>
  </li>`).join('') || '<li class="empty">아직 주고받은 메시지가 없습니다.<br>아래에서 보내거나 <code>squad msg</code> 로 남기세요.</li>';
  ui.newMsgIds.clear();
  if (nearBottom || !renderConvo.done) box.scrollTop = box.scrollHeight;
  renderConvo.done = true;
}

// ── 오른쪽 패널 ──
function mdToHtml(src) {
  const text = String(src || '').replace(/\r\n/g, '\n').replace(/^---\n[\s\S]*?\n---\n?/, '');
  const inline = (s) => esc(s).replace(/`([^`]+)`/g, '<code>$1</code>').replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  const out = [];
  let list = false;
  let table = null;
  let code = null;
  const flush = () => {
    if (list) out.push('</ul>');
    list = false;
    if (table) out.push(`<table>${table.map((r, i) => `<tr>${r.map((c) => `<${i ? 'td' : 'th'}>${inline(c)}</${i ? 'td' : 'th'}>`).join('')}</tr>`).join('')}</table>`);
    table = null;
  };
  for (const line of text.split('\n')) {
    if (code !== null) {
      if (line.startsWith('```')) {
        out.push(`<pre><code>${esc(code.join('\n'))}</code></pre>`);
        code = null;
      } else code.push(line);
      continue;
    }
    if (line.startsWith('```')) { flush(); code = []; continue; }
    const h = line.match(/^(#{1,4})\s+(.*)/);
    if (h) { flush(); out.push(`<h${h[1].length + 1}>${inline(h[2])}</h${h[1].length + 1}>`); continue; }
    if (/^\s*\|/.test(line)) {
      if (list) { out.push('</ul>'); list = false; }
      if (/^\s*\|[\s:|-]+\|\s*$/.test(line)) continue;
      (table ||= []).push(line.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim()));
      continue;
    }
    const li = line.match(/^\s*[-*]\s+(.*)/);
    if (li) { if (table) flush(); if (!list) { out.push('<ul>'); list = true; } out.push(`<li>${inline(li[1])}</li>`); continue; }
    flush();
    if (line.trim()) out.push(`<p>${inline(line)}</p>`);
  }
  flush();
  if (code) out.push(`<pre><code>${esc(code.join('\n'))}</code></pre>`);
  return out.join('');
}

const docs = new Map();
async function openDrawer(id) {
  ui.selected = id;
  $('#drawer').hidden = false;
  $('#scrim').hidden = false;
  renderDrawer(true);
  renderCards();
  try {
    docs.set(id, await api(`/api/member?project=${encodeURIComponent(ui.project)}&id=${encodeURIComponent(id)}`));
    if (ui.selected === id) renderDrawer(false);
  } catch (e) {
    toast(e.message);
  }
  $('#drawer-close').focus();
}
function closeDrawer() {
  const id = ui.selected;
  ui.selected = null;
  $('#drawer').hidden = true;
  $('#scrim').hidden = true;
  renderCards();
  document.querySelector(`.card[data-member="${CSS.escape(id || '')}"]`)?.focus();
}
function renderDrawer() {
  const m = member(ui.selected);
  if (!m) return closeDrawer();
  const d = ui.data;
  $('#drawer-avatar').innerHTML = avatar(m.id, 'lg');
  $('#drawer-title').textContent = m.name;
  $('#drawer-sub').innerHTML = `${esc(m.id)} · ${pill(m.status)}`;
  const doc = docs.get(m.id);
  const mine = d.tasks.filter((t) => t.member === m.id);
  $('#drawer-body').innerHTML = `
    <section><h3>지금 작업</h3><p class="handoff">${esc(m.current || '맡은 작업 없음')}</p></section>
    <section><h3>AI·플러그인</h3><div class="chips">
      <span class="chip">${esc(m.runner)}</span><span class="chip is-model">${esc(m.model || '기본 모델')}</span>
      ${m.plugins.map((p) => `<span class="chip">${esc(p)}</span>`).join('')}</div></section>
    <section><h3>담당 경로</h3>${pathList(m.owns)}</section>
    <section><h3>작업 ${mine.length}</h3>${taskList(mine.slice().reverse())}</section>
    <section><h3>최근 이벤트 30</h3>${eventList(d.events.filter((e) => e.member === m.id), 30)}</section>
    <details class="doc" open><summary>MEMBER.md</summary><div class="md">${doc ? mdToHtml(doc.member) : '<p class="muted">불러오는 중</p>'}</div></details>
    <details class="doc"><summary>NOTES.md</summary><div class="md">${doc ? mdToHtml(doc.notes) || '<p class="muted">비어 있음</p>' : ''}</div></details>`;
}

// ── 연결 보기 캔버스 ──
const net = (() => {
  const canvas = $('#net');
  const wrap = $('#canvas-wrap');
  const tip = $('#canvas-tip');
  const ctx = canvas.getContext('2d');
  let W = 0, H = 0, dpr = 1;
  let nodes = new Map(); // id → {x, y, r, m}
  const links = new Map(); // "a|b" → {a, b, at, count, kind}
  let particles = [];
  let ripples = [];
  let hover = null;
  let raf = 0;
  let bg = null;
  const font = getComputedStyle(document.body).fontFamily;
  const KC = { order: '#9fb0ff', handoff: '#f2b64c', question: '#5cc8f2', answer: '#45d6a6', report: '#b78cff', note: '#aab4cc' };
  const SC = { working: '#45d6a6', idle: '#5f6b8f', blocked: '#ff7b7b' };

  function layout() {
    const ms = ui.data?.members || [];
    const next = new Map();
    const cx = W / 2, cy = H / 2 + 6;
    const ring = ms.filter((m) => m.id !== 'order');
    const rx = Math.min(W * 0.38, 470), ry = Math.min(H * 0.36, 230);
    const small = W < 640;
    const order = ms.find((m) => m.id === 'order');
    if (order) next.set('order', { x: cx, y: cy, r: small ? 26 : 34, m: order });
    ring.forEach((m, i) => {
      const a = -Math.PI / 2 + (i + 0.5) * ((Math.PI * 2) / ring.length);
      next.set(m.id, { x: cx + Math.cos(a) * rx, y: cy + Math.sin(a) * ry, r: small ? 19 : 25, m });
    });
    next.set('human', { x: small ? 34 : 64, y: small ? 34 : 52, r: small ? 15 : 18, m: { id: 'human', name: '사람', status: 'idle' } });
    nodes = next;
  }

  function resize() {
    const r = wrap.getBoundingClientRect();
    if (!r.width || !r.height) return; // 숨겨진 보기에서는 그리지 않는다
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    W = r.width;
    H = r.height;
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    // 배경(점 격자)은 미리 한 번만 그린다
    bg = document.createElement('canvas');
    bg.width = canvas.width;
    bg.height = canvas.height;
    const b = bg.getContext('2d');
    b.scale(dpr, dpr);
    const g = b.createRadialGradient(W / 2, H / 2, 0, W / 2, H / 2, Math.max(W, H) * 0.7);
    g.addColorStop(0, '#111a3a');
    g.addColorStop(1, '#070b18');
    b.fillStyle = g;
    b.fillRect(0, 0, W, H);
    b.fillStyle = 'rgba(255,255,255,0.045)';
    for (let x = 12; x < W; x += 24) for (let y = 12; y < H; y += 24) b.fillRect(x, y, 1, 1);
    layout();
    draw(performance.now());
  }

  const key = (a, b) => [a, b].sort().join('|');
  function curve(a, b) {
    const A = nodes.get(a), B = nodes.get(b);
    if (!A || !B) return null;
    const mx = (A.x + B.x) / 2, my = (A.y + B.y) / 2;
    const center = a === 'order' || b === 'order';
    // 멤버끼리는 가운데를 피해 바깥으로 살짝 휘게
    const k = center ? 0 : -0.28;
    const cx = W / 2, cy = H / 2;
    return { A, B, c: { x: mx + (mx - cx) * -k, y: my + (my - cy) * -k } };
  }
  const at = (q, t) => {
    const u = 1 - t;
    return { x: u * u * q.A.x + 2 * u * t * q.c.x + t * t * q.B.x, y: u * u * q.A.y + 2 * u * t * q.c.y + t * t * q.B.y };
  };

  function sync(data, first) {
    layout();
    if (first) {
      // 처음 열 때: 최근 2분 안의 대화 선만 켜 둔다 (흐름 애니메이션은 새 메시지부터)
      const since = Date.now() - 120000;
      for (const m of data.messages) {
        const t = Date.parse(m.at);
        if (t > since) touch(m, t);
      }
    }
    canvas.setAttribute('aria-label', `스쿼드 연결 그림: 멤버 ${data.members.length}명, 일하는 중 ${data.counts.working}명`);
    kick();
  }
  function touch(m, t = Date.now()) {
    if (!nodes.has(m.from) || !nodes.has(m.to) || m.from === m.to) return;
    const k = key(m.from, m.to);
    const l = links.get(k) || { a: m.from, b: m.to, count: 0 };
    l.at = t;
    l.count++;
    l.kind = m.kind;
    links.set(k, l);
  }
  function message(m) {
    touch(m);
    if (reduceMotion.matches || !nodes.has(m.from) || !nodes.has(m.to)) return kick();
    const now = performance.now();
    for (let i = 0; i < 6; i++) particles.push({ from: m.from, to: m.to, t0: now + i * 110, dur: 1500, kind: m.kind, lead: i === 0 });
    kick();
  }
  function event(e) {
    if (reduceMotion.matches || !nodes.has(e.member)) return;
    if (e.type === 'tool' || e.type === 'start' || e.type === 'log') ripples.push({ id: e.member, t0: performance.now(), dur: 1000, color: e.type === 'tool' ? '#ffffff' : SC.working });
    kick();
  }

  function draw(now) {
    if (!W) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.drawImage(bg, 0, 0, W, H);
    const wall = Date.now();
    const still = reduceMotion.matches;

    // 기본 바큇살
    const order = nodes.get('order');
    if (order) {
      ctx.lineWidth = 1;
      ctx.strokeStyle = 'rgba(255,255,255,0.07)';
      for (const [id, n] of nodes) {
        if (id === 'order' || id === 'human') continue;
        ctx.beginPath();
        ctx.moveTo(order.x, order.y);
        ctx.lineTo(n.x, n.y);
        ctx.stroke();
      }
    }

    // 대화한 선: 밝게 남았다가 서서히 옅어진다. 움직임 줄이기면 굵기로만 표시
    for (const l of links.values()) {
      const q = curve(l.a, l.b);
      if (!q) continue;
      const age = wall - l.at;
      let alpha, width;
      if (still) {
        if (age > 600000) continue;
        alpha = 0.5;
        width = 1 + Math.min(l.count, 6) * 0.7;
      } else {
        const f = Math.exp(-age / 14000);
        if (f < 0.02) continue;
        alpha = 0.1 + 0.75 * f;
        width = 1 + 1.8 * f;
      }
      ctx.save();
      ctx.strokeStyle = `rgba(255,255,255,${alpha})`;
      ctx.lineWidth = width;
      if (!still) {
        ctx.shadowColor = 'rgba(200,215,255,0.9)';
        ctx.shadowBlur = 10 * alpha;
      }
      ctx.beginPath();
      ctx.moveTo(q.A.x, q.A.y);
      ctx.quadraticCurveTo(q.c.x, q.c.y, q.B.x, q.B.y);
      ctx.stroke();
      ctx.restore();
    }

    // 빛 알갱이
    particles = particles.filter((p) => now - p.t0 < p.dur + 40);
    for (const p of particles) {
      const t = (now - p.t0) / p.dur;
      if (t < 0 || t > 1) {
        if (t > 1 && p.lead && !p.done) {
          p.done = true;
          ripples.push({ id: p.to, t0: now, dur: 900, color: KC[p.kind] || '#fff' });
        }
        continue;
      }
      const q = curve(p.from, p.to);
      if (!q) continue;
      const e = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
      for (let j = 6; j >= 0; j--) {
        const tt = Math.max(0, e - j * 0.018);
        const pt = at(q, tt);
        const a = (1 - j / 7) * (p.lead ? 1 : 0.6);
        ctx.beginPath();
        ctx.fillStyle = j === 0 ? `rgba(255,255,255,${a})` : `rgba(210,222,255,${a * 0.5})`;
        ctx.arc(pt.x, pt.y, j === 0 ? (p.lead ? 3.2 : 2.2) : 2 - j * 0.2, 0, Math.PI * 2);
        ctx.fill();
      }
      const head = at(q, e);
      const g = ctx.createRadialGradient(head.x, head.y, 0, head.x, head.y, p.lead ? 16 : 10);
      g.addColorStop(0, hexA(KC[p.kind] || '#ffffff', 0.55));
      g.addColorStop(1, hexA(KC[p.kind] || '#ffffff', 0));
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(head.x, head.y, p.lead ? 16 : 10, 0, Math.PI * 2);
      ctx.fill();
    }

    // 파동
    ripples = ripples.filter((r) => now - r.t0 < r.dur);
    for (const r of ripples) {
      const n = nodes.get(r.id);
      if (!n) continue;
      const t = (now - r.t0) / r.dur;
      ctx.beginPath();
      ctx.strokeStyle = hexA(r.color, 0.7 * (1 - t));
      ctx.lineWidth = 2 * (1 - t) + 0.5;
      ctx.arc(n.x, n.y, n.r + 4 + t * 22, 0, Math.PI * 2);
      ctx.stroke();
    }

    // 노드
    for (const [id, n] of nodes) {
      const m = n.m;
      const st = m.status || 'idle';
      if (st === 'working' && !still) {
        const s = (Math.sin(now / 420) + 1) / 2;
        const g = ctx.createRadialGradient(n.x, n.y, n.r, n.x, n.y, n.r + 14 + s * 8);
        g.addColorStop(0, hexA(SC.working, 0.35 + s * 0.2));
        g.addColorStop(1, hexA(SC.working, 0));
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(n.x, n.y, n.r + 22, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.beginPath();
      ctx.fillStyle = id === 'human' ? '#1b2546' : colorOf(id);
      ctx.arc(n.x, n.y, n.r, 0, Math.PI * 2);
      ctx.fill();
      ctx.lineWidth = id === hover ? 3.5 : 2.5;
      ctx.strokeStyle = id === hover ? '#ffffff' : SC[st];
      ctx.beginPath();
      ctx.arc(n.x, n.y, n.r + 3, 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillStyle = '#fff';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.font = `800 ${Math.round(n.r * (id === 'human' ? 0.62 : 0.56))}px ${font}`;
      ctx.fillText(id === 'human' ? '나' : initials(m), n.x, n.y + 1);
      ctx.font = `700 ${W < 640 ? 11 : 12.5}px ${font}`;
      ctx.fillStyle = '#e8ecf8';
      ctx.fillText(m.name, n.x, n.y + n.r + 16);
      if (id !== 'human' && W >= 640) {
        ctx.font = `500 11.5px ${font}`;
        ctx.fillStyle = st === 'blocked' ? '#ff9b9b' : '#8d99bb';
        ctx.fillText(clip(m.current || STATUS[st], 18), n.x, n.y + n.r + 32);
      }
    }
  }
  const clip = (s, n) => ([...s].length > n ? [...s].slice(0, n - 1).join('') + '…' : s);
  function hexA(hex, a) {
    const h = hex.replace('#', '');
    const n = parseInt(h.length === 3 ? h.replace(/./g, '$&$&') : h, 16);
    return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
  }

  // 움직일 것이 있을 때만 프레임을 돈다
  function busy() {
    if (reduceMotion.matches) return false;
    const wall = Date.now();
    return particles.length || ripples.length || [...nodes.values()].some((n) => n.m.status === 'working') || [...links.values()].some((l) => wall - l.at < 60000);
  }
  function loop(now) {
    raf = 0;
    if (ui.view !== 'network' || document.hidden) return;
    draw(now);
    if (busy()) raf = requestAnimationFrame(loop);
  }
  function kick() {
    if (!raf) raf = requestAnimationFrame(loop);
  }

  function hit(e) {
    const r = canvas.getBoundingClientRect();
    const x = e.clientX - r.left, y = e.clientY - r.top;
    for (const [id, n] of nodes) if (Math.hypot(n.x - x, n.y - y) <= n.r + 6) return { id, n };
    return null;
  }
  canvas.addEventListener('mousemove', (e) => {
    const h = hit(e);
    const id = h?.id || null;
    canvas.style.cursor = h && id !== 'human' ? 'pointer' : 'default';
    if (h) {
      const m = h.n.m;
      tip.hidden = false;
      tip.style.left = `${h.n.x}px`;
      tip.style.top = `${h.n.y - h.n.r}px`;
      tip.textContent = id === 'human' ? '사람 (나)' : `${m.name} · ${STATUS[m.status]}${m.lastEvent ? ' · ' + eventLabel(m.lastEvent) : ''}`;
    } else tip.hidden = true;
    if (id !== hover) {
      hover = id;
      draw(performance.now());
    }
  });
  canvas.addEventListener('mouseleave', () => {
    hover = null;
    tip.hidden = true;
    draw(performance.now());
  });
  canvas.addEventListener('click', (e) => {
    const h = hit(e);
    if (h && h.id !== 'human') openDrawer(h.id);
  });
  new ResizeObserver(resize).observe(wrap);
  document.addEventListener('visibilitychange', kick);
  reduceMotion.addEventListener?.('change', kick);
  // 선이 옅어지는 것을 움직임 줄이기에서도 가끔 다시 그린다
  setInterval(() => ui.view === 'network' && draw(performance.now()), 5000);
  return { sync, message, event, kick, resize };
})();

// ── 이벤트 연결 ──
function setView(v) {
  ui.view = v;
  store('squad.view', v);
  for (const b of document.querySelectorAll('.seg-btn')) b.setAttribute('aria-selected', String(b.dataset.view === v));
  $('#view-network').hidden = v !== 'network';
  $('#view-monitor').hidden = v !== 'monitor';
  if (v === 'network') requestAnimationFrame(() => net.resize());
}
for (const b of document.querySelectorAll('.seg-btn')) b.addEventListener('click', () => setView(b.dataset.view));

$('#theme-toggle').addEventListener('click', () => {
  const t = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
  document.documentElement.dataset.theme = t;
  store('squad.theme', t);
});

$('#project-select').addEventListener('change', (e) => {
  ui.project = e.target.value;
  store('squad.project', ui.project);
  ui.seenMsgs = null;
  ui.selected = null;
  closeDrawer();
  connect();
  load();
});

$('#cards').addEventListener('click', (e) => {
  const c = e.target.closest('[data-member]');
  if (c) openDrawer(c.dataset.member);
});
$('#rows').addEventListener('toggle', (e) => {
  const id = e.target.dataset?.member;
  if (!id) return;
  if (e.target.open) ui.openRows.add(id);
  else ui.openRows.delete(id);
}, true);
$('#rows').addEventListener('click', (e) => {
  const b = e.target.closest('[data-open]');
  if (b) openDrawer(b.dataset.open);
});
$('#filter-status').addEventListener('change', renderRows);
$('#filter-member').addEventListener('change', renderRows);
$('#drawer-close').addEventListener('click', closeDrawer);
$('#scrim').addEventListener('click', closeDrawer);
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && ui.selected) closeDrawer();
});

$('#kanban').addEventListener('change', async (e) => {
  const sel = e.target.closest('select[data-field]');
  const card = e.target.closest('[data-task]');
  if (!sel || !card) return;
  try {
    await api('/api/tasks/update', { project: ui.project, id: card.dataset.task, patch: { [sel.dataset.field]: sel.value } });
    toast(sel.dataset.field === 'member' ? '담당을 바꿨습니다' : '상태를 바꿨습니다');
    load();
  } catch (err) {
    toast(err.message);
    load();
  }
});

$('#task-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const title = $('#task-title').value.trim();
  if (!title) return;
  try {
    await api('/api/tasks', { project: ui.project, title, member: $('#task-member').value });
    $('#task-title').value = '';
    toast('작업을 추가했습니다');
    load();
  } catch (err) {
    toast(err.message);
  }
});

async function sendMsg(e) {
  e?.preventDefault();
  const text = $('#msg-text').value.trim();
  const err = $('#msg-error');
  err.textContent = '';
  if (!text) return;
  try {
    await api('/api/messages', { project: ui.project, from: $('#msg-from').value, to: $('#msg-to').value, kind: $('#msg-kind').value, text });
    $('#msg-text').value = '';
    load();
  } catch (x) {
    err.textContent = x.message;
  }
}
$('#msg-form').addEventListener('submit', sendMsg);
$('#msg-text').addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) sendMsg(e);
});

// 상대 시간("12초 전")을 주기적으로 새로 그린다
setInterval(() => {
  if (ui.data && !document.hidden) {
    renderCards();
    if (ui.view === 'monitor') renderRows();
  }
}, 10000);

// ── 시작 ──
(async () => {
  setView(store('squad.view') === 'monitor' ? 'monitor' : 'network');
  try {
    const { projects } = await api('/api/projects');
    ui.projects = projects;
    const saved = store('squad.project');
    ui.project = projects.some((p) => p.id === saved) ? saved : projects[0]?.id || '';
    $('#project-select').innerHTML = projects.map((p) => `<option value="${esc(p.id)}"${p.id === ui.project ? ' selected' : ''}>${esc(p.name)}</option>`).join('');
    if (!ui.project) return toast('등록된 프로젝트가 없습니다');
    connect();
    await load();
  } catch (e) {
    toast(e.message);
  }
})();
