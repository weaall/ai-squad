// AI Squad 보드 화면. 프레임워크 없이 상태 하나를 받아 전부 다시 그린다.
import { SIZE, character, drawCharacter } from './pixel.js';
import { STATUS_FALLBACK, askItems, blockedAction, budgetLevel, canApprove, confirmItems, inputKey, inputPayload, limitChip, looksLikeDiff, orderOutcome, panelDecision, renderDiff, resetText, todoCounts, topMembers, usageReport, headroomView, viewStatus, weekSlots, weekTotals } from './logic.js';
const $ = (s) => document.querySelector(s);
const KIND = { order: '지시', handoff: '인계', question: '질문', answer: '답변', report: '완료 보고', note: '메모' };
const TASK_COLS = [['todo', '할 일'], ['doing', '진행 중'], ['review', '검수'], ['blocked', '막힘'], ['done', '완료']];
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)');
const ACTION = { push: 'push', deploy: '배포', migrate: 'DB 마이그레이션', send: '외부 발송', delete: '삭제', budget: '예산 확인' };
const LITE_MEMBERS = 12; // 이보다 많으면 저절로 가벼운 효과
const MAX_PARTICLES = 30;

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
  frame: 0,
  seenMsgs: null,
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
/** 짧은 토큰 표기: 1.2만 / 350만 */
const fmtShort = (n) => (n >= 1e8 ? `${(n / 1e8).toFixed(1)}억` : n >= 1e4 ? `${(n / 1e4).toFixed(n >= 1e6 ? 0 : 1)}만` : fmtTok(n));
const usageTotal = (u) => (u ? (u.input || 0) + (u.output || 0) + (u.cacheRead || 0) + (u.cacheWrite || 0) : 0);
function techBlock(m) {
  const sw = (kind, name, on, label) =>
    `<label class="switch"><input type="checkbox" role="switch" data-toggle="${kind}" data-member="${esc(m.id)}" data-name="${esc(name)}"${on ? ' checked' : ''}><span class="switch-ui" aria-hidden="true"></span><span class="switch-label" title="${esc(label)}">${esc(label)}</span></label>`;
  return `<dl class="kv"><dt>실행</dt><dd>${esc(m.runner)}</dd><dt>모델</dt><dd>${esc(m.model || '기본값')}</dd><dt>도구</dt><dd>${esc(m.tools.join(', ') || '기본(Read·Edit·Write·Glob·Grep)')}</dd></dl>
    <p class="muted small">켜진 것만 실행 프롬프트에 들어갑니다</p>
    <div class="switches">${sw('headroom', '', m.headroom, 'headroom (토큰 압축, 기본 켜짐)')}${(m.pluginList || []).map((p) => sw('plugin', p.name, p.on, p.name)).join('')}</div>
    ${(m.pluginList || []).length ? '' : '<p class="muted small">플러그인·스킬·MCP 없음</p>'}`;
}
const statusName = (s) => (ui.data?.statusLabels || STATUS_FALLBACK)[s] || s;
// 색은 서버 상태(m.status), 이름은 입력·승인 대기까지 나눈 보이는 상태
const memberStatusName = (m) => statusName(viewStatus(m, ui.data || {}));
const pill = (m) => `<span class="pill st-${m.status}"><i class="dot st-${m.status}"></i>${memberStatusName(m)}</span>`;
const kindTag = (k) => `<span class="kind" style="--kc:var(--k-${esc(k)})">${esc(KIND[k] || k)}</span>`;
function eventLabel(e) {
  if (!e) return '';
  if (e.label) return e.label;
  if (e.type === 'tool') return [e.tool, e.path].filter(Boolean).join(' · ');
  if (e.type === 'start') return `작업 시작${e.text ? ' · ' + e.text : ''}`;
  if (e.type === 'end') return `작업 끝${e.text ? ' · ' + e.text : ''}`;
  if (e.type === 'outside-warn') return `경로 밖 변경 · ${outsideFiles(e)}`;
  return e.text || '';
}
// git 에만 보인 맡은 경로 밖 변경 — member 가 '' 면 누가 고쳤는지 모름
const outsideFiles = (e) => (e.files || []).map((f) => `${f.path} (${f.member ? nameOf(f.member) + ' 몫' : '누가 고쳤는지 모름'})`).join(', ') || e.text || '';
const ICON_LOCK = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/></svg>';
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
  if (!res.ok) throw Object.assign(new Error(data.error || `요청 실패 (${res.status})`), { data });
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
      ui.seenMsgs = new Set(data.messages.map((m) => m.id));
      ui.newMsgIds = new Set(fresh.map((m) => m.id));
      ui.data = data;
      render();
      syncSide();
      syncAsk();
      try {
        net.sync(data, first);
        for (const m of fresh) net.message(m);
      } catch (x) {
        console.warn('연결 그림을 그리지 못했습니다', x);
      }
    } catch (e) {
      toast(e.message);
    } finally {
      loading = null;
    }
  })();
  return loading;
}

let source = null;
let bootVersion = null; // 처음 받은 서버 version(커밋 해시) — 재시작 뒤 다르면 새로고침
function connect() {
  source?.close();
  source = new EventSource(`/api/stream?project=${encodeURIComponent(ui.project)}`);
  const live = $('#live');
  source.addEventListener('hello', (e) => {
    let v = null;
    try {
      v = JSON.parse(e.data).version ?? null;
    } catch {}
    if (v && bootVersion && v !== bootVersion) return location.reload();
    bootVersion ??= v;
    live.classList.add('is-on');
    live.lastElementChild.textContent = '실시간';
    live.title = '실시간 연결됨';
  });
  source.addEventListener('change', () => load());
  source.onerror = () => {
    live.classList.remove('is-on');
    live.lastElementChild.textContent = '다시 연결 중';
    live.title = '다시 연결 중';
    // 503 처럼 200 이 아닌 응답이면 EventSource 가 스스로 다시 붙지 않는다
    if (source.readyState === EventSource.CLOSED) setTimeout(connect, 3000);
  };
}

