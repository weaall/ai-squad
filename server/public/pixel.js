// 픽셀 캐릭터 — 멤버 id 에서 정해지는 고정 팔레트·머리·옷·소품으로 16×16 격자를 만든다.
// 외부 이미지 없이 코드로만 그린다. 브라우저(app.js)와 node 테스트가 같이 쓰는 순수 함수.

export const SIZE = 16;

const SKIN = ['#f6d3b3', '#e9b48f', '#c98d63', '#9a6544'];
const HAIR = ['#2a2230', '#4a3326', '#7a4a2a', '#c9a15a', '#5d6274', '#8a3b3b'];
const SHIRT = ['#5b6fd6', '#3f8fbf', '#2f9e86', '#8a63d2', '#c2753a', '#c25674', '#4b7bd8', '#6c8a3a', '#9a5bb5'];
const HAIR_STYLES = ['short', 'long', 'bun'];
const HEAD_ITEMS = ['headset', 'glasses', 'cap', 'none'];
const PROPS = ['laptop', 'folder', 'mug', 'papers'];

/** 같은 id 는 늘 같은 수. FNV-1a. */
export function hash(id) {
  let h = 2166136261;
  for (const c of String(id)) h = Math.imul(h ^ c.codePointAt(0), 16777619) >>> 0;
  return h;
}

/** 멤버 id → 겉모습 설정. 자릿수(비트)를 나눠 써서 항목끼리 겹치지 않게 고른다. */
export function characterSpec(id) {
  const h = hash(id);
  const pick = (list, shift) => list[Math.floor(h / shift) % list.length];
  return {
    skin: pick(SKIN, 1),
    hair: pick(HAIR, 4),
    shirt: pick(SHIRT, 24),
    hairStyle: pick(HAIR_STYLES, 216),
    head: pick(HEAD_ITEMS, 648),
    prop: pick(PROPS, 2592),
    tie: Math.floor(h / 10368) % 2 === 1,
  };
}

function darken(hex, f) {
  const n = parseInt(hex.slice(1), 16);
  const c = (s) => Math.round(((n >> s) & 255) * f).toString(16).padStart(2, '0');
  return `#${c(16)}${c(8)}${c(0)}`;
}

export function characterPalette(spec) {
  return {
    s: spec.skin, m: darken(spec.skin, 0.62), e: '#1b1f2e', h: spec.hair,
    c: spec.shirt, d: darken(spec.shirt, 0.6), a: '#2b3350', g: '#1b1f2e',
    l: '#c9d1e6', L: '#7c87a6', w: '#ffffff', f: '#e0a43a', D: '#6b4f3a', r: '#ff4d4d',
  };
}

// 기본 몸: 앉아서 책상 앞에 있는 상반신. '.' 은 투명.
const BASE = [
  '................',
  '................',
  '.....hhhhhh.....',
  '....hhhhhhhh....',
  '....hssssssh....',
  '....ssessess....',
  '....ssssssss....',
  '.....ssmmss.....',
  '......ssss......',
  '....cccccccc....',
  '...cccccccccc...',
  '...cccccccccc...',
  '...sccccccccs...',
  '..DDDDDDDDDDDD..',
  '..DDDDDDDDDDDD..',
  '................',
];

function put(g, r, c, ch) {
  if (r >= 0 && r < SIZE && c >= 0 && c < SIZE) g[r][c] = ch;
}

/**
 * 격자 한 장. status: working | idle | blocked, frame: 0 | 1.
 * - working: 두 손이 번갈아 올라간다(타이핑).
 * - idle: frame 1 에서 머리가 한 칸 올라간다(숨쉬기).
 * - blocked: 움직임 없이 머리 위 오른쪽에 느낌표.
 * 돌려주는 값: 길이 16 문자열 16줄.
 */
export function characterGrid(id, { status = 'idle', frame = 0 } = {}) {
  const spec = characterSpec(id);
  const g = BASE.map((r) => r.split(''));

  if (spec.hairStyle === 'long') for (let r = 5; r <= 8; r++) { put(g, r, 4, 'h'); put(g, r, 11, 'h'); }
  if (spec.hairStyle === 'bun') { put(g, 1, 7, 'h'); put(g, 1, 8, 'h'); }

  if (spec.head === 'headset') {
    for (let c = 5; c <= 10; c++) put(g, 1, c, 'a');
    for (const r of [4, 5, 6]) { put(g, r, 3, 'a'); put(g, r, 12, 'a'); }
    put(g, 7, 4, 'a');
  } else if (spec.head === 'glasses') {
    for (const [c, ch] of [[5, 'g'], [6, 'e'], [7, 'g'], [8, 'g'], [9, 'e'], [10, 'g']]) put(g, 5, c, ch);
  } else if (spec.head === 'cap') {
    for (let c = 4; c <= 11; c++) { put(g, 2, c, 'd'); put(g, 3, c, 'd'); }
    for (let c = 3; c <= 12; c++) put(g, 4, c, 'd');
  }

  if (spec.tie) for (let r = 9; r <= 12; r++) put(g, r, 7, 'd'), put(g, r, 8, 'd');

  if (spec.prop === 'laptop') {
    for (let c = 5; c <= 10; c++) { put(g, 11, c, 'L'); put(g, 12, c, 'L'); }
    put(g, 11, 7, 'w'); put(g, 11, 8, 'w');
    for (let c = 4; c <= 11; c++) put(g, 13, c, 'l');
  } else if (spec.prop === 'folder') {
    for (let c = 6; c <= 9; c++) put(g, 11, c, 'w');
    for (let c = 5; c <= 10; c++) { put(g, 12, c, 'f'); put(g, 13, c, 'f'); }
  } else if (spec.prop === 'mug') {
    put(g, 12, 13, 'w'); put(g, 12, 14, 'w'); put(g, 11, 13, 'w'); put(g, 11, 14, 'w'); put(g, 11, 15, 'w');
  } else {
    for (let c = 4; c <= 7; c++) put(g, 12, c, 'w');
    for (let c = 8; c <= 11; c++) put(g, 13, c, 'w');
  }

  if (status === 'working') {
    // 손 하나는 책상 위(12줄), 다른 하나는 한 칸 위(11줄). 프레임마다 바뀐다.
    const up = frame % 2 === 0 ? 3 : 12;
    put(g, 12, up, 'c');
    put(g, 11, up, 's');
  } else if (status === 'idle' && frame % 2 === 1) {
    // 머리(0~7줄)를 한 칸 올린다. 목(8줄)은 그대로라 숨 들이쉬는 듯 보인다.
    for (let r = 0; r < 7; r++) g[r] = g[r + 1].slice();
  } else if (status === 'blocked') {
    for (const r of [0, 1, 2, 4]) { put(g, r, 13, 'r'); put(g, r, 14, 'r'); }
  }
  return g.map((r) => r.join(''));
}

/** 캐릭터 한 장: { grid, palette } */
export function character(id, opts) {
  return { grid: characterGrid(id, opts), palette: characterPalette(characterSpec(id)) };
}

/** canvas 2d 에 그린다. (x, y) 는 왼쪽 위, px 는 한 칸 크기. */
export function drawCharacter(ctx, ch, x, y, px) {
  for (let r = 0; r < SIZE; r++) {
    const row = ch.grid[r];
    for (let c = 0; c < SIZE; c++) {
      const color = ch.palette[row[c]];
      if (!color) continue;
      ctx.fillStyle = color;
      ctx.fillRect(Math.round(x + c * px), Math.round(y + r * px), Math.ceil(px), Math.ceil(px));
    }
  }
}
