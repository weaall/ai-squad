// AI Squad 보드 화면. 프레임워크 없이 상태 하나를 받아 전부 다시 그린다.
import { SIZE, character, drawCharacter } from './pixel.js';
const $ = (s) => document.querySelector(s);
const STATUS = { working: '일하는 중', idle: '대기', blocked: '막힘' };
const KIND = { order: '지시', handoff: '인계', question: '질문', answer: '답변', report: '완료 보고', note: '메모' };
const TASK_COLS = [['todo', '할 일'], ['doing', '진행 중'], ['blocked', '막힘'], ['done', '완료']];
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)');
const ACTION = { push: 'push', deploy: '배포', migrate: 'DB 마이그레이션', send: '외부 발송', delete: '삭제' };
const LITE_MEMBERS = 12; // 이보다 많으면 저절로 가벼운 효과
const MAX_PARTICLES = 30;
const MAX_RIPPLES = 12;

const ui = {
  projects: [],
  project: '',
  data: null,
  view: 'network',
  tab: 'squad',
  selected: null,
  openRows: new Set(),
  techOpen: null, // 사용 기술 팝오버가 열린 멤버 id
  runners: [],
  later: new Set(), // 확인 모달에서 [나중에]로 미룬 것
  seenConfirm: new Set(), // 이미 한 번 띄운 확인 — 새로 들어온 것만 모달을 연다
  frame: 0,
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
const member = (id) => ui.data?.members.find((m) => m.id === id);
const nameOf = (id) => (id === 'human' ? '사람' : member(id)?.name || id);
// 아바타 = 픽셀 캐릭터. 빈 canvas 를 넣고 paintSprites() 가 그린다.
function avatar(id, size = '') {
  if (id === 'human') return `<span class="avatar is-human ${size}" aria-hidden="true">나</span>`;
  const m = member(id) || { id };
  return `<span class="avatar ${size} st-${m.status || 'idle'}" aria-hidden="true"><canvas class="sprite" width="${SIZE}" height="${SIZE}" data-sprite="${esc(id)}"></canvas></span>`;
}
/** 화면의 모든 캐릭터를 지금 프레임으로 그린다. 움직임 줄이기면 늘 0 프레임. */
function paintSprites() {
  const frame = lite() ? 0 : ui.frame;
  for (const c of document.querySelectorAll('canvas[data-sprite]')) {
    const id = c.dataset.sprite;
    const st = member(id)?.status || 'idle';
    const key = `${st}|${frame}`;
    if (c.dataset.drawn === key) continue;
    const ctx = c.getContext('2d');
    ctx.clearRect(0, 0, SIZE, SIZE);
    drawCharacter(ctx, character(id, { status: st, frame }), 0, 0, 1);
    c.dataset.drawn = key;
  }
}
// 켜고 끌 수 있는 기술 = 플러그인·스킬·MCP + headroom
const techOn = (m) => (m.pluginList || []).filter((p) => p.on).length + (m.headroom ? 1 : 0);
const techAll = (m) => (m.pluginList || []).length + 1;
const techCount = (m) => `${techOn(m)} / ${techAll(m)}`;
const fmtTok = (n) => (n || 0).toLocaleString('ko-KR');
const usageTotal = (u) => (u ? (u.input || 0) + (u.output || 0) + (u.cacheRead || 0) + (u.cacheWrite || 0) : 0);
function techBlock(m) {
  const sw = (kind, name, on, label) =>
    `<label class="switch"><input type="checkbox" role="switch" data-toggle="${kind}" data-member="${esc(m.id)}" data-name="${esc(name)}"${on ? ' checked' : ''}><span class="switch-ui" aria-hidden="true"></span><span class="switch-label" title="${esc(label)}">${esc(label)}</span></label>`;
  return `<dl class="kv"><dt>실행</dt><dd>${esc(m.runner)}</dd><dt>모델</dt><dd>${esc(m.model || '기본값')}</dd><dt>도구</dt><dd>${esc(m.tools.join(', ') || '기본(Read·Edit·Write·Glob·Grep)')}</dd></dl>
    <p class="muted small">켜진 것만 실행 프롬프트에 들어갑니다</p>
    <div class="switches">${sw('headroom', '', m.headroom, 'headroom (토큰 압축으로 감싸기)')}${(m.pluginList || []).map((p) => sw('plugin', p.name, p.on, p.name)).join('')}</div>
    ${(m.pluginList || []).length ? '' : '<p class="muted small">플러그인·스킬·MCP 없음</p>'}`;
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
  if (res.status === 401) {
    // 접속 토큰(쿠키)이 없다 — 터미널에 찍힌 ?t= 주소로 다시 열어야 한다
    $('#auth-banner').hidden = false;
    source?.close();
  }
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
      syncConfirm();
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
  const tt = d.tokensToday || { total: 0 };
  $('#stats').innerHTML = [
    ['is-working', '일하는 중', d.counts.working],
    ['', '대기 작업', d.counts.pending],
    ['is-blocked', '막힘', d.counts.blocked],
    ['', '오늘 토큰', fmtTok(tt.total), `입력 ${fmtTok(tt.input)} · 출력 ${fmtTok(tt.output)} · 캐시 읽기 ${fmtTok(tt.cacheRead)} · 캐시 쓰기 ${fmtTok(tt.cacheWrite)}${tt.costUsd !== undefined ? ` · $${tt.costUsd}` : ''}`],
  ].map(([c, l, n, t]) => `<span class="stat ${c}"${t ? ` title="${esc(t)}"` : ''}>${l} <b>${n}</b></span>`).join('');
  applyFx();
  fillSelects();
  renderApprovals();
  renderCards();
  refreshTech();
  renderRows();
  renderKanban();
  renderConvo();
  const empty = !d.demo && !d.messages.length && !d.tasks.length && !d.events.length;
  $('#net-empty').hidden = !empty;
  if (ui.selected) renderModal();
  paintSprites();
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
    const open = ui.techOpen === m.id;
    return `<article class="card st-${m.status}${m.stalled ? ' is-stalled' : ''}${ui.selected === m.id ? ' is-selected' : ''}" data-member="${esc(m.id)}">
      <div class="card-head">${avatar(m.id)}
        <div class="card-who"><button type="button" class="link card-name" data-open="${esc(m.id)}">${esc(m.name)}</button>
        <div class="card-id">${esc(m.id)}${m.pending ? ` · 대기 ${m.pending}` : ''}${flags(m)}</div></div>${pill(m.status)}</div>
      <button type="button" class="card-task${m.current ? '' : ' is-empty'}" data-open="${esc(m.id)}" aria-label="${esc(m.name)} 자세히: ${esc(m.current || '맡은 작업 없음')}">${esc(m.current || '맡은 작업 없음')}</button>
      <div class="card-event">${ev ? `<span title="${esc(eventLabel(ev))}">${esc(eventLabel(ev))}</span><time datetime="${esc(ev.at)}" title="${esc(fullTime(ev.at))}">${rel(ev.at)}</time>` : '<span>이벤트 없음</span>'}</div>
      <div class="card-foot">
        <button type="button" class="tech-toggle" data-tech="${esc(m.id)}" aria-expanded="${open}" aria-haspopup="dialog" aria-controls="tech-pop">켜진 기술 ${techCount(m)} ${ICON_CHEV}</button>
        <span class="tok" title="이번 작업에 쓴 토큰(입력·출력·캐시). 오늘 ${fmtTok(m.tokens?.today)} · 누적 ${fmtTok(m.tokens?.all)}">이번 작업 ${fmtTok(m.tokens?.task)}토큰</span>
      </div>
    </article>`;
  }).join('');
  $('#cards').innerHTML = html || '<p class="empty">멤버가 없습니다. <code>node bin/squad.mjs init</code> 으로 스쿼드를 만드세요.</p>';
}

