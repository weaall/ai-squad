// MEMBER.md 같은 마크다운 문서를 다루는 순수 함수 모음.
// frontmatter 는 YAML 의 작은 부분집합만 읽는다: `키: 값`, `키: [a, b]`, 다음 줄들의 `- 항목` 목록,
// 다음 줄들의 `  이름: true|false` 켜기·끄기 맵(plugins 용), `#` 주석.
// ponytail: 그 밖의 중첩 객체·여러 줄 문자열은 지원하지 않는다. MEMBER.md 에 필요해지면 그때 넓힌다.

/** 따옴표 밖의 ` #` 주석을 떼어 낸다. */
function stripComment(line) {
  let quote = null;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (quote) {
      if (c === quote) quote = null;
    } else if (c === '"' || c === "'") {
      quote = c;
    } else if (c === '#' && (i === 0 || /\s/.test(line[i - 1]))) {
      return line.slice(0, i);
    }
  }
  return line;
}

function unquote(v) {
  const s = v.trim();
  if (s.length >= 2 && ((s[0] === '"' && s.at(-1) === '"') || (s[0] === "'" && s.at(-1) === "'"))) {
    return s.slice(1, -1);
  }
  return s;
}

/** `[a, "b c", d]` 를 배열로. 따옴표 안의 쉼표는 나누지 않는다. */
function parseInlineList(s) {
  const inner = s.trim().slice(1, -1);
  const out = [];
  let cur = '';
  let quote = null;
  for (const c of inner) {
    if (quote) {
      if (c === quote) quote = null;
      cur += c;
    } else if (c === '"' || c === "'") {
      quote = c;
      cur += c;
    } else if (c === ',') {
      out.push(cur);
      cur = '';
    } else cur += c;
  }
  out.push(cur);
  return out.map(unquote).filter((x) => x !== '');
}

/**
 * 문서 앞의 `---` 블록을 읽어 { data, body } 로 돌려준다. frontmatter 가 없으면 data 는 빈 객체.
 */
export function parseFrontmatter(text) {
  const src = String(text ?? '').replace(/^﻿/, '').replace(/\r\n/g, '\n');
  const m = src.match(/^---\n([\s\S]*?)\n---\n?/);
  if (!m) return { data: {}, body: src };
  const data = {};
  let listKey = null;
  for (const raw of m[1].split('\n')) {
    const line = stripComment(raw).replace(/\s+$/, '');
    if (!line.trim()) continue;
    const item = line.match(/^\s+-\s*(.*)$/) || line.match(/^-\s+(.*)$/);
    if (item && listKey && Array.isArray(data[listKey])) {
      data[listKey].push(unquote(item[1]));
      continue;
    }
    // 들여 쓴 `이름: true|false` — 켜기·끄기 맵. 이름에 `:` 가 들어갈 수 있어 마지막 `:` 에서 나눈다.
    const flag = listKey && line.match(/^\s+(.+):\s*(true|false)\s*$/);
    if (flag) {
      if (Array.isArray(data[listKey])) data[listKey] = {};
      data[listKey][unquote(flag[1])] = flag[2] === 'true';
      continue;
    }
    const kv = line.match(/^([A-Za-z_][\w-]*)\s*:\s*(.*)$/);
    if (!kv) continue;
    const [, key, value] = kv;
    if (value === '') {
      data[key] = [];
      listKey = key;
    } else if (value.trim().startsWith('[') && value.trim().endsWith(']')) {
      data[key] = parseInlineList(value);
      listKey = null;
    } else {
      data[key] = unquote(value);
      listKey = null;
    }
  }
  // 값 없이 끝난 키(`model:`)는 목록이 아니라 빈 문자열로 본다
  for (const [k, v] of Object.entries(data)) if (Array.isArray(v) && v.length === 0 && !LIST_KEYS.has(k)) data[k] = '';
  return { data, body: src.slice(m[0].length) };
}

const LIST_KEYS = new Set(['owns', 'reads', 'tools', 'plugins']);

function sectionRange(lines, title) {
  const start = lines.findIndex((l) => /^##\s/.test(l) && l.replace(/^##\s+/, '').trim().startsWith(title));
  if (start < 0) return null;
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    if (/^#{1,2}\s/.test(lines[i])) {
      end = i;
      break;
    }
  }
  return [start, end];
}

/** `## 제목` 아래 내용(다음 `##` 전까지)을 돌려준다. 없으면 빈 문자열. */
export function getSection(text, title) {
  const lines = String(text ?? '').replace(/\r\n/g, '\n').split('\n');
  const r = sectionRange(lines, title);
  if (!r) return '';
  return lines.slice(r[0] + 1, r[1]).join('\n').trim();
}

