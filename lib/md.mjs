// MEMBER.md 같은 마크다운 문서를 다루는 순수 함수 모음.
// frontmatter 는 YAML 의 작은 부분집합만 읽는다: `키: 값`, `키: [a, b]`, 다음 줄들의 `- 항목` 목록, `#` 주석.
// ponytail: 중첩 객체·여러 줄 문자열은 지원하지 않는다. MEMBER.md 에 필요해지면 그때 넓힌다.

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
    if (item && listKey) {
      data[listKey].push(unquote(item[1]));
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