/** 뒤처짐 표시: 멈춤, 답 없는 인계 */
const flags = (m) =>
  (m.stalled ? '<span class="flag is-stalled" title="할 일이 있는데 오래 움직이지 않았습니다">멈춤</span>' : '') +
  (m.unanswered ? `<span class="flag is-wait" title="받은 인계·질문에 오래 답하지 않았습니다">답 없는 인계 ${m.unanswered}</span>` : '');

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
        <span class="row-name">${esc(m.name)}<small>${esc(m.id)}${flags(m)}</small></span>
        ${pill(m.status)}
        <span class="row-cell${m.current ? '' : ' is-empty'}" title="${esc(m.current)}">${esc(m.current || '맡은 작업 없음')}</span>
        <span class="row-cell${ev ? '' : ' is-empty'}">${ev ? `${esc(eventLabel(ev))}<time>${rel(ev.at)}</time>` : '이벤트 없음'}</span>
        <span class="row-num" title="대기 작업">${m.pending}</span>
        ${ICON_CHEV}
      </summary>
      <div class="row-body">
        <div>
          <h3>켜진 기술 ${techCount(m)}</h3>${techBlock(m)}
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
        ${t.usage ? `<div class="tok" title="이 작업에 쓴 토큰">${fmtTok(usageTotal(t.usage))}토큰</div>` : ''}
        <div class="tcard-foot">${avatar(t.member, 'sm')}
          <select class="select" data-field="member" aria-label="담당 바꾸기">${memberOpts(t.member)}</select>
          <select class="select st" data-field="status" aria-label="상태 바꾸기">${statusOpts(t.status)}</select>
        </div>
      </article>`).join('') || `<p class="empty">${!d.tasks.length && s === 'todo' ? '아직 작업이 없습니다 — 위 지시 창에 첫 지시를 입력하세요' : '비어 있음'}</p>`}
      ${total > list.length ? `<div class="more">${total - list.length}개 더</div>` : ''}
    </div>`;
  }).join('');
}