/** `## 제목` 아래 내용을 바꾼다. 절이 없으면 문서 끝에 붙인다. */
export function setSection(text, title, content) {
  const src = String(text ?? '').replace(/\r\n/g, '\n');
  const lines = src.split('\n');
  const r = sectionRange(lines, title);
  const block = content.trim() ? ['', content.trim(), ''] : [''];
  if (!r) return src.replace(/\n*$/, '\n') + `\n## ${title}\n` + (content.trim() ? `\n${content.trim()}\n` : '');
  return [...lines.slice(0, r[0] + 1), ...block, ...lines.slice(r[1])].join('\n');
}

// ── frontmatter 값 하나만 고치기 (나머지 줄·주석·본문은 그대로) ──

function fmLines(text) {
  const src = String(text ?? '');
  const eol = src.includes('\r\n') ? '\r\n' : '\n';
  const lines = src.split(/\r?\n/);
  const bom = lines[0]?.startsWith('\uFEFF') ? '\uFEFF' : '';
  if (bom) lines[0] = lines[0].slice(1);
  if (lines[0] !== '---') throw new Error('frontmatter 가 없습니다');
  const end = lines.indexOf('---', 1);
  if (end < 0) throw new Error('frontmatter 가 닫히지 않았습니다');
  return { lines, end, eol, bom };
}
const join = ({ lines, eol, bom }) => bom + lines.join(eol);
const keyLine = (lines, end, key) => lines.findIndex((l, i) => i > 0 && i < end && new RegExp(`^${key.replace(/[-]/g, '\\-')}\\s*:`).test(l));

/** 맨 위 `키: 값` 하나를 바꾼다. 줄 끝 주석은 남긴다. 키가 없으면 frontmatter 끝에 넣는다. */
export function setFrontmatterValue(text, key, value) {
  const f = fmLines(text);
  const i = keyLine(f.lines, f.end, key);
  if (i < 0) {
    f.lines.splice(f.end, 0, `${key}: ${value}`);
    return join(f);
  }
  const m = f.lines[i].match(/^([^:]+:\s*)(.*?)(\s+#.*)?$/);
  f.lines[i] = `${m[1]}${value}${m[3] || ''}`;
  return join(f);
}

/**
 * `키:` 아래 켜기·끄기 맵에서 항목 하나를 바꾼다. 배열 형식(`[a, b]` 나 `- a`)이면 그 키의 줄만 맵 형식으로 바꿔 쓴다(모두 true).
 * 항목이 없으면 맵 끝에 넣는다.
 */
export function setFrontmatterFlag(text, key, name, on) {
  const f = fmLines(text);
  const q = (n) => (/[#\s"']|^[-[]/.test(n) ? `"${n.replace(/"/g, '')}"` : n);
  const val = on ? 'true' : 'false';
  let i = keyLine(f.lines, f.end, key);
  if (i < 0) {
    f.lines.splice(f.end, 0, `${key}:`, `  ${q(name)}: ${val}`);
    return join(f);
  }
  // 그 키에 딸린 줄들(들여 쓴 줄, `- ` 줄)
  let j = i + 1;
  while (j < f.end && (/^\s+\S/.test(f.lines[j]) || /^-\s/.test(f.lines[j]))) j++;
  const head = stripComment(f.lines[i]).replace(/^[^:]+:\s*/, '').trim();
  const block = f.lines.slice(i + 1, j);
  const isMap = !head && block.length > 0 && block.every((l) => /:\s*(true|false)\s*(#.*)?$/.test(l));
  if (isMap) {
    const k = block.findIndex((l) => unquote(l.replace(/:\s*(true|false)\s*(#.*)?$/, '').trim()) === name);
    if (k >= 0) f.lines[i + 1 + k] = f.lines[i + 1 + k].replace(/(:\s*)(true|false)/, `$1${val}`);
    else f.lines.splice(j, 0, `  ${q(name)}: ${val}`);
    return join(f);
  }
  // 배열 → 맵
  const items = head.startsWith('[') ? parseInlineList(head) : block.map((l) => unquote(l.replace(/^\s*-\s*/, '')));
  if (!items.includes(name)) items.push(name);
  const comment = (f.lines[i].match(/\s+#.*$/) || [''])[0];
  f.lines.splice(i, j - i, `${key}:${comment}`, ...items.map((n) => `  ${q(n)}: ${n === name ? val : 'true'}`));
  return join(f);
}