// ── 그리기 ──
function render() {
  const d = ui.data;
  if (!d) return;
  $('#demo-badge').hidden = !d.demo;
  const tc = todoCounts(d.tasks);
  $('#stats').innerHTML = [
    ['is-working', '일하는 중', d.counts.working, '지금 작업을 실행하고 있는 멤버 수'],
    ['', '할 일', tc.todo + (tc.locked ? ` · 잠김 ${tc.locked}` : '') + (d.counts.review ? ` · 검수 ${d.counts.review}` : ''), '할 일: 아직 실행하지 않은 작업 수 (잠김: 선행 작업이 끝나야 시작)'],
    ['is-blocked', '막힘', d.counts.blocked, '막힌 멤버·작업 수'],
  ].map(([c, l, n, t]) => `<span class="stat ${c}" title="${t}">${l} <b>${n}</b></span>`).join('');
  renderUsage();
  if (ui.tab === 'usage') renderUsageTab(), loadHeadroom();
  applyFx();
  fillSelects();
  renderInbox();
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
        <div class="card-id">${esc(m.id)}${m.pending ? ` · 할 일 ${m.pending}` : ''}${flags(m)}</div></div>${pill(m)}</div>
      <button type="button" class="card-task${m.current ? '' : ' is-empty'}" data-open="${esc(m.id)}" aria-label="${esc(m.name)} 자세히: ${esc(m.current || '맡은 작업 없음')}">${esc(m.current || '맡은 작업 없음')}</button>
      <div class="card-event">${ev ? `<span title="${esc(eventLabel(ev))}">${esc(eventLabel(ev))}</span><time datetime="${esc(ev.at)}" title="${esc(fullTime(ev.at))}">${rel(ev.at)}</time>` : '<span>이벤트 없음</span>'}</div>
      <div class="card-foot">
        <button type="button" class="tech-toggle" data-tech="${esc(m.id)}" aria-expanded="${open}" aria-haspopup="dialog" aria-controls="tech-pop">켜진 기술 ${techCount(m)} ${ICON_CHEV}</button>
        ${memberUse(m)}
      </div>
    </article>`;
  }).join('');
  $('#cards').innerHTML = html || '<p class="empty">멤버가 없습니다. <code>node bin/squad.mjs init</code> 으로 스쿼드를 만드세요.</p>';
}

/** 카드의 토큰: 하루 상한이 있으면 오늘 사용률 막대, 없으면 이번 작업 토큰 */
function memberUse(m) {
  const t = m.tokens || {};
  const s = m.runStats;
  const tip = `이번 작업 ${fmtTok(t.task)} · 오늘 ${fmtTok(t.today)} · 누적 ${fmtTok(t.all)}토큰${m.budgetLimit ? ` · 하루 상한 ${fmtTok(m.budgetLimit)}` : ''}${s?.runs ? `\n실행 ${s.runs}번 · 실행당 기본 맥락 ${fmtShort(s.avgBase)} · 작업당 ${fmtShort(s.perTask)}토큰` : ''}`;
  if (!m.budgetLimit) return `<span class="tok" title="${esc(tip)}">이번 작업 ${fmtShort(t.task)}토큰</span>`;
  const r = (t.today || 0) / m.budgetLimit;
  return `<span class="tok use lv-${budgetLevel(r, ui.data.budget?.warn)}" title="${esc(tip)}">오늘 ${Math.round(r * 100)}%<span class="bar"><i style="width:${Math.min(100, r * 100).toFixed(1)}%"></i></span></span>`;
}

/** 첨부된 화면 캡처 썸네일 */
const capUrl = (name) => `/api/capture?name=${encodeURIComponent(name)}`;
const thumbs = (atts, n = 1) =>
  (atts || []).filter((x) => x.type === 'capture').slice(-n).reverse()
    .map((x) => `<a class="thumb" href="${capUrl(x.name)}" target="_blank" rel="noopener" title="화면 캡처 ${esc(x.width)}×${esc(x.height)} · ${esc(fullTime(x.at))}"><img src="${capUrl(x.name)}" alt="화면 캡처 ${esc(x.width)}×${esc(x.height)}" loading="lazy" width="160" height="100"></a>`).join('');

/** 뒤처짐 표시: 멈춤, 답 없는 인계 */
const flags = (m) =>
  (m.stalled ? '<span class="flag is-stalled" title="할 일이 있는데 오래 움직이지 않았습니다">멈춤</span>' : '') +
  (m.unanswered ? `<span class="flag is-wait" title="받은 인계·질문에 오래 답하지 않았습니다">답 없는 인계 ${m.unanswered}</span>` : '');

function eventList(events, n) {
  const list = events.slice(-n).reverse();
  if (!list.length) return '<p class="empty">이벤트 없음</p>';
  return `<ul class="mini-list">${list.map((e) => `<li${e.type === 'outside-warn' ? ' class="is-warn"' : ''}><span class="grow" title="${esc(eventLabel(e))}">${esc(eventLabel(e))}</span><time title="${esc(fullTime(e.at))}">${rel(e.at)}</time></li>`).join('')}</ul>`;
}
function taskList(tasks) {
  if (!tasks.length) return '<p class="empty">없음</p>';
  const label = { ...Object.fromEntries(TASK_COLS), cancelled: '취소' };
  return `<ul class="mini-list">${tasks.map((t) => `<li><span class="grow" title="${esc(t.detail || t.title)}">${esc(t.title)}</span><span class="tag">${label[t.status]}</span></li>`).join('')}</ul>`;
}
const pathList = (ps) => (ps.length ? `<ul class="paths">${ps.map((p) => `<li class="mono" title="${esc(p)}">${esc(p)}</li>`).join('')}</ul>` : '<p class="empty">없음</p>');

function renderRows() {
  const fs = $('#filter-status').value;
  const fm = $('#filter-member').value;
  const d = ui.data;
  const ms = d.members.filter((m) => (!fs || viewStatus(m, d) === fs) && (!fm || m.id === fm));
  $('#rows').innerHTML = ms.map((m) => {
    const ev = m.lastEvent;
    const mine = d.events.filter((e) => e.member === m.id);
    const pending = d.tasks.filter((t) => t.member === m.id && t.status !== 'done' && t.status !== 'cancelled');
    return `<details class="row" data-member="${esc(m.id)}"${ui.openRows.has(m.id) ? ' open' : ''}>
      <summary>
        ${avatar(m.id)}
        <span class="row-name">${esc(m.name)}<small>${esc(m.id)}${flags(m)}</small></span>
        ${pill(m)}
        <span class="row-cell${m.current ? '' : ' is-empty'}" title="${esc(m.current)}">${esc(m.current || '맡은 작업 없음')}</span>
        <span class="row-cell${ev ? '' : ' is-empty'}">${ev ? `${esc(eventLabel(ev))}<time>${rel(ev.at)}</time>` : '이벤트 없음'}</span>
        <span class="row-num" title="할 일(아직 실행 안 한 작업)">${m.pending}</span>
        ${ICON_CHEV}
      </summary>
      <div class="row-body">
        <div>
          <h3>켜진 기술 ${techCount(m)}</h3>${techBlock(m)}
          <h3>담당 경로</h3>${pathList(m.owns)}
        </div>
        <div>
          <h3>할 일 ${pending.length}</h3>${taskList(pending)}
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
  const statusOpts = (sel) => (sel === 'cancelled' ? [...TASK_COLS, ['cancelled', '취소']] : TASK_COLS).map(([v, l]) => `<option value="${v}"${v === sel ? ' selected' : ''}>${l}</option>`).join('');
  $('#kanban').innerHTML = TASK_COLS.map(([s, label]) => {
    // 취소된 작업은 완료 칸에 회색으로
    let list = d.tasks.filter((t) => t.status === s || (s === 'done' && t.status === 'cancelled'));
    const total = list.length;
    // 완료는 최근 것만
    if (s === 'done') list = list.slice().sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || '')).slice(0, 8);
    return `<div class="col" data-s="${s}">
      <div class="col-head"><i></i>${label}<span class="count">${total}</span></div>
      ${list.map((t) => `<article class="tcard${t.waitingOn?.length ? ' is-locked' : ''}${t.status === 'cancelled' ? ' is-cancelled' : ''}" data-task="${esc(t.id)}">
        <div class="tcard-title">${t.waitingOn?.length ? `<span class="lock" title="선행 작업이 남아 있어 아직 시작할 수 없습니다">${ICON_LOCK}</span>` : ''}${esc(t.title)}</div>
        ${t.dependsOn?.length ? `<div class="tcard-deps" title="먼저 끝나야 하는 작업">선행: ${t.dependsOn.map((id) => { const x = d.tasks.find((y) => y.id === id); return `<span class="${x?.status === 'done' ? 'is-done' : ''}">${esc(x?.title || id)}</span>`; }).join(', ')}</div>` : ''}
        ${t.status === 'review' ? `<div class="tcard-review">검수: ${esc(nameOf(t.reviewer || ''))}${t.diffStat?.length ? ` · 파일 ${t.diffStat.length}개` : ''}</div>` : ''}
        ${t.reviewNote && t.status === 'todo' ? `<div class="tcard-review is-reject" title="${esc(t.reviewNote)}">검수 반려: ${esc(t.reviewNote)}</div>` : ''}
        ${t.blockedReason ? `<div class="tcard-review is-reject">${esc(t.blockedReason)}</div>` : ''}
        ${((w) => w ? `<div class="tcard-review is-warn" title="${esc(eventLabel(w))}">경로 밖 변경 ${w.files?.length || ''}개 · ${esc(outsideFiles(w))}</div>` : '')(d.events.findLast((e) => e.type === 'outside-warn' && e.taskId === t.id))}
        ${thumbs(t.attachments)}
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
      ${m.attachments ? `<div class="thumbs">${thumbs(m.attachments, 3)}</div>` : ''}
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
  const queued = d.tasks.filter((t) => t.member === m.id && t.status !== 'done' && t.status !== 'cancelled');
  // 이 멤버가 남긴 캡처(메시지 첨부)와 이 멤버 작업의 캡처
  const caps = [...d.messages.filter((x) => x.from === m.id).flatMap((x) => x.attachments || []), ...d.tasks.filter((t) => t.member === m.id).flatMap((t) => t.attachments || [])]
    .filter((x, i, all) => x.type === 'capture' && all.findIndex((y) => y.name === x.name) === i)
    .sort((a, b) => String(a.at).localeCompare(String(b.at)));
  const use = usageReport(d, d.week?.start ?? Date.now() - 7 * 864e5).members.find((x) => x.id === m.id);
  const useStat = (l, v, t) => `<span class="stat" title="${t}">${l} <b>${v}</b></span>`;
  const html = `
    <div class="modal-grid">
      <div>
        <section><h3>역할</h3><p class="handoff">${esc(m.role || '적힌 역할이 없습니다')}</p></section>
        <section><h3>지금 작업</h3><p class="handoff full">${esc(m.current || '맡은 작업 없음')}</p></section>
        <section><h3>할 일 ${queued.length}</h3>${taskList(queued)}</section>
        <section><h3>인계 메모</h3><p class="handoff">${esc(m.handoff || '없음')}</p></section>
      </div>
      <div>
        <section><h3>이번 주 사용</h3>${use ? `<div class="stats">
          ${useStat('작업', use.tasks, '이번 주 끝낸 실행이 있는 작업 수')}
          ${useStat('평균 기본 맥락', use.avgBase === null ? '-' : fmtShort(use.avgBase), '첫 응답이 읽은 입력 — 시스템 프롬프트·문서·도구 설명. 크면 MEMBER.md·CLAUDE.md·켜진 기술을 줄일 것')}
          ${m.runStats?.runs ? useStat('누적 실행', m.runStats.runs, `최근 기록 전체(서버 집계) · 실행당 기본 맥락 ${fmtShort(m.runStats.avgBase)} · 작업당 ${fmtShort(m.runStats.perTask)}토큰`) : ''}
          ${useStat('작업당 토큰',use.perTask === null ? '-' : fmtShort(use.perTask), '이번 주 토큰 ÷ 작업 수')}
          ${useStat('비용', usd(use.cost), '이번 주 실행 비용(기록된 것만)')}</div>` : '<p class="empty">이번 주 기록 없음</p>'}</section>
        <section><h3>최근 이벤트</h3>${eventList(d.events.filter((e) => e.member === m.id), 15)}</section>
        <section><h3>담당 경로</h3>${pathList(m.owns)}</section>
        <section><h3>켜진 기술 ${techCount(m)}</h3>${techBlock(m)}</section>
        ${caps.length ? `<section><h3>화면 캡처 ${caps.length}</h3><div class="thumbs">${thumbs(caps, 6)}</div></section>` : ''}
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
  $('#modal-sub').innerHTML = `${esc(m.id)} · ${pill(m)}`;
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
  const links = new Map(); // "a|b" → {a, b, at, times}  times: 최근 1시간 메시지 시각
  let particles = [];
  const FLY = 600, FADE = 2500, HOUR = 3600000; // 빛이 가는 시간, 그 뒤 선이 옅어지는 시간
  let hover = null;
  let raf = 0;
  let bg = null;
  const font = getComputedStyle(document.body).fontFamily;
  // 지시는 CI 시안, 실행 중은 CI 시안 고리 — style.css 의 --k-*·--working 과 맞춘다
  const KC = { order: '#1fd5e4', handoff: '#f2b64c', question: '#f28fd0', answer: '#9cdfa8', report: '#b78cff', note: '#aab4cc' };
  const SC = { working: '#1fd5e4', idle: '#5f6b8f', blocked: '#ff7b7b' };
  const RING = ['#3c84d8', '#1fd5e4', '#6ce4d8', '#9cdfa8']; // 메인 오더 고리 = CI 심볼 고리

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
      // 처음 열 때: 최근 1시간 대화로 선 굵기만 채운다 (빛은 새 메시지부터)
      const since = Date.now() - HOUR;
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
    const l = links.get(k) || { a: m.from, b: m.to, times: [] };
    l.at = Math.max(l.at || 0, t);
    l.times.push(t);
    links.set(k, l);
  }
  // 메시지 하나에 빛 하나: 보낸 쪽 → 받는 쪽. 동시에 MAX_PARTICLES 개까지(넘치면 오래된 것부터 버린다).
  function message(m) {
    touch(m);
    if (reduceMotion.matches || !nodes.has(m.from) || !nodes.has(m.to) || m.from === m.to) return kick();
    particles.push({ from: m.from, to: m.to, t0: performance.now(), kind: m.kind });
    if (particles.length > MAX_PARTICLES) particles.splice(0, particles.length - MAX_PARTICLES);
    kick();
  }

  function draw(now) {
    if (!W) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.drawImage(bg, 0, 0, W, H);
    const wall = Date.now();
    const still = reduceMotion.matches;
    const light = lite();

    // 배경 고정선: 메인 오더 ↔ 멤버만, 아주 옅게
    const order = nodes.get('order');
    if (order) {
      ctx.lineWidth = 1;
      ctx.strokeStyle = 'rgba(255,255,255,0.035)';
      for (const [id, n] of nodes) {
        if (id === 'order' || id === 'human') continue;
        ctx.beginPath();
        ctx.moveTo(order.x, order.y);
        ctx.lineTo(n.x, n.y);
        ctx.stroke();
      }
    }

    // 오간 선: 빛이 가는 동안 밝고, 그 뒤 FADE 동안 옅어진다. 굵기는 그 쌍의 최근 1시간 메시지 수.
    // 움직임 줄이기면 최근 10분 선을 고정으로 둔다.
    for (const l of links.values()) {
      while (l.times.length && wall - l.times[0] > HOUR) l.times.shift();
      const q = curve(l.a, l.b);
      if (!q) continue;
      const age = wall - l.at;
      let alpha;
      if (still) {
        if (age > 600000) continue;
        alpha = 0.5;
      } else {
        if (age > FLY + FADE) continue;
        alpha = 0.75 * (age < FLY ? 1 : 1 - (age - FLY) / FADE);
      }
      const width = 1 + Math.min(l.times.length, 10) * 0.25;
      ctx.save();
      ctx.strokeStyle = `rgba(140,226,236,${alpha})`;
      ctx.lineWidth = width;
      if (!still && !light) {
        ctx.shadowColor = 'rgba(31,213,228,0.9)';
        ctx.shadowBlur = 10 * alpha;
      }
      ctx.beginPath();
      ctx.moveTo(q.A.x, q.A.y);
      ctx.quadraticCurveTo(q.c.x, q.c.y, q.B.x, q.B.y);
      ctx.stroke();
      ctx.restore();
    }

    // 빛 알갱이
    particles = particles.filter((p) => now - p.t0 < FLY);
    for (const p of particles) {
      const t = (now - p.t0) / FLY;
      const q = curve(p.from, p.to);
      if (!q) continue;
      const head = at(q, t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);
      const c = KC[p.kind] || '#ffffff';
      const g = ctx.createRadialGradient(head.x, head.y, 0, head.x, head.y, 12);
      g.addColorStop(0, hexA(c, 0.6));
      g.addColorStop(1, hexA(c, 0));
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(head.x, head.y, 12, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#fff';
      ctx.beginPath();
      ctx.arc(head.x, head.y, 3, 0, Math.PI * 2);
      ctx.fill();
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
      ctx.strokeStyle = id === hover ? '#ffffff' : id === 'order' && st !== 'blocked' ? orderRing(n) : SC[st];
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
        ctx.fillText(clip(m.current || memberStatusName(m), 18), n.x, n.y + n.r + 32);
      }
    }
  }
  function orderRing(n) {
    const g = ctx.createConicGradient(-Math.PI / 2, n.x, n.y);
    RING.forEach((c, i) => g.addColorStop(i / RING.length, c));
    g.addColorStop(1, RING[0]);
    return g;
  }
  const clip = (s, n) => ([...s].length > n ? [...s].slice(0, n - 1).join('') + '…' : s);
  function hexA(hex, a) {
    const h = hex.replace('#', '');
    const n = parseInt(h.length === 3 ? h.replace(/./g, '$&$&') : h, 16);
    return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
  }

  // 움직일 것이 없으면 프레임을 멈춘다. 가벼운 효과면 빛과 옅어지는 선이 있을 때만 돈다.
  function busy() {
    if (reduceMotion.matches) return false;
    const wall = Date.now();
    if (particles.length || [...links.values()].some((l) => wall - l.at < FLY + FADE)) return true;
    return !lite() && [...nodes.values()].some((n) => n.m.status === 'working');
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
      tip.textContent = id === 'human' ? '사람 (나)' : `${m.name} · ${memberStatusName(m)}${m.lastEvent ? ' · ' + eventLabel(m.lastEvent) : ''}`;
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

// ── 사용량: 머리줄 요약 칩 하나('Claude 5h 57% · 주 22%', 높은 쪽 색), 누르면 상세 모달. 보고 탭 위에 '이번 주 사용' ──
const RUNNER_NAME = { claude: 'Claude', antigravity: 'Antigravity' };
const USE_NOTE = '예산 기준(비용 환산) 토큰 · 남은 한도는 Claude 가 실행 때 알려 준 값';
const LIMIT_WINDOWS = [['fiveHour', '5시간', '5h'], ['sevenDay', '주간', '주']];
const LV_RANK = { ok: 0, warn: 1, over: 2 };
const useModal = $('#use-modal');
const limitWins = (lim) => LIMIT_WINDOWS.map(([k, label, short]) => ({ label, short, c: limitChip(lim?.[k]) }));
const limitDetail = (c) => `남음 ${c.left}%${c.reset ? ` · ${c.reset} 리셋` : ''}`;
function renderUsage() {
  const d = ui.data;
  const lim = d.limits;
  const tt = d.tokensToday || { total: 0 };
  const stale = lim?.stale ? `마지막 측정 ${rel(lim.at)}` : '';
  const wins = limitWins(lim).filter((w) => w.c);
  const lv = stale ? 'stale' : wins.reduce((a, w) => (LV_RANK[w.c.lv] > LV_RANK[a] ? w.c.lv : a), 'ok');
  const chip = $('#use-chip');
  chip.className = `use-chip lv-${lv}`;
  chip.innerHTML = wins.length ? `Claude ${wins.map((w) => `${w.short} <b>${w.c.pct}%</b>`).join(' · ')}` : `Claude 한도 <b>-</b> · 오늘 <b>${fmtShort(tt.total)}</b>`;
  chip.title = `${wins.map(({ label, c }) => `${label} ${c.pct}% · ${limitDetail(c)}`).join('\n') || 'Claude 한도: 아직 측정 없음'}${stale ? `\n${stale}` : ''}\n오늘 사용 ${fmtTok(tt.total)}\n누르면 상세`;
  if (useModal.open) fillUseModal();
  renderWeek();
}
/** 반원 게이지: 호 길이를 pathLength 100 으로 두고 dasharray 로 채운다 */
const ARC = 'M10 62a50 50 0 0 1 100 0';
const gauge = (label, c, stale) => `<figure class="gauge lv-${stale || !c ? 'stale' : c.lv}">
    <svg viewBox="0 0 120 68" aria-hidden="true"><path d="${ARC}" pathLength="100"/><path class="g-val" d="${ARC}" pathLength="100" stroke-dasharray="${c ? c.pct : 0} 100"/><text x="60" y="58">${c ? `${c.pct}%` : '-'}</text></svg>
    <figcaption><b>Claude ${label}</b><span class="muted">${c ? limitDetail(c) : '측정 없음'}</span></figcaption></figure>`;
/** 비율 막대(SVG): parts = [[runner, 값]] → runner 색으로 이어 붙이고 옆에 % */
function shareRow(label, parts) {
  const sum = parts.reduce((a, [, n]) => a + n, 0);
  let x = 0;
  const rects = sum ? parts.map(([r, n]) => { const w = (n / sum) * 100; const s = `<rect class="r-${esc(r)}" x="${x.toFixed(2)}" width="${w.toFixed(2)}" height="8"/>`; x += w; return s; }).join('') : '';
  const legend = sum ? parts.map(([r, n]) => `<span>${runnerDot(r)} ${Math.round((n / sum) * 100)}%</span>`).join('') : '<span class="muted">없음</span>';
  return `<li><span class="k">${label}</span><svg class="ratio" viewBox="0 0 100 8" preserveAspectRatio="none" aria-hidden="true"><rect class="r-bg" width="100" height="8"/>${rects}</svg><b>${fmtShort(sum)}</b><span class="ratio-legend">${legend}</span></li>`;
}
function hrRow(label, w) {
  const pct = w?.pct ?? 0;
  return `<li><span class="k">Headroom ${label}</span><svg class="ratio" viewBox="0 0 100 8" preserveAspectRatio="none" aria-hidden="true"><rect class="r-bg" width="100" height="8"/><rect class="r-hr" width="${Math.min(100, pct)}" height="8"/></svg><b>${w ? `${w.pct ?? '-'}%` : '-'}</b><span class="ratio-legend muted">${w ? `${fmtShort(w.before)} 중 ${fmtShort(w.saved)} 줄임${w.newPct !== null ? ` · 새 입력 ${w.newPct}%` : ''}` : ui.headroom === undefined ? '불러오는 중' : '수집 전'}</span></li>`;
}
function fillUseModal() {
  const d = ui.data;
  const lim = d.limits;
  const stale = lim?.stale ? `마지막 측정 ${rel(lim.at)}` : '';
  const ru = d.usage?.byRunner || { today: {}, week: {} };
  const runners = [...new Set(['claude', ...d.members.map((m) => m.runner).filter(Boolean), ...Object.keys(ru.week || {})])];
  const parts = (o = {}) => runners.map((r) => [r, o[r] || 0]).filter(([, n]) => n);
  const hr = ui.headroom;
  const wk = weekTotals(d.week);
  const top = topMembers(d.week, 5);
  const hrStat = (label, w) => `<dt>${label}</dt><dd>${w ? `<b>${fmtShort(w.saved)}토큰</b><span class="muted">${usd(w.usd)} · 호출 ${fmtTok(w.calls)}</span>` : `<span class="muted">${hr === undefined ? '불러오는 중' : '수집 전'}</span>`}</dd>`;
  $('#use-modal-sub').textContent = `${stale || (lim ? `한도 측정 ${rel(lim.at)}` : '한도 측정 없음')}${hr?.at ? ` · Headroom ${rel(hr.at)}` : ''}`;
  $('#use-modal-body').innerHTML = `<div class="gauges">${limitWins(lim).map((w) => gauge(w.label, w.c, stale)).join('')}</div>
    ${lim?.hit ? `<p class="small use-hit">한도에 닿았습니다${lim.hitResetsAt ? ` · ${resetText(lim.hitResetsAt)} 리셋` : ''}</p>` : ''}
    <section><h3>토큰 비율</h3><ul class="ratio-list">
      ${shareRow('오늘', parts(ru.today))}${shareRow('이번 주', parts(ru.week))}${hrRow('오늘', hr?.today)}${hrRow('7일', hr?.week)}
    </ul></section>
    <div class="modal-grid">
      <section><h3>Headroom 절약</h3><dl class="save-list">${hrStat('오늘', hr?.today)}${hrStat('7일', hr?.week)}</dl></section>
      <section class="wk-top"><h3>멤버 상위 5 · 이번 주</h3>${top.length ? `<ol>${top.map(([id, n]) => `<li><span class="grow">${esc(nameOf(id))}</span><span class="bar"><i style="width:${((n / (top[0][1] || 1)) * 100).toFixed(1)}%"></i></span><b>${fmtShort(n)}</b><span class="muted">${wk.budget ? Math.round((n / wk.budget) * 100) : 0}%</span></li>`).join('')}</ol>` : '<p class="empty">아직 없음</p>'}</section>
    </div>
    <p class="muted small">${USE_NOTE}</p>
    <a class="btn btn-sm" href="#usage">사용량 탭에서 자세히</a>`;
}
$('#use-chip').addEventListener('click', () => {
  fillUseModal();
  useModal.showModal();
  loadHeadroom();
});
$('#use-modal-close').addEventListener('click', () => useModal.close());
// 배경 클릭·탭 링크는 닫기
useModal.addEventListener('click', (e) => {
  if (e.target === useModal || e.target.closest('a[href^="#"]')) useModal.close();
});
// ── 사용량 탭: Claude·Antigravity·Headroom 비교. 이번 주 숫자는 logic.js usageReport, Headroom 은 서버 캐시 ──
const usd = (n) => (n === null || n === undefined ? '-' : `$${n < 100 ? n.toFixed(2) : Math.round(n).toLocaleString('ko-KR')}`);
/** 서버 runStats(최근 기록 전체) → 표 칸: 실행 수, 툴팁에 실행당 기본 맥락·작업당 토큰 */
const runCell = (s) => (s?.runs ? `<span title="실행당 기본 맥락 ${fmtShort(s.avgBase)} · 작업당 ${fmtShort(s.perTask)}토큰">${s.runs}</span>` : '-');
const runnerDot = (r) =>`<i class="dot-r r-${esc(r)}"></i>${esc(RUNNER_NAME[r] || r)}`;
let headroomAt = 0;
async function loadHeadroom() {
  if (Date.now() - headroomAt < 60e3) return; // 서버는 5분마다 모은다
  headroomAt = Date.now();
  try {
    ui.headroom = headroomView(await api('/api/usage/headroom'));
  } catch {
    ui.headroom = null; // 서버에 아직 없음 → '수집 전'
  }
  if (ui.tab === 'usage') renderUsageTab();
  if (useModal.open) fillUseModal();
}
function renderUsageTab() {
  const d = ui.data;
  if (!d) return;
  const r = usageReport(d, d.week?.start ?? Date.now() - 7 * 864e5);
  const tt = d.tokensToday || { total: 0 };
  const hr = ui.headroom;
  const wk = weekTotals(d.week); // 이번 주 합·runner 별은 서버 week.days(전체 기록) 집계
  const kpi = (k, v, sub, title = '') => `<div class="kpi" title="${esc(title)}"><span class="kpi-k">${k}</span><b>${v}</b><span class="kpi-sub">${sub}</span></div>`;
  const hrKpi = (label, w) => w
    ? kpi(`Headroom ${label} 절약`, fmtShort(w.saved), `${w.pct ?? '-'}% · ${usd(w.usd)} · 호출 ${fmtTok(w.calls)}`, `압축 전 ${fmtTok(w.before)}토큰 중 ${fmtTok(w.saved)}토큰 절약${hr.at ? `\n측정 ${fullTime(hr.at)}` : ''}`)
    : kpi(`Headroom ${label} 절약`, '-', hr === undefined ? '불러오는 중' : '수집 전', 'headroom savings 를 서버가 아직 모으지 않았습니다');
  const limKpi = (k, label) => {
    const c = limitChip(d.limits?.[k]);
    return kpi(`Claude ${label} 한도`, c ? `${c.pct}%` : '-', c ? `남음 ${c.left}%${c.reset ? ` · ${c.reset} 리셋` : ''}` : '측정 없음', USE_NOTE);
  };
  $('#use-kpis').innerHTML = [
    kpi('오늘 총 토큰', fmtShort(tt.total), `예산 기준 ${fmtShort(tt.budgetTokens || 0)} · ${usd(tt.costUsd)}`, `${fmtTok(tt.total)}토큰\n${USE_NOTE}`),
    kpi('이번 주 예산 기준 토큰', fmtShort(wk.budget), `총 ${fmtShort(wk.total)} · ${usd(wk.cost)}`, `예산 기준 ${fmtTok(wk.budget)} · 총 ${fmtTok(wk.total)}토큰\n${USE_NOTE}`),
    hrKpi('오늘', hr?.today),
    hrKpi('7일', hr?.week),
    limKpi('fiveHour', '5시간'),
    limKpi('sevenDay', '주간'),
  ].join('');

  // 아낀 양: Headroom 실측 + Antigravity 로 넘긴 몫을 Claude 단가로 환산(추정)
  const ag = wk.runner.antigravity;
  const shares = Object.entries(wk.runner).filter(([, s]) => s.budget);
  $('#use-save').innerHTML = `<h3 class="use-h">아낀 양 <span class="muted">이번 주</span></h3>
    <dl class="save-list">
      <dt>Headroom 압축</dt><dd><b>${hr?.week ? `${fmtShort(hr.week.saved)}토큰` : '수집 전'}</b>${hr?.week ? `<span class="muted">${hr.week.pct ?? '-'}% · ${usd(hr.week.usd)}</span>` : ''}</dd>
      <dt>Antigravity 로 넘긴 작업 <em class="est">추정</em></dt><dd><b>${ag ? `약 ${usd(wk.agEstUsd)}` : '없음'}</b>${ag ? `<span class="muted">${fmtShort(ag.total)}토큰 · Claude 로 돌렸다면</span>` : ''}</dd>
    </dl>
    ${shares.length ? `<div class="share" title="이번 주 예산 기준 토큰 비율">${shares.map(([k, s]) => `<i class="r-${esc(k)}" style="flex:${s.budget}"></i>`).join('')}</div>
    <ul class="wk-legend">${shares.map(([k, s]) => `<li>${runnerDot(k)} ${Math.round((s.budget / wk.budget) * 100)}%</li>`).join('')}</ul>` : ''}
    <p class="muted small">추정값은 Antigravity 토큰을 이번 주 Claude 실제 단가(비용 ÷ 예산 기준 토큰)로 바꾼 것 — 청구액이 아닙니다.</p>`;

  $('#use-members').innerHTML = `<h3 class="use-h">멤버별 <span class="muted">이번 주${r.truncated ? ' · 최근 기록 기준' : ''}</span></h3>
    ${r.members.length ? `<table class="use-table"><thead><tr><th>멤버</th><th class="num">작업</th><th class="num" title="첫 응답이 읽은 입력 — 시스템 프롬프트·문서·도구 설명">평균 기본 맥락</th><th class="num">작업당 토큰</th><th class="num" title="최근 기록 전체의 실행 수 · 실행당 기본 맥락 · 작업당 토큰(서버 집계)">누적 실행</th><th>주로 쓴 runner</th><th>모델</th><th class="num">비용</th></tr></thead>
    <tbody>${r.members.map((m) => `<tr><td>${esc(nameOf(m.id))}</td><td class="num">${m.tasks}</td><td class="num">${m.avgBase === null ? '-' : fmtShort(m.avgBase)}</td><td class="num">${m.perTask === null ? '-' : fmtShort(m.perTask)}</td><td class="num">${runCell(member(m.id)?.runStats)}</td><td>${runnerDot(m.runner)}</td><td class="mono">${esc(m.model || '기본값')}</td><td class="num">${usd(m.cost)}</td></tr>`).join('')}</tbody></table>` : '<p class="empty">이번 주 기록 없음</p>'}`;

  $('#use-top').innerHTML = `<h3 class="use-h">비싼 작업 상위 10 <span class="muted">이번 주</span></h3>
    ${r.top.length ? `<table class="use-table"><thead><tr><th>작업</th><th>멤버</th><th>runner</th><th class="num">토큰</th><th class="num">비용</th></tr></thead>
    <tbody>${r.top.map((t) => `<tr><td class="clip" title="${esc(`${t.title}\n${t.id}`)}">${esc(t.title)}</td><td>${esc(nameOf(t.member))}</td><td>${runnerDot(t.runner)}</td><td class="num" title="예산 기준 ${fmtTok(t.budget)}">${fmtShort(t.total)}</td><td class="num">${usd(t.cost)}</td></tr>`).join('')}</tbody></table>` : '<p class="empty">이번 주 기록 없음</p>'}`;
}
function renderWeek() {
  const d = ui.data;
  const box = $('#week-panel');
  const slots = weekSlots(d.week);
  if (!slots.length) return (box.innerHTML = '');
  const max = Math.max(1, ...slots.map((s) => s.tokens));
  const total = slots.reduce((a, s) => a + s.tokens, 0);
  const runners = [...new Set(['claude', ...slots.flatMap((s) => Object.keys(s.byRunner))])];
  const x = (i) => ((i + 0.5) / 7) * 100;
  const pts = slots.map((s, i) => (s.used === null ? null : `${x(i).toFixed(1)},${(30 - s.used * 26).toFixed(1)}`)).filter(Boolean);
  const top = topMembers(d.week, 5);
  const topMax = top[0]?.[1] || 1;
  const md = (day) => `${+day.slice(5, 7)}/${+day.slice(8)}`;
  box.innerHTML = `<div class="wk-chart">
      <div class="wk-head"><b>이번 주 사용</b><span class="muted">${fmtShort(total)} · 하루는 21시 경계${d.week.resetsAt ? ` · ${resetText(d.week.resetsAt)} 리셋` : ''}</span>
        <ul class="wk-legend">${runners.map((r) => `<li><i class="dot-r r-${esc(r)}"></i>${esc(RUNNER_NAME[r] || r)}</li>`).join('')}<li><i class="dot-line"></i>주간 사용률</li></ul></div>
      <div class="wk-line"><svg viewBox="0 0 100 32" preserveAspectRatio="none" aria-hidden="true">${pts.length > 1 ? `<polyline points="${pts.join(' ')}" />` : ''}</svg>
        ${slots.map((s, i) => (s.used === null ? '' : `<span style="left:${x(i).toFixed(1)}%;top:${(30 - s.used * 26).toFixed(0)}px">${Math.round(s.used * 100)}%</span>`)).join('')}</div>
      <div class="wk-bars">${slots.map((s) => `<div class="wk-col${s.future ? ' is-future' : ''}" title="${esc(`${md(s.day)} ${s.dow} — ${fmtTok(s.tokens)}${Object.entries(s.byRunner).map(([r, n]) => `\n${RUNNER_NAME[r] || r} ${fmtTok(n)}`).join('')}${s.used === null ? '' : `\n주간 사용률 ${Math.round(s.used * 100)}%`}\n${USE_NOTE}`)}">
          <span class="wk-val">${s.future ? '' : fmtShort(s.tokens)}</span>
          <span class="wk-bar" style="height:${((s.tokens / max) * 100).toFixed(1)}%">${runners.map((r) => (s.byRunner[r] ? `<i class="r-${esc(r)}" style="flex:${s.byRunner[r]}"></i>` : '')).join('')}</span>
          <span class="wk-day">${md(s.day)} ${s.dow}</span></div>`).join('')}</div>
    </div>
    <div class="wk-top"><b>멤버 상위 5</b>
      ${top.length ? `<ol>${top.map(([id, n]) => `<li><span class="grow">${esc(nameOf(id))}</span><span class="bar"><i style="width:${((n / topMax) * 100).toFixed(1)}%"></i></span><b>${fmtShort(n)}</b></li>`).join('')}</ol>` : '<p class="empty">아직 없음</p>'}
      <p class="muted small">${USE_NOTE}</p></div>`;
}

// ── 실행기(runner) 연결 상태: 머리줄에는 "연결 n/m" 칩 하나, 누르면 팝오버 ──
const connPop = $('#conn-pop');
function renderRunners() {
  const ok = ui.runners.filter((r) => r.state === 'ok').length;
  const chip = $('#conn-chip');
  $('#conn-count').textContent = ui.runners.length ? `${ok}/${ui.runners.length}` : '-';
  chip.className = `conn-chip${ui.runners.some((r) => r.canLogin) ? ' is-login' : ok ? ' is-ok' : ''}`;
  chip.title = ui.runners.map((r) => `${r.name}: ${r.stateLabel}`).join(' · ') || '실행기 연결 상태';
  connPop.innerHTML = `<div class="pop-head"><b>실행기 연결</b><span class="muted">${ok}/${ui.runners.length} 연결됨</span></div>
    <ul class="conn-list">${ui.runners
      .map((r) => `<li class="runner st-${esc(r.state)}"><i aria-hidden="true"></i><span class="grow"><b>${esc(r.name)}</b>${r.main ? ' <small>메인 AI</small>' : ''}<br><small>${esc([r.label, r.secretSet !== undefined ? `키 ${r.secretSet ? '설정됨' : '없음'}` : '', r.detail].filter(Boolean).join(' · '))}</small></span><span class="st">${esc(r.stateLabel)}</span>${r.canLogin ? `<button type="button" class="btn btn-sm" data-login="${esc(r.name)}">로그인 창 열기</button>` : ''}</li>`)
      .join('')}</ul>
    <p class="muted small">로그인은 새 콘솔 창과 브라우저에서 직접 합니다. 이 화면은 비밀번호·키를 받지 않습니다.</p>`;
}
async function loadRunners(refresh = false) {
  try {
    ui.runners = (await api(`/api/runners${refresh ? '?refresh=1' : ''}`)).runners;
    renderRunners();
    syncSide();
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

/** 머리줄의 작은 팝오버(연결·데스크톱 inbox) 공용: 단추 아래에 띄우고, 바깥 클릭·Esc 로 닫는다. */
const pops = { conn: { btn: '#conn-chip', pop: connPop }, inbox: { btn: '#inbox-chip', pop: $('#inbox-pop') } };
function togglePop(name, force) {
  const { btn, pop } = pops[name];
  const b = $(btn);
  const open = force ?? pop.hidden;
  for (const k of Object.keys(pops)) if (k !== name) closePop(k);
  pop.hidden = !open;
  b.setAttribute('aria-expanded', String(open));
  if (open) {
    const r = b.getBoundingClientRect();
    pop.style.top = `${r.bottom + 6}px`;
    pop.style.left = `${Math.max(8, Math.min(r.right - pop.offsetWidth, innerWidth - pop.offsetWidth - 8))}px`;
  }
}
function closePop(name) {
  const { btn, pop } = pops[name];
  if (pop.hidden) return;
  pop.hidden = true;
  $(btn).setAttribute('aria-expanded', 'false');
}
$('#conn-chip').addEventListener('click', () => togglePop('conn'));
$('#inbox-chip').addEventListener('click', () => togglePop('inbox'));
connPop.addEventListener('click', (e) => {
  const b = e.target.closest('[data-login]');
  if (b) openLogin(b.dataset.login);
});
document.addEventListener('pointerdown', (e) => {
  for (const [k, { btn, pop }] of Object.entries(pops)) if (!pop.hidden && !pop.contains(e.target) && !e.target.closest(btn)) closePop(k);
});
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  for (const k of Object.keys(pops)) closePop(k);
});

// ── desktop 멤버(데스크톱 Claude 세션) inbox ──
const INBOX = { pending: '대기', taking: '처리 중', done: '끝' };
function renderInbox() {
  const list = (ui.data?.inbox || []).slice().reverse();
  const c = ui.data?.counts || {};
  $('#inbox-count').textContent = c.inboxTaking ? `${c.inbox || 0} · 처리 중 ${c.inboxTaking}` : String(c.inbox || 0);
  $('#inbox-chip').classList.toggle('is-wait', Boolean(c.inbox));
  $('#inbox-pop').innerHTML = `<div class="pop-head"><b>desktop 멤버</b><span class="muted">대기 ${c.inbox || 0} · 처리 중 ${c.inboxTaking || 0}</span></div>
    ${list.length ? `<ul class="inbox-list">${list.map((i) => `<li class="ib-${esc(i.status)}"><div class="ib-top"><span class="tag">${INBOX[i.status]}</span><span class="mono">${esc(i.id)}</span><time title="${esc(fullTime(i.at))}">${rel(i.at)}</time></div><div class="ib-text">${esc(i.text)}</div>${i.result ? `<div class="ib-result">${esc(i.result)}</div>` : ''}</li>`).join('')}</ul>` : '<p class="empty">desktop 멤버에게 배정된 작업이 없습니다</p>'}
    <p class="muted small">데스크톱 세션에서 <code>squad inbox ${esc(ui.project)} --take</code> 로 가져가고 <code>squad inbox done &lt;id&gt; "결과"</code> 로 끝냅니다.</p>`;
}

// ── 확인 패널: 승인 → 예산 → 계획 → 로그인. 모달 대신 오른쪽에 밀어내는 패널 ──
const side = $('#side');
const sideUi = { open: store('squad.side') === '1', seen: new Set(), rejecting: null, viewed: new Set(), expanded: new Set(), fresh: new Set() };
const BASE_TITLE = document.title;
const pendingApprovals = () => (ui.data?.approvals || []).filter((a) => a.status === 'pending');
const items = () => confirmItems({
  approvals: pendingApprovals(), tasks: ui.data?.tasks, messages: ui.data?.messages, unanswered: ui.data?.unanswered,
  plan: order.plan ? order : null, runners: ui.runners,
});
function updateTitle(n) {
  document.title = document.hidden && n ? `(확인 ${n}) ${BASE_TITLE}` : BASE_TITLE;
}
document.addEventListener('visibilitychange', () => updateTitle(items().length));

function setSide(open) {
  sideUi.open = open;
  store('squad.side', open ? '1' : '0');
  side.hidden = !open;
  document.body.classList.toggle('has-side', open);
  $('#confirm-badge').setAttribute('aria-expanded', String(open));
}

/** 상태가 바뀔 때마다(첫 상태 포함): 배지·제목을 맞추고, 새 확인이 있으면 패널을 펼쳐 그 카드를 잠깐 강조한다. */
function syncSide() {
  const list = items();
  const d = panelDecision({ items: list, seen: sideUi.seen, open: sideUi.open });
  sideUi.seen = d.seen;
  const keys = new Set(list.map((i) => i.key));
  for (const set of [sideUi.viewed, sideUi.expanded]) for (const k of [...set]) if (!keys.has(k)) set.delete(k);
  if (sideUi.rejecting && !keys.has(sideUi.rejecting)) sideUi.rejecting = null;
  sideUi.fresh = new Set(d.fresh);
  $('#confirm-count').textContent = list.length;
  $('#confirm-badge').classList.toggle('is-empty', !list.length);
  updateTitle(list.length);
  if (d.open !== sideUi.open) setSide(d.open);
  renderSide(list);
}

const btn = (act, label, cls = '', extra = '') => `<button type="button" class="btn btn-sm ${cls}" data-act="${act}"${extra}>${label}</button>`;
/** 영향 범위: 요청에 적힌 scope, 없으면 그 멤버의 담당 경로 */
const scopeOf = (from, scope) => scope || (member(from)?.owns || []).join(', ') || '적지 않음';
const RISK = { low: '낮음', medium: '보통', high: '높음' };
/** 넘길 멤버 고르기 — 오더와 skip 에 든 멤버는 빼고 */
const pick = (skip) => `<select class="select sc-pick" data-pick aria-label="넘길 멤버">${ui.data.members.filter((m) => m.id !== 'order' && !skip.includes(m.id)).map((m) => `<option value="${esc(m.id)}">${esc(m.name)}</option>`).join('')}</select>`;

function detailBlock(a) {
  const task = a.taskId && ui.data.tasks.find((t) => t.id === a.taskId);
  return `<div class="ap-detail">
    ${a.details ? `<section><h4>설명</h4><div class="md">${mdToHtml(a.details)}</div></section>` : ''}
    ${a.commands?.length ? `<section><h4>실행할 명령</h4><pre class="cmd">${a.commands.map(esc).join('\n')}</pre></section>` : ''}
    ${a.files?.length ? `<section><h4>파일 ${a.files.length}개</h4><ul class="paths">${a.files.map((f) => `<li class="mono" title="${esc(f)}">${esc(f)}</li>`).join('')}</ul></section>` : ''}
    ${a.diff ? `<section><h4>${looksLikeDiff(a.diff) ? '바뀌는 내용(diff)' : '바뀌는 내용(SQL 등)'}</h4><div class="diff-box">${renderDiff(a.diff)}</div></section>` : ''}
    ${a.rollback ? `<section><h4>되돌리는 방법</h4><p class="handoff">${esc(a.rollback)}</p></section>` : ''}
    ${task ? `<section><h4>관련 작업</h4><button type="button" class="link task-link" data-goto-task="${esc(task.id)}">${esc(task.title)} <span class="mono">${esc(task.id)}</span></button></section>` : ''}
    ${!a.details && !a.commands?.length && !a.files?.length && !a.diff && !a.rollback && !task ? '<p class="muted small">요청에 상세 내용이 없습니다</p>' : ''}
  </div>`;
}

function cardHtml(it) {
  const fresh = sideUi.fresh.has(it.key) ? ' is-fresh' : '';
  if (it.type === 'approval' || it.type === 'budget') {
    const a = it.a;
    const budget = it.type === 'budget';
    const open = sideUi.expanded.has(it.key);
    const rejecting = sideUi.rejecting === it.key;
    const hasDetail = a.details || a.commands?.length || a.files?.length || a.diff || a.rollback || a.taskId;
    const allow = canApprove(a, sideUi.viewed.has(it.key));
    const title = budget ? `예산 경고 — ${nameOf(a.from)}` : `${nameOf(a.from)} — ${ACTION[a.action] || a.action}`;
    return `<li class="side-card t-${it.type}${fresh}" data-key="${esc(it.key)}">
      <div class="sc-head">${avatar(a.from, 'sm')}<div class="sc-title"><b>${esc(title)}</b><small>${esc(rel(a.at))}${a.taskId ? ` · <span class="mono">${esc(a.taskId)}</span>` : ''}</small></div>
        ${a.risk ? `<span class="risk r-${esc(a.risk)}">위험 ${RISK[a.risk]}</span>` : ''}</div>
      <dl class="kv sc-kv"><dt>${budget ? '실행' : '하려는 일'}</dt><dd>${esc(a.text)}</dd><dt>${budget ? '사용량' : '이유'}</dt><dd>${esc(a.reason || '적지 않음')}</dd><dt>영향 범위</dt><dd class="mono">${esc(scopeOf(a.from, a.scope))}</dd></dl>
      ${hasDetail && !budget ? `<button type="button" class="link more-link" data-act="detail" aria-expanded="${open}">${open ? '상세 접기' : '상세 보기'}${a.files?.length ? ` · 파일 ${a.files.length}` : ''}${a.diff ? ' · diff' : ''}</button>` : ''}
      ${open ? detailBlock(a) : ''}
      ${rejecting ? `<label class="reject-box"><span>거절 사유 (요청한 멤버에게 갑니다)</span><textarea class="input" data-note rows="2" maxlength="300" placeholder="예: 테스트 통과를 먼저 확인해 주세요"></textarea></label>` : ''}
      <div class="sc-actions">${rejecting
        ? btn('back', '돌아가기', 'btn-ghost') + btn('reject-send', '거절 보내기', 'btn-danger')
        : btn('reject', '거절') + btn('approve', budget ? '승인(계속 실행)' : '승인', 'btn-primary', allow ? '' : ' disabled title="위험도가 높아 상세를 먼저 펼쳐 봐야 합니다"')}</div>
      ${!allow ? '<p class="muted small">위험도 높음 — 상세를 펼쳐 본 뒤 승인할 수 있습니다</p>' : ''}
    </li>`;
  }
  if (it.type === 'blocked') {
    const t = it.t;
    const logs = (ui.data.events || []).filter((e) => e.taskId === t.id).slice(-10).map(eventLabel);
    const files = t.diffStat || [];
    const why = [t.blockedReason, t.summary].filter(Boolean).join('\n\n') || '적지 않음';
    return `<li class="side-card t-blocked${fresh}" data-key="${esc(it.key)}">
      <div class="sc-head">${avatar(t.member, 'sm')}<div class="sc-title"><b>막힘 — ${esc(t.title)}</b><small>${esc(nameOf(t.member))} · ${esc(rel(t.updatedAt))} · <span class="mono">${esc(t.id)}</span></small></div></div>
      <div class="ap-detail">
        <section><h4>막힌 이유</h4><p class="handoff sc-why">${esc(why)}</p></section>
        ${logs.length ? `<section><h4>실행 로그 마지막 ${logs.length}줄</h4><pre class="cmd">${logs.map(esc).join('\n')}</pre></section>` : ''}
        ${files.length ? `<section><h4>바뀐 파일 ${files.length}개</h4><ul class="paths">${files.map((f) => `<li class="mono" title="${esc(f.path)}">${esc(f.path)} +${f.add} -${f.del}</li>`).join('')}</ul></section>` : ''}
      </div>
      <label class="reject-box"><span>메모 (재시도·넘길 때 작업 내용에 붙습니다)</span><textarea class="input" data-note rows="2" maxlength="500"></textarea></label>
      <div class="sc-actions">${pick([t.member])}${btn('reassign', '다른 멤버에게')}</div>
      <div class="sc-actions">${btn('cancel', '취소', 'btn-danger') + btn('done', '완료로 처리') + btn('retry', '재시도', 'btn-primary')}</div>
    </li>`;
  }
  if (it.type === 'question') {
    const m = it.m;
    return `<li class="side-card t-question${fresh}" data-key="${esc(it.key)}">
      <div class="sc-head">${avatar(m.from, 'sm')}<div class="sc-title"><b>답 없는 질문 — ${esc(nameOf(m.from))} → ${esc(nameOf(m.to))}</b><small>${esc(rel(m.at))}${m.taskId ? ` · <span class="mono">${esc(m.taskId)}</span>` : ''}</small></div></div>
      <p class="handoff sc-why">${esc(m.text)}</p>
      <label class="reject-box"><span>대신 답하기 (${esc(nameOf(m.from))} 에게 갑니다)</span><textarea class="input" data-note rows="2" maxlength="2000"></textarea></label>
      <div class="sc-actions">${pick([m.from, m.to])}${btn('forward', '넘기기') + btn('answer', '답 보내기', 'btn-primary')}</div>
    </li>`;
  }
  if (it.type === 'plan') {
    const owners = [...new Set(order.plan.map((p) => p.member))];
    return `<li class="side-card t-plan${fresh}" data-key="${esc(it.key)}">
      <div class="sc-head">${avatar('order', 'sm')}<div class="sc-title"><b>메인 오더 계획 — 배정 확인</b><small>작업 ${order.plan.length}개 · 아직 저장하지 않았습니다</small></div></div>
      <dl class="kv sc-kv"><dt>지시</dt><dd>${esc(order.instruction)}</dd><dt>확인 이유</dt><dd>${order.reasons.length ? order.reasons.map(esc).join('<br>') : '적지 않음'}</dd><dt>영향 범위</dt><dd class="mono">${esc(owners.map((id) => `${id}: ${scopeOf(id)}`).join(' / '))}</dd></dl>
      <div class="sc-actions">${btn('plan-cancel', '취소') + btn('plan-confirm', '배정', 'btn-primary')}</div>
    </li>`;
  }
  const r = it.r;
  return `<li class="side-card t-login${fresh}" data-key="${esc(it.key)}">
    <div class="sc-head"><span class="avatar sm is-human" aria-hidden="true">AI</span><div class="sc-title"><b>${esc(r.label || r.name)} 로그인 필요</b><small>${esc(r.name)} 실행기</small></div></div>
    <p class="small">[로그인 창 열기]를 누르면 새 콘솔 창에서 <code>claude auth login</code> 이 실행됩니다. 그 창과 브라우저에서 직접 로그인하세요.</p>
    <div class="sc-actions">${btn('login', '로그인 창 열기', 'btn-primary')}</div>
  </li>`;
}

function renderSide(list = items()) {
  $('#side-count').textContent = list.length ? `${list.length}건` : '';
  side.classList.toggle('is-wide', [...sideUi.expanded].some((k) => list.some((i) => i.key === k)));
  const box = $('#side-list');
  const html = list.map(cardHtml).join('') || '<li class="empty">확인할 일이 없습니다</li>';
  // 같은 내용이면 다시 그리지 않는다(읽던 상세의 스크롤·포커스 유지). 카드마다 쓰던 메모·고른 멤버와 포커스를 지킨다.
  if (box.dataset.html === html) return;
  box.dataset.html = html;
  const slot = (x) => `${x.closest('[data-key]')?.dataset.key}|${x.tagName}`;
  const kept = new Map([...box.querySelectorAll('[data-note], [data-pick]')].map((x) => [slot(x), x.value]));
  const focused = box.contains(document.activeElement) ? slot(document.activeElement) : null;
  box.innerHTML = html;
  for (const x of box.querySelectorAll('[data-note], [data-pick]')) {
    if (kept.get(slot(x))) x.value = kept.get(slot(x));
    if (slot(x) === focused) x.focus();
  }
  paintSprites();
}

$('#side-list').addEventListener('click', async (e) => {
  const goto = e.target.closest('[data-goto-task]');
  if (goto) return gotoTask(goto.dataset.gotoTask);
  const b = e.target.closest('[data-act]');
  const card = e.target.closest('[data-key]');
  if (!b || !card) return;
  const it = items().find((i) => i.key === card.dataset.key);
  if (!it) return syncSide();
  const act = b.dataset.act;
  if (act === 'detail') {
    if (sideUi.expanded.has(it.key)) sideUi.expanded.delete(it.key);
    else sideUi.expanded.add(it.key), sideUi.viewed.add(it.key);
    return renderSide();
  }
  if (act === 'reject' || act === 'back') {
    sideUi.rejecting = act === 'reject' ? it.key : null;
    renderSide();
    return $('#side-list [data-note]')?.focus();
  }
  b.disabled = true;
  if (act === 'approve') await decide(it.a, 'approved');
  else if (act === 'reject-send') await decide(it.a, 'rejected', card.querySelector('[data-note]')?.value || '');
  else if (act === 'plan-confirm') await confirmPlan();
  else if (act === 'plan-cancel') cancelPlan();
  else if (it.type === 'blocked' || it.type === 'question') await humanAct(it, act, card.querySelector('[data-note]')?.value || '', card.querySelector('[data-pick]')?.value || '');
  else if (act === 'login') await openLogin(it.r.name);
  sideUi.rejecting = null;
  syncSide();
});
$('#confirm-badge').addEventListener('click', () => setSide(!sideUi.open));
$('#side-close').addEventListener('click', () => setSide(false));
// 서랍은 바깥 클릭·Esc 로 닫는다(모달이 떠 있으면 모달 몫)
document.addEventListener('pointerdown', (e) => {
  if (sideUi.open && !side.contains(e.target) && !e.target.closest('#confirm-badge, dialog')) setSide(false);
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && sideUi.open && !document.querySelector('dialog[open]')) setSide(false);
});

async function decide(a, decision, note = '') {
  try {
    await api('/api/approvals/decide', { project: ui.project, id: a.id, decision, note });
    toast(decision === 'approved' ? '승인했습니다' : '거절했습니다');
    // 오더 계획이 예산 확인을 기다리고 있었다면 승인 뒤 다시 보낸다
    if (decision === 'approved' && a.action === 'budget' && a.from === 'order' && order.waitBudget) {
      const text = order.waitBudget;
      order.waitBudget = '';
      submitOrder(text);
    }
  } catch (x) {
    toast(x.message);
  }
  await load();
}

const DONE_TOAST = { retry: '할 일로 되돌렸습니다', reassign: '다른 멤버에게 넘겼습니다', done: '완료로 처리했습니다', cancel: '작업을 취소했습니다' };
/** 막힘 카드(재시도·넘기기·완료·취소)와 답 없는 질문 카드(대신 답하기·넘기기). */
async function humanAct(it, act, note, to) {
  try {
    if (it.type === 'blocked') {
      if (act === 'cancel' && !confirm(`작업을 취소할까요? ${it.t.title}`)) return;
      const r = blockedAction(act, it.t.id, { note, member: to });
      if (r.error) return toast(r.error);
      await api(r.url, { project: ui.project, ...r.body });
      toast(DONE_TOAST[act]);
    } else {
      const m = it.m;
      if (act === 'answer') {
        if (!note.trim()) return toast('답을 적어 주세요');
        await sendAnswer(m, note.trim());
      } else {
        if (!to) return toast('넘길 멤버를 고르세요');
        // 질문은 원래 물은 멤버 이름으로 넘겨 답이 그쪽으로 가게 하고, 물은 멤버에게 알린다(카드도 이것으로 내려간다)
        await api('/api/messages', { project: ui.project, from: m.from, to, kind: 'question', taskId: m.taskId, text: m.text });
        await api('/api/messages', { project: ui.project, from: 'human', to: m.from, kind: 'note', taskId: m.taskId, text: `질문을 ${nameOf(m.to)} 대신 ${nameOf(to)} 에게 넘겼습니다${note.trim() ? `: ${note.trim()}` : ''}` });
      }
      toast(act === 'answer' ? '답을 보냈습니다' : '질문을 넘겼습니다');
    }
  } catch (x) {
    toast(x.message);
  }
  await load();
}
/** 사람이 멤버 질문에 답한다 — 서버가 기다리던 작업을 todo 로 돌리고 대기열을 깨운다. */
const sendAnswer = (m, text) => api('/api/messages', { project: ui.project, from: 'human', to: m.from, kind: 'answer', taskId: m.taskId, text });

/** 작업 탭으로 가서 그 카드를 잠깐 강조한다. */
function gotoTask(id) {
  location.hash = '#tasks';
  requestAnimationFrame(() => {
    const el = document.querySelector(`[data-task="${CSS.escape(id)}"]`);
    if (!el) return toast('작업을 찾지 못했습니다');
    el.scrollIntoView({ block: 'center' });
    el.classList.remove('is-fresh');
    void el.offsetWidth;
    el.classList.add('is-fresh');
  });
}

// ── 입력 요청 모달: 멤버가 사람의 답을 기다리는 작업. 화면을 가리는 건 이것뿐(승인은 확인 패널) ──
const INPUT_KIND = { preview: '발송 미리보기', choice: '디자인안 선택', fields: '필수 정보' };
const ask = $('#ask');
// shown: 한 번 띄운 요청(닫으면 다시 저절로 뜨지 않는다 — 상단 [입력 대기] 로 다시 연다)
const askUi = { key: null, shown: new Set(), busy: false, opener: null };
const askList = () => askItems(ui.data?.tasks, ui.data?.messages);

/** 상태가 바뀔 때마다: 배지를 맞추고, 처음 보는 요청이 있으면 띄운다. 보던 요청이 처리됐으면 다음으로. */
function syncAsk() {
  const list = askList();
  $('#ask-badge').hidden = !list.length;
  $('#ask-count').textContent = list.length;
  if (ask.open) {
    if (!list.length) return ask.close();
    return renderAsk(list.find((t) => inputKey(t) === askUi.key) || list[0]);
  }
  const fresh = list.find((t) => !askUi.shown.has(inputKey(t)));
  if (fresh) openAsk(fresh);
}
function openAsk(task) {
  if (!task) return;
  askUi.opener = document.activeElement;
  renderAsk(task);
  ask.showModal();
  (ask.querySelector('#ask-body input:not([type="hidden"])') || ask.querySelector('.ask-actions .btn-primary'))?.focus();
}
function renderAsk(task) {
  const key = inputKey(task);
  askUi.shown.add(key);
  if (askUi.key === key && ask.open) return renderAskPos(); // 쓰던 값·고른 안 유지
  askUi.key = key;
  const r = task.input;
  $('#ask-avatar').innerHTML = avatar(r.from, 'lg');
  $('#ask-title').textContent = r.title;
  $('#ask-sub').innerHTML = `<span class="tag">${INPUT_KIND[r.kind] || esc(r.kind)}</span>${esc(nameOf(r.from))} · ${esc(task.title)} <span class="mono">${esc(task.id)}</span> · <time title="${esc(fullTime(r.at))}">${rel(r.at)}</time>`;
  const intro = r.text ? `<p class="ask-text">${esc(r.text)}</p>` : '';
  let body, actions;
  if (r.kind === 'preview') {
    const p = r.preview;
    body = `${intro}<dl class="kv sc-kv ask-mail">${p.to ? `<dt>받는 곳</dt><dd>${esc(p.to)}</dd>` : ''}${p.subject ? `<dt>제목</dt><dd>${esc(p.subject)}</dd>` : ''}</dl>
      <pre class="ask-preview" tabindex="0" aria-label="보낼 본문">${esc(p.body)}</pre>`;
    actions = `<button type="submit" class="btn btn-danger" data-approve="0">보내지 말 것</button><button type="submit" class="btn btn-primary" data-approve="1">보내도 됨</button>`;
  } else if (r.kind === 'choice') {
    body = `${intro}<div class="ask-choices" role="radiogroup" aria-label="디자인안">${r.options.map((o, i) => `<label class="ask-opt">
      <input type="radio" name="ask-choice" value="${esc(o.id)}">
      <span class="thumb"><img src="${capUrl(o.capture)}" alt="${esc(o.label)} 캡처" loading="lazy" width="320" height="200"></span>
      <span class="ask-opt-name"><b>${String.fromCharCode(65 + i)}</b>${esc(o.label)}</span>
      <a class="more-link" href="${capUrl(o.capture)}" target="_blank" rel="noopener">크게 보기</a></label>`).join('')}</div>`;
    actions = `<button type="submit" class="btn btn-primary">이 안으로</button>`;
  } else {
    body = `${intro}<div class="ask-fields">${r.fields.map((f) => `<label class="ask-field"><span>${esc(f.label)}${f.required ? ' <em>필수</em>' : ''}</span>
      <input class="input" name="${esc(f.name)}" maxlength="1000" autocomplete="off"${f.required ? ' aria-required="true"' : ''}></label>`).join('')}</div>`;
    actions = `<button type="submit" class="btn btn-primary">보내기</button>`;
  }
  $('#ask-body').innerHTML = body;
  $('#ask-note').value = '';
  $('#ask-error').textContent = '';
  $('#ask-actions').innerHTML = `<button type="button" class="btn btn-ghost" data-ask="later">나중에</button><button type="button" class="btn btn-ghost" data-ask="next">다음 요청</button><span class="grow"></span>${actions}`;
  renderAskPos();
  paintSprites();
}
function renderAskPos() {
  const list = askList();
  const i = list.findIndex((t) => inputKey(t) === askUi.key);
  $('#ask-pos').textContent = list.length > 1 ? `${i + 1} / ${list.length}` : '';
  ask.querySelector('[data-ask="next"]').hidden = list.length < 2;
}
async function submitAsk(submitter) {
  const task = askList().find((t) => inputKey(t) === askUi.key);
  if (!task || askUi.busy) return;
  const form = $('#ask-form');
  const err = $('#ask-error');
  const values = Object.fromEntries([...form.querySelectorAll('.ask-field input')].map((x) => [x.name, x.value]));
  const r = inputPayload(task, {
    approve: submitter?.dataset.approve ? submitter.dataset.approve === '1' : undefined,
    choice: form.querySelector('[name="ask-choice"]:checked')?.value,
    values,
    note: $('#ask-note').value,
  });
  form.querySelectorAll('.ask-field input').forEach((x) => x.removeAttribute('aria-invalid'));
  if (r.error) {
    err.textContent = r.error;
    for (const n of r.missing || []) form.querySelector(`.ask-field input[name="${CSS.escape(n)}"]`)?.setAttribute('aria-invalid', 'true');
    return (form.querySelector('[aria-invalid="true"]') || form.querySelector('[name="ask-choice"]'))?.focus();
  }
  askUi.busy = true;
  form.querySelectorAll('button').forEach((b) => (b.disabled = true));
  try {
    const q = task.input.msg;
    if (q) await sendAnswer(q, [r.body.values.answer, r.body.note].filter(Boolean).join('\n\n'));
    else await api('/api/input/answer', { project: ui.project, ...r.body });
    toast('답을 보냈습니다. 작업이 할 일로 돌아갑니다');
  } catch (x) {
    err.textContent = x.message;
  } finally {
    askUi.busy = false;
    form.querySelectorAll('button').forEach((b) => (b.disabled = false));
  }
  await load();
}
// form method=dialog 이지만 Enter·단추로 저절로 닫히지 않게 막고 직접 보낸다
$('#ask-form').addEventListener('submit', (e) => {
  e.preventDefault();
  submitAsk(e.submitter);
});
$('#ask-actions').addEventListener('click', (e) => {
  const b = e.target.closest('[data-ask]');
  if (!b) return;
  if (b.dataset.ask === 'later') return ask.close();
  const list = askList();
  const i = list.findIndex((t) => inputKey(t) === askUi.key);
  renderAsk(list[(i + 1) % list.length]);
});
// 메모 칸: Ctrl+Enter 로 보내기(미리보기는 어느 쪽인지 골라야 하므로 제외)
$('#ask-note').addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && !ask.querySelector('[data-approve]')) {
    e.preventDefault();
    submitAsk();
  }
});
ask.addEventListener('close', () => {
  for (const t of askList()) askUi.shown.add(inputKey(t)); // 나중에: 지금 있는 요청은 저절로 다시 뜨지 않는다
  askUi.key = null;
  if (askUi.opener?.isConnected) askUi.opener.focus();
});
$('#ask-badge').addEventListener('click', () => openAsk(askList()[0]));

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
const TABS = ['squad', 'tasks', 'chat', 'report', 'usage'];
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
  if (ui.tab === 'report') loadReports();
  if (ui.tab === 'usage') renderUsageTab(), loadHeadroom();
}
window.addEventListener('hashchange', setTab);

// ── 메인 오더에게 지시: 계획 만들기 → 이대로 배정 (두 단계) ──
const order = { plan: null, instruction: '', reasons: [], busy: false };
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
    syncSide();
    return;
  }
  box.hidden = false;
  box.innerHTML = `<div class="plan-head"><b>계획</b><span class="muted">작업 ${order.plan.length}개 · 아직 저장하지 않았습니다 · 숫자는 실행 순서</span>
      <div class="plan-actions"><button type="button" class="btn btn-ghost" id="plan-cancel">취소</button><button type="button" class="btn btn-primary" id="plan-confirm">이대로 배정</button></div></div>
    <div class="plan-ask">${esc(order.instruction || '')}</div>
    ${planGroups()}`;
  paintSprites();
  syncSide();
}
function setOrderBusy(busy, label) {
  order.busy = busy;
  $('#order-submit').disabled = busy;
  $('#order-text').disabled = busy;
  $('#order-submit').textContent = busy ? label : '계획 만들기';
}
$('#order-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const text = $('#order-text').value.trim();
  const err = $('#order-error');
  err.textContent = '';
  if (!text) return (err.textContent = '지시를 입력하세요');
  submitOrder(text);
});
async function submitOrder(text) {
  const err = $('#order-error');
  if (order.busy) return;
  setOrderBusy(true, '계획 만드는 중');
  order.plan = null;
  renderPlan();
  try {
    const r = await api('/api/order', { project: ui.project, instruction: text });
    const o = orderOutcome(r);
    // 서버가 바로 배정했으면 확인 패널에 올리지 않고 알림만
    if (o.kind === 'auto') {
      clearOrderText();
      toast(`자동 배정: 작업 ${o.count}개 — 바로 시작합니다`);
      return load();
    }
    order.plan = r.plan;
    order.instruction = r.instruction;
    order.reasons = o.reasons;
    renderPlan();
  } catch (x) {
    err.textContent = x.message;
    // 예산 80% 를 넘었다: 확인 패널의 예산 카드를 승인하면 이 지시를 다시 보낸다
    if (x.data?.budget === 'warn') {
      order.waitBudget = text;
      load();
    }
  } finally {
    setOrderBusy(false);
  }
}
// 지시 칸: 내용만큼 늘린다(최대 8줄은 CSS max-height, 넘치면 칸 안 스크롤)
function fitOrderText() {
  const t = $('#order-text');
  t.style.height = 'auto';
  t.style.height = `${t.scrollHeight + t.offsetHeight - t.clientHeight}px`;
}
$('#order-text').addEventListener('input', fitOrderText);
$('#order-text').addEventListener('focus', fitOrderText);
$('#order-text').addEventListener('keydown', (e) => {
  const t = e.currentTarget;
  if (e.isComposing) return; // 한글 조합 중 Enter 는 조합 확정
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    $('#order-form').requestSubmit();
  } else if (e.key === 'Tab' && !e.shiftKey && !e.ctrlKey && !e.altKey) {
    e.preventDefault();
    t.setRangeText('  ', t.selectionStart, t.selectionEnd, 'end');
    fitOrderText();
  } else if (e.key === 'Escape') {
    // Tab 을 들여쓰기로 쓰므로 Esc 로 다음 칸(보내기 버튼)에 포커스를 넘긴다
    $('#order-submit').focus();
  }
});
function clearOrderText() {
  $('#order-text').value = '';
  fitOrderText();
}
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
    clearOrderText();
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
  sideUi.seen = new Set();
  closeModal();
  if (ui.tab === 'report') loadReports();
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

// ── 보고 탭 ──
const report = { dates: [], date: '' };
async function loadReports() {
  if (!ui.project) return; // 시작할 때는 프로젝트를 고른 뒤 다시 부른다
  try {
    const r = await api(`/api/reports?project=${encodeURIComponent(ui.project)}`);
    report.dates = r.dates;
    report.today = r.today;
    if (!report.dates.includes(report.date)) report.date = report.dates[0] || '';
    $('#report-date').innerHTML = report.dates.map((x) => `<option value="${x}"${x === report.date ? ' selected' : ''}>${x}${x === r.today ? ' (오늘)' : ''}</option>`).join('') || '<option value="">보고 없음</option>';
    await showReport();
  } catch (x) {
    toast(x.message);
  }
}
async function showReport() {
  const box = $('#report-body');
  if (!report.date) return (box.innerHTML = '<p class="empty">아직 보고가 없습니다 — [오늘 보고 만들기]나 <code>squad report</code> 로 만드세요</p>');
  try {
    const r = await api(`/api/report?project=${encodeURIComponent(ui.project)}&date=${report.date}`);
    box.innerHTML = mdToHtml(r.markdown);
  } catch (x) {
    box.innerHTML = `<p class="empty">${esc(x.message)}</p>`;
  }
}
$('#report-date').addEventListener('change', (e) => {
  report.date = e.target.value;
  showReport();
});
$('#report-make').addEventListener('click', async (e) => {
  e.target.disabled = true;
  try {
    const r = await api('/api/report', { project: ui.project });
    report.date = r.date;
    toast(`${r.date} 보고를 만들었습니다`);
    await loadReports();
  } catch (x) {
    toast(x.message);
  } finally {
    e.target.disabled = false;
  }
});

// ── 시작 ──
(async () => {
  setSide(sideUi.open);
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
    if (ui.tab === 'report') loadReports();
  } catch (e) {
    toast(e.message);
  }
})();
// 연결 상태는 1분마다 (서버가 5분 동안 결과를 기억하므로 claude 를 자주 부르지 않는다)
setInterval(() => !document.hidden && loadRunners(), 60000);