function renderConvo() {
  const box = $('#convo');
  const nearBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 60;
  const msgs = ui.data.messages.slice(-120);
  const wait = new Set(ui.data.unanswered || []);
  $('#convo-count').innerHTML = (ui.data.messages.length ? `${ui.data.messages.length}개` : '') + (wait.size ? ` <span class="flag is-wait">답 없는 인계 ${wait.size}</span>` : '');
  box.innerHTML = msgs.map((m) => `<li class="msg${ui.newMsgIds.has(m.id) ? ' is-new' : ''}${wait.has(m.id) ? ' is-wait' : ''}">
    ${avatar(m.from, 'sm')}
    <div>
      <div class="msg-meta"><b>${esc(nameOf(m.from))}</b>${ICON_ARROW}<b>${esc(nameOf(m.to))}</b>${kindTag(m.kind)}${wait.has(m.id) ? '<span class="flag is-wait">답 없는 인계</span>' : ''}<time title="${esc(fullTime(m.at))}">${rel(m.at)}</time></div>
      <div class="msg-text">${esc(m.text)}</div>
      ${m.taskId ? `<div class="msg-task mono">${esc(m.taskId)}</div>` : ''}
    </div>
  </li>`).join('') || '<li class="empty">아직 기록이 없습니다 — 위 지시 창에 첫 지시를 입력하세요.<br>아래에서 메시지를 보내거나 <code>squad msg</code> 로 남길 수도 있습니다.</li>';
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
// ── 멤버 상세 모달 (native dialog: Esc·바깥 클릭·닫기 단추, 바깥은 inert) ──
const modal = $('#modal');
let opener = null;
async function openModal(id) {
  if (!member(id)) return;
  opener = document.activeElement;
  ui.selected = id;
  renderModal();
  if (!modal.open) modal.showModal();
  $('#modal-close').focus();
  try {
    docs.set(id, await api(`/api/member?project=${encodeURIComponent(ui.project)}&id=${encodeURIComponent(id)}`));
    if (ui.selected === id) renderModal();
  } catch (e) {
    toast(e.message);
  }
}
function closeModal() {
  if (modal.open) modal.close();
}
modal.addEventListener('close', () => {
  ui.selected = null;
  modal.dataset.html = '';
  if (opener?.isConnected) opener.focus();
  else if (opener?.dataset?.open) document.querySelector(`[data-open="${CSS.escape(opener.dataset.open)}"]`)?.focus();
});
// 바깥(배경) 클릭: dialog 자체를 누른 경우만 닫는다 — 안쪽 상자는 .modal-box
modal.addEventListener('click', (e) => {
  if (e.target === modal) closeModal();
});
// 포커스를 모달 안에서만 돌린다
modal.addEventListener('keydown', (e) => {
  if (e.key !== 'Tab') return;
  const f = [...modal.querySelectorAll('button, [href], summary, select, input, textarea, [tabindex]:not([tabindex="-1"])')].filter((el) => !el.disabled && el.offsetParent !== null);
  if (!f.length) return;
  const first = f[0], last = f.at(-1);
  if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
  else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
});
$('#modal-close').addEventListener('click', closeModal);

function renderModal() {
  const m = member(ui.selected);
  if (!m) return closeModal();
  const d = ui.data;
  const doc = docs.get(m.id);
  const queued = d.tasks.filter((t) => t.member === m.id && t.status !== 'done');
  const html = `
    <div class="modal-grid">
      <div>
        <section><h3>역할</h3><p class="handoff">${esc(m.role || '적힌 역할이 없습니다')}</p></section>
        <section><h3>지금 작업</h3><p class="handoff full">${esc(m.current || '맡은 작업 없음')}</p></section>
        <section><h3>대기 작업 ${queued.length}</h3>${taskList(queued)}</section>
        <section><h3>인계 메모</h3><p class="handoff">${esc(m.handoff || '없음')}</p></section>
      </div>
      <div>
        <section><h3>최근 이벤트</h3>${eventList(d.events.filter((e) => e.member === m.id), 15)}</section>
        <section><h3>담당 경로</h3>${pathList(m.owns)}</section>
        <section><h3>켜진 기술 ${techCount(m)}</h3>${techBlock(m)}</section>
      </div>
    </div>
    <details class="doc"><summary>MEMBER.md 원문</summary><div class="md">${doc ? mdToHtml(doc.member) : '<p class="muted">불러오는 중</p>'}</div></details>
    <details class="doc"><summary>NOTES.md 원문</summary><div class="md">${doc ? mdToHtml(doc.notes) || '<p class="muted">비어 있음</p>' : ''}</div></details>`;
  const head = `${m.id}|${m.status}|${m.name}`;
  // 같은 내용이면 다시 그리지 않는다(읽는 중 펼친 원문·스크롤 유지)
  if (modal.dataset.html === html + head) return;
  const openDocs = [...modal.querySelectorAll('details.doc')].map((x) => x.open);
  modal.dataset.html = html + head;
  $('#modal-avatar').innerHTML = avatar(m.id, 'lg');
  $('#modal-title').textContent = m.name;
  $('#modal-sub').innerHTML = `${esc(m.id)} · ${pill(m.status)}`;
  $('#modal-body').innerHTML = html;
  modal.querySelectorAll('details.doc').forEach((x, i) => (x.open = Boolean(openDocs[i])));
  paintSprites();
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
    if (order) next.set('order', { x: cx, y: cy, r: small ? 26 : 36, m: order });
    ring.forEach((m, i) => {
      const a = -Math.PI / 2 + (i + 0.5) * ((Math.PI * 2) / ring.length);
      next.set(m.id, { x: cx + Math.cos(a) * rx, y: cy + Math.sin(a) * ry, r: small ? 20 : 28, m });
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
  // 빛 알갱이는 동시에 MAX_PARTICLES 개까지(넘치면 오래된 것부터 버린다). 가벼운 효과면 메시지마다 1개.
  function message(m) {
    touch(m);
    if (reduceMotion.matches || !nodes.has(m.from) || !nodes.has(m.to)) return kick();
    const now = performance.now();
    const n = lite() ? 1 : 4;
    for (let i = 0; i < n; i++) particles.push({ from: m.from, to: m.to, t0: now + i * 90, dur: 900, kind: m.kind, lead: i === 0 });
    if (particles.length > MAX_PARTICLES) particles.splice(0, particles.length - MAX_PARTICLES);
    kick();
  }
  function ripple(r) {
    if (lite()) return;
    ripples.push(r);
    if (ripples.length > MAX_RIPPLES) ripples.splice(0, ripples.length - MAX_RIPPLES);
  }
  function event(e) {
    if (reduceMotion.matches || !nodes.has(e.member)) return;
    if (e.type === 'tool' || e.type === 'start' || e.type === 'log') ripple({ id: e.member, t0: performance.now(), dur: 600, color: e.type === 'tool' ? '#ffffff' : SC.working });
    kick();
  }

  function draw(now) {
    if (!W) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.drawImage(bg, 0, 0, W, H);
    const wall = Date.now();
    const still = reduceMotion.matches;
    const light = lite();

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
      if (!still && !light) {
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
          ripple({ id: p.to, t0: now, dur: 600, color: KC[p.kind] || '#fff' });
        }
        continue;
      }
      const q = curve(p.from, p.to);
      if (!q) continue;
      const e = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
      for (let j = light ? 0 : 4; j >= 0; j--) {
        const tt = Math.max(0, e - j * 0.022);
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
      if (st === 'working' && !still && !light) {
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
      ctx.fillStyle = id === 'human' ? '#1b2546' : '#18224a';
      ctx.arc(n.x, n.y, n.r, 0, Math.PI * 2);
      ctx.fill();
      if (id !== 'human') {
        // 픽셀 캐릭터: 원 안에 정수 배율로 (흐릿해지지 않게)
        // 정수 배율만 쓴다(선명하게): 노드 56px 에 캐릭터 48px(3배), 오더 72px 에 64px(4배)
        const px = Math.max(1, Math.floor((n.r * 2 - 8) / SIZE));
        const size = px * SIZE;
        ctx.imageSmoothingEnabled = false;
        ctx.save();
        ctx.beginPath();
        ctx.arc(n.x, n.y, n.r, 0, Math.PI * 2);
        ctx.clip();
        drawCharacter(ctx, character(id, { status: st, frame: still || light ? 0 : ui.frame }), Math.round(n.x - size / 2), Math.round(n.y - size / 2 + px), px);
        ctx.restore();
      }
      ctx.lineWidth = id === hover ? 3.5 : 2.5;
      ctx.strokeStyle = id === hover ? '#ffffff' : SC[st];
      ctx.beginPath();
      ctx.arc(n.x, n.y, n.r + 3, 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillStyle = '#fff';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      if (id === 'human') {
        ctx.font = `800 ${Math.round(n.r * 0.62)}px ${font}`;
        ctx.fillText('나', n.x, n.y + 1);
      }
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
  // 움직일 것이 없으면 프레임을 멈춘다. 가벼운 효과면 빛 알갱이가 날 때만 돈다.
  function busy() {
    if (reduceMotion.matches) return false;
    if (particles.length || ripples.length) return true;
    if (lite()) return false;
    const wall = Date.now();
    return [...nodes.values()].some((n) => n.m.status === 'working') || [...links.values()].some((l) => wall - l.at < 20000);
  }
  function loop(now) {
    raf = 0;
    if (!netVisible() || document.hidden) return;
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
    if (h && h.id !== 'human') openModal(h.id);
  });
  new ResizeObserver(resize).observe(wrap);
  document.addEventListener('visibilitychange', kick);
  reduceMotion.addEventListener?.('change', kick);
  // 선이 옅어지는 것을 움직임 줄이기에서도 가끔 다시 그린다
  setInterval(() => netVisible() && draw(performance.now()), 5000);
  return { sync, message, event, kick, resize };
})();

// ── 효과 줄이기 ──
const fx = { pref: store('squad.lite') === '1' };
/** 가벼운 효과: 사용자가 켰거나, 멤버가 많거나, 움직임 줄이기 설정. */
const lite = () => fx.pref || (ui.data?.members.length || 0) >= LITE_MEMBERS || reduceMotion.matches;
function applyFx() {
  document.documentElement.classList.toggle('fx-lite', lite());
  const b = $('#fx-toggle');
  b.setAttribute('aria-pressed', String(lite()));
  b.title = fx.pref ? '효과를 줄였습니다 (누르면 되돌림)' : lite() ? `멤버가 ${LITE_MEMBERS}명 이상이거나 움직임 줄이기 설정이라 저절로 줄였습니다` : '빛 알갱이·파동·캐릭터 움직임을 줄입니다';
}
$('#fx-toggle').addEventListener('click', () => {
  fx.pref = !fx.pref;
  store('squad.lite', fx.pref ? '1' : '0');
  applyFx();
  paintSprites();
  net.kick();
});

// ── 사용 기술 팝오버: 카드 밖에 떠서 카드 높이를 바꾸지 않는다 ──
const pop = $('#tech-pop');
function placeTech(btn) {
  const r = btn.getBoundingClientRect();
  const w = pop.offsetWidth, h = pop.offsetHeight;
  let x = r.left, y = r.bottom + 6;
  if (x + w > innerWidth - 8) x = innerWidth - 8 - w;
  if (y + h > innerHeight - 8) y = r.top - 6 - h; // 아래가 모자라면 위로
  pop.style.left = `${Math.max(8, x)}px`;
  pop.style.top = `${Math.max(8, y)}px`;
}
function fillTech() {
  const m = member(ui.techOpen);
  if (!m) return closeTech(false);
  const focused = document.activeElement?.closest?.('#tech-pop') ? document.activeElement.dataset.name + '|' + document.activeElement.dataset.toggle : null;
  pop.innerHTML = `<div class="pop-head"><b>${esc(m.name)}</b><span class="muted">켜진 기술 ${techCount(m)}</span></div>${techBlock(m)}`;
  if (focused) [...pop.querySelectorAll('input[data-toggle]')].find((x) => `${x.dataset.name}|${x.dataset.toggle}` === focused)?.focus();
}
function openTech(id) {
  const btn = document.querySelector(`[data-tech="${CSS.escape(id)}"]`);
  if (!btn) return;
  if (ui.techOpen) closeTech(false);
  ui.techOpen = id;
  fillTech();
  pop.hidden = false;
  placeTech(btn);
  btn.setAttribute('aria-expanded', 'true');
  pop.querySelector('input')?.focus();
}
function closeTech(focus = true) {
  if (!ui.techOpen) return;
  const btn = document.querySelector(`[data-tech="${CSS.escape(ui.techOpen)}"]`);
  ui.techOpen = null;
  pop.hidden = true;
  btn?.setAttribute('aria-expanded', 'false');
  if (focus) btn?.focus();
}
/** 카드를 다시 그린 뒤 팝오버 내용과 위치를 맞춘다. */
function refreshTech() {
  if (!ui.techOpen) return;
  const btn = document.querySelector(`[data-tech="${CSS.escape(ui.techOpen)}"]`);
  if (!btn || !btn.offsetParent) return closeTech(false);
  fillTech();
  placeTech(btn);
}
document.addEventListener('pointerdown', (e) => {
  if (ui.techOpen && !pop.contains(e.target) && !e.target.closest('[data-tech]')) closeTech(false);
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && ui.techOpen) {
    e.preventDefault();
    closeTech();
  }
});
addEventListener('resize', () => closeTech(false));
$('.cards-col').addEventListener('scroll', () => closeTech(false), { passive: true });

// 켜기·끄기 스위치(팝오버·상세 모달·모니터 공용) → MEMBER.md frontmatter 의 그 값만 바뀐다
document.addEventListener('change', async (e) => {
  const sw = e.target.closest?.('input[data-toggle]');
  if (!sw) return;
  sw.disabled = true;
  try {
    await api('/api/member/toggle', { project: ui.project, id: sw.dataset.member, kind: sw.dataset.toggle, name: sw.dataset.name || undefined, on: sw.checked });
    toast(`${sw.dataset.name || 'headroom'} ${sw.checked ? '켬' : '끔'}`);
  } catch (x) {
    sw.checked = !sw.checked;
    toast(x.message);
  } finally {
    sw.disabled = false;
    load();
  }
});

// ── 실행기(runner) 연결 상태 ──
function renderRunners() {
  $('#runners').innerHTML = ui.runners
    .map((r) => `<span class="runner st-${esc(r.state)}" title="${esc([r.label, r.main ? '메인 AI' : '', r.secretSet !== undefined ? `키 ${r.secretSet ? '설정됨' : '없음'}` : '', r.detail].filter(Boolean).join(' · '))}"><i aria-hidden="true"></i>${esc(r.name)} <b>${esc(r.stateLabel)}</b>${r.secretSet !== undefined ? `<small>키 ${r.secretSet ? '설정됨' : '없음'}</small>` : ''}${r.canLogin ? `<button type="button" class="btn btn-sm" data-login="${esc(r.name)}">로그인 창 열기</button>` : ''}</span>`)
    .join('');
}
async function loadRunners(refresh = false) {
  try {
    ui.runners = (await api(`/api/runners${refresh ? '?refresh=1' : ''}`)).runners;
    renderRunners();
    syncConfirm();
  } catch {
    // 상태를 못 읽어도 보드는 돈다
  }
}
let loginPoll = null;
async function openLogin(name) {
  try {
    await api('/api/runners/login', { runner: name });
    toast('새 콘솔 창과 브라우저에서 직접 로그인하세요. 이 화면은 비밀번호를 받지 않습니다');
    clearInterval(loginPoll);
    let n = 0;
    loginPoll = setInterval(async () => {
      await loadRunners(true);
      if (++n > 24 || !ui.runners.some((r) => r.canLogin)) clearInterval(loginPoll);
    }, 5000);
  } catch (x) {
    toast(x.message);
  }
}
$('#runners').addEventListener('click', (e) => {
  const b = e.target.closest('[data-login]');
  if (b) openLogin(b.dataset.login);
});

// ── 승인 대기 칸 ──
const pendingApprovals = () => (ui.data?.approvals || []).filter((a) => a.status === 'pending');
function renderApprovals() {
  const list = pendingApprovals();
  $('#approvals').hidden = !list.length;
  $('#approvals-count').textContent = list.length ? `${list.length}건` : '';
  $('#approval-list').innerHTML = list
    .map((a) => `<li class="approval">${avatar(a.from, 'sm')}<b>${esc(nameOf(a.from))}</b><span class="kind" style="--kc:var(--warn)">${esc(ACTION[a.action] || a.action)}</span>
      <span class="grow" title="${esc(a.text)}">${esc(a.text)}</span><time title="${esc(fullTime(a.at))}">${rel(a.at)}</time>
      <button type="button" class="btn btn-sm btn-primary" data-approve="${esc(a.id)}">승인</button>
      <button type="button" class="btn btn-sm" data-reject="${esc(a.id)}">거절</button></li>`)
    .join('');
}
async function decide(id, decision, note = '') {
  try {
    await api('/api/approvals/decide', { project: ui.project, id, decision, note });
    toast(decision === 'approved' ? '승인했습니다' : '거절했습니다');
  } catch (x) {
    toast(x.message);
  }
  load();
}
$('#approval-list').addEventListener('click', (e) => {
  const ok = e.target.closest('[data-approve]');
  if (ok) return decide(ok.dataset.approve, 'approved');
  const no = e.target.closest('[data-reject]');
  if (no) {
    ui.later.delete(`ap:${no.dataset.reject}`);
    openConfirm(`ap:${no.dataset.reject}`, true);
  }
});

// ── 확인 모달: 승인 요청 · 배정 기다리는 계획 · 로그인 필요를 줄 세워 하나씩 ──
const confirmDlg = $('#confirm');
const cf = { key: null, rejecting: false };
const BASE_TITLE = document.title;
function confirmItems() {
  const items = pendingApprovals().map((a) => ({ key: `ap:${a.id}`, type: 'approval', a }));
  if (order.plan) items.push({ key: `plan:${order.instruction}`, type: 'plan' });
  for (const r of ui.runners) if (r.canLogin) items.push({ key: `login:${r.name}`, type: 'login', r });
  return items;
}
function updateTitle(n) {
  document.title = document.hidden && n ? `(확인 ${n}) ${BASE_TITLE}` : BASE_TITLE;
}
document.addEventListener('visibilitychange', () => updateTitle(confirmItems().length));

/** 상태가 바뀔 때마다: 배지·제목을 맞추고, 새로 들어온 확인이 있으면 모달을 연다. 다른 곳에서 처리된 것은 지운다. */
function syncConfirm() {
  const items = confirmItems();
  const keys = new Set(items.map((i) => i.key));
  for (const k of [...ui.later]) if (!keys.has(k)) ui.later.delete(k);
  const fresh = items.filter((i) => !ui.seenConfirm.has(i.key));
  for (const i of items) ui.seenConfirm.add(i.key);
  $('#confirm-badge').hidden = !items.length;
  $('#confirm-count').textContent = items.length;
  updateTitle(items.length);
  if (confirmDlg.open) {
    if (keys.has(cf.key)) {
      // 보고 있는 것은 다시 그리지 않는다(쓰던 거절 사유·포커스 유지). 남은 건수만 고친다.
      $('#confirm-left').textContent = items.length > 1 ? `남은 확인 ${items.length - 1}건` : '';
      return;
    }
    cf.rejecting = false;
    const next = items.find((i) => !ui.later.has(i.key));
    if (next) {
      cf.key = next.key;
      renderConfirm(items);
    } else confirmDlg.close();
  } else if (fresh.length) {
    openConfirm(fresh[0].key);
  }
}
function openConfirm(key, rejecting = false) {
  const items = confirmItems();
  const it = items.find((i) => i.key === key) || items.find((i) => !ui.later.has(i.key));
  if (!it) return;
  cf.key = it.key;
  cf.rejecting = rejecting;
  renderConfirm(items);
  if (!confirmDlg.open) confirmDlg.showModal();
  (confirmDlg.querySelector('#reject-note') || confirmDlg.querySelector('[data-act]'))?.focus();
}
/** 영향 범위: 요청에 적힌 scope, 없으면 그 멤버의 담당 경로 */
const scopeOf = (from, scope) => scope || (member(from)?.owns || []).join(', ') || '적지 않음';
function renderConfirm(items) {
  const it = items.find((i) => i.key === cf.key);
  if (!it) return;
  const left = items.length - 1;
  $('#confirm-left').textContent = left > 0 ? `남은 확인 ${left}건` : '';
  const btn = (act, label, cls = '') => `<button type="button" class="btn ${cls}" data-act="${act}">${label}</button>`;
  let av = '', title = '', sub = '', body = '', acts = '';
  if (it.type === 'approval') {
    const a = it.a;
    av = avatar(a.from, 'lg');
    title = `${nameOf(a.from)} — ${ACTION[a.action] || a.action} 승인 요청`;
    sub = `${esc(rel(a.at))}${a.taskId ? ` · <span class="mono">${esc(a.taskId)}</span>` : ''}`;
    body = `<dl class="kv confirm-kv"><dt>하려는 일</dt><dd>${esc(a.text)}</dd><dt>이유</dt><dd>${esc(a.reason || '적지 않음')}</dd><dt>영향 범위</dt><dd class="mono">${esc(scopeOf(a.from, a.scope))}</dd></dl>
      ${cf.rejecting ? `<label class="reject-box"><span>거절 사유 (요청한 멤버에게 갑니다)</span><textarea id="reject-note" class="input" rows="2" maxlength="300" placeholder="예: 테스트 통과를 먼저 확인해 주세요"></textarea></label>` : ''}`;
    acts = cf.rejecting ? btn('back', '돌아가기', 'btn-ghost') + btn('reject-send', '거절 보내기', 'btn-danger') : btn('later', '나중에', 'btn-ghost') + btn('reject', '거절') + btn('approve', '승인', 'btn-primary');
  } else if (it.type === 'plan') {
    const owners = [...new Set(order.plan.map((p) => p.member))];
    av = avatar('order', 'lg');
    title = '메인 오더 계획 — 배정 확인';
    sub = `작업 ${order.plan.length}개 · 아직 저장하지 않았습니다`;
    body = `<dl class="kv confirm-kv"><dt>지시</dt><dd>${esc(order.instruction)}</dd><dt>영향 범위</dt><dd class="mono">${esc(owners.map((id) => `${id}: ${scopeOf(id)}`).join(' / '))}</dd></dl>${planGroups()}`;
    acts = btn('later', '나중에', 'btn-ghost') + btn('plan-cancel', '취소') + btn('plan-confirm', '이대로 배정', 'btn-primary');
  } else {
    const r = it.r;
    av = '<span class="avatar lg is-human" aria-hidden="true">로그인</span>';
    title = `${r.label || r.name} 로그인 필요`;
    sub = `${esc(r.name)} 실행기`;
    body = `<p>[로그인 창 열기]를 누르면 이 컴퓨터에 새 콘솔 창이 뜨고 <code>claude auth login</code> 이 실행됩니다. 그 창과 브라우저에서 직접 로그인하세요.</p><p class="muted">이 화면은 비밀번호나 키를 받지 않습니다. 로그인이 끝나면 상태가 저절로 바뀝니다.</p>`;
    acts = btn('later', '나중에', 'btn-ghost') + btn('login', '로그인 창 열기', 'btn-primary');
  }
  $('#confirm-avatar').innerHTML = av;
  $('#confirm-title').textContent = title;
  $('#confirm-sub').innerHTML = sub;
  const note = $('#reject-note')?.value;
  $('#confirm-body').innerHTML = body;
  if (note && $('#reject-note')) $('#reject-note').value = note;
  $('#confirm-actions').innerHTML = acts;
  paintSprites();
}
function laterCurrent() {
  ui.later.add(cf.key);
  cf.rejecting = false;
  const next = confirmItems().find((i) => !ui.later.has(i.key));
  if (next) openConfirm(next.key);
  else confirmDlg.close();
}
$('#confirm-actions').addEventListener('click', async (e) => {
  const act = e.target.closest('[data-act]')?.dataset.act;
  if (!act) return;
  const it = confirmItems().find((i) => i.key === cf.key);
  if (!it) return syncConfirm();
  if (act === 'later') return laterCurrent();
  if (act === 'reject' || act === 'back') {
    cf.rejecting = act === 'reject';
    renderConfirm(confirmItems());
    return (confirmDlg.querySelector('#reject-note') || confirmDlg.querySelector('[data-act]'))?.focus();
  }
  e.target.closest('[data-act]').disabled = true;
  if (act === 'approve') await decide(it.a.id, 'approved');
  else if (act === 'reject-send') await decide(it.a.id, 'rejected', $('#reject-note')?.value || '');
  else if (act === 'plan-confirm') await confirmPlan();
  else if (act === 'plan-cancel') cancelPlan();
  else if (act === 'login') {
    await openLogin(it.r.name);
    return laterCurrent(); // 로그인은 창에서 하므로 모달은 다음으로 넘긴다
  }
  cf.rejecting = false;
  syncConfirm();
});
// Esc·바깥 클릭 = 나중에 (배지는 남는다)
confirmDlg.addEventListener('cancel', (e) => {
  e.preventDefault();
  laterCurrent();
});
confirmDlg.addEventListener('click', (e) => {
  if (e.target === confirmDlg) laterCurrent();
});
$('#confirm-badge').addEventListener('click', () => {
  ui.later.clear();
  openConfirm(confirmItems()[0]?.key);
});

// ── 이벤트 연결 ──
function setView(v) {
  ui.view = v;
  store('squad.view', v);
  for (const b of document.querySelectorAll('.seg-btn')) b.setAttribute('aria-selected', String(b.dataset.view === v));
  $('#view-network').hidden = v !== 'network';
  $('#view-monitor').hidden = v !== 'monitor';
  $('#legend').hidden = v !== 'network';
  $('#filters').hidden = v !== 'monitor';
  if (v === 'network') requestAnimationFrame(() => net.resize());
}
const netVisible = () => ui.tab === 'squad' && ui.view === 'network';

// 상단 탭: 주소의 #squad / #tasks / #chat 으로 남긴다
const TABS = ['squad', 'tasks', 'chat'];
function setTab() {
  const t = location.hash.slice(1);
  ui.tab = TABS.includes(t) ? t : 'squad';
  for (const id of TABS) {
    $(`#tab-${id}`).setAttribute('aria-selected', String(id === ui.tab));
    $(`#panel-${id}`).hidden = id !== ui.tab;
  }
  if (netVisible()) requestAnimationFrame(() => net.resize());
  if (ui.tab === 'chat') {
    const box = $('#convo');
    box.scrollTop = box.scrollHeight;
  }
}
window.addEventListener('hashchange', setTab);

// ── 메인 오더에게 지시: 계획 만들기 → 이대로 배정 (두 단계) ──
const order = { plan: null, instruction: '', busy: false };
function planGroups() {
  const groups = new Map();
  for (const p of order.plan) groups.set(p.member, [...(groups.get(p.member) || []), p]);
  return `<div class="plan-groups scroll">${[...groups].map(([id, list]) => `<div class="plan-group">
      <div class="plan-who">${avatar(id, 'sm')}<b>${esc(nameOf(id))}</b><span class="muted">${list.length}개</span></div>
      <ul>${list.map((p) => `<li><div class="plan-title"><span class="step" title="실행 순서">${p.step || 1}</span>${esc(p.title)}</div>${p.detail ? `<div class="plan-detail">${esc(p.detail)}</div>` : ''}${p.why ? `<div class="plan-why">${esc(p.why)}</div>` : ''}</li>`).join('')}</ul>
    </div>`).join('')}</div>`;
}
function renderPlan() {
  const box = $('#order-plan');
  if (!order.plan) {
    box.hidden = true;
    box.innerHTML = '';
    syncConfirm();
    return;
  }
  box.hidden = false;
  box.innerHTML = `<div class="plan-head"><b>계획</b><span class="muted">작업 ${order.plan.length}개 · 아직 저장하지 않았습니다 · 숫자는 실행 순서</span>
      <div class="plan-actions"><button type="button" class="btn btn-ghost" id="plan-cancel">취소</button><button type="button" class="btn btn-primary" id="plan-confirm">이대로 배정</button></div></div>
    ${planGroups()}`;
  paintSprites();
  syncConfirm();
}
function setOrderBusy(busy, label) {
  order.busy = busy;
  $('#order-submit').disabled = busy;
  $('#order-text').disabled = busy;
  $('#order-submit').textContent = busy ? label : '계획 만들기';
}
$('#order-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const text = $('#order-text').value.trim();
  const err = $('#order-error');
  err.textContent = '';
  if (!text) return (err.textContent = '지시를 입력하세요');
  if (order.busy) return;
  setOrderBusy(true, '계획 만드는 중');
  order.plan = null;
  renderPlan();
  try {
    const r = await api('/api/order', { project: ui.project, instruction: text });
    order.plan = r.plan;
    order.instruction = r.instruction;
    renderPlan();
  } catch (x) {
    err.textContent = x.message;
  } finally {
    setOrderBusy(false);
  }
});
function cancelPlan() {
  order.plan = null;
  renderPlan();
}
async function confirmPlan() {
  if (!order.plan || order.busy) return;
  const err = $('#order-error');
  err.textContent = '';
  setOrderBusy(true, '배정하는 중');
  try {
    const r = await api('/api/order/confirm', { project: ui.project, instruction: order.instruction, plan: order.plan });
    order.plan = null;
    renderPlan();
    $('#order-text').value = '';
    toast(`작업 ${r.tasks.length}개를 배정했습니다`);
    load();
  } catch (x) {
    err.textContent = x.message;
    toast(x.message);
  } finally {
    setOrderBusy(false);
  }
}
$('#order-plan').addEventListener('click', (e) => {
  if (e.target.closest('#plan-cancel')) {
    cancelPlan();
    return $('#order-text').focus();
  }
  if (e.target.closest('#plan-confirm')) confirmPlan();
});
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
  closeModal();
  connect();
  load();
});

$('#cards').addEventListener('click', (e) => {
  const t = e.target.closest('[data-tech]');
  if (t) {
    if (ui.techOpen === t.dataset.tech) closeTech();
    else openTech(t.dataset.tech);
    return;
  }
  const o = e.target.closest('[data-open]');
  if (o) openModal(o.dataset.open);
});
$('#rows').addEventListener('toggle', (e) => {
  const id = e.target.dataset?.member;
  if (!id) return;
  if (e.target.open) ui.openRows.add(id);
  else ui.openRows.delete(id);
}, true);
$('#rows').addEventListener('click', (e) => {
  const b = e.target.closest('[data-open]');
  if (b) openModal(b.dataset.open);
});
const rerows = () => (renderRows(), paintSprites());
$('#filter-status').addEventListener('change', rerows);
$('#filter-member').addEventListener('change', rerows);

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
    paintSprites();
  }
}, 10000);

// 캐릭터 움직임: 0.5초마다 프레임을 바꾼다. 움직임 줄이기·가벼운 효과·안 보이는 탭이면 멈춘다.
setInterval(() => {
  if (lite() || document.hidden) return;
  ui.frame ^= 1;
  paintSprites();
  if (netVisible()) net.kick();
}, 500);

// ── 시작 ──
(async () => {
  setTab();
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
    loadRunners();
  } catch (e) {
    toast(e.message);
  }
})();
// 연결 상태는 1분마다 (서버가 5분 동안 결과를 기억하므로 claude 를 자주 부르지 않는다)
setInterval(() => !document.hidden && loadRunners(), 60000);
