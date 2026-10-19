// 멤버가 켠 기술을 실제로 쓰게 — 출력 스타일 본문과 '켜진 기술' 절을 claude 시스템 프롬프트 뒤에 붙인다.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dirs = (d) => {
  try {
    return fs.readdirSync(d, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name);
  } catch {
    return [];
  }
};
const read = (f) => {
  try {
    return fs.readFileSync(f, 'utf8');
  } catch {
    return '';
  }
};
const verCmp = (a, b) => {
  const x = a.split(/[.-]/), y = b.split(/[.-]/);
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    const d = (Number(x[i]) || 0) - (Number(y[i]) || 0);
    if (d) return d;
  }
  return a.localeCompare(b);
};
const highest = (d) => dirs(d).sort(verCmp).at(-1);
const stripFront = (t) => t.replace(/^﻿?---\r?\n[\s\S]*?\r?\n---\r?\n?/, '').trim();

/** 설치된 플러그인 폴더(가장 높은 버전): [{ plugin, dir }]. 캐시 구조 plugins/cache/<마켓>/<플러그인>/<버전>, 동기화 plugins/synced/<묶음>/<플러그인>. */
function pluginDirs(home) {
  const base = path.join(home, '.claude', 'plugins');
  const out = [];
  for (const m of dirs(path.join(base, 'cache'))) {
    for (const p of dirs(path.join(base, 'cache', m))) {
      const v = highest(path.join(base, 'cache', m, p));
      if (v) out.push({ plugin: p, dir: path.join(base, 'cache', m, p, v) });
    }
  }
  for (const b of dirs(path.join(base, 'synced'))) for (const p of dirs(path.join(base, 'synced', b))) out.push({ plugin: p, dir: path.join(base, 'synced', b, p) });
  return out;
}

/** 출력 스타일 이름 → .md 경로(플러그인 output-styles 의 가장 높은 버전, 없으면 ~/.claude/output-styles). 못 찾으면 ''. */
export function outputStyleFile(name, home = os.homedir()) {
  if (!name || !/^[\w.-]+$/.test(name)) return '';
  const hits = pluginDirs(home).map((p) => path.join(p.dir, 'output-styles', `${name}.md`));
  return [...hits, path.join(home, '.claude', 'output-styles', `${name}.md`)].find((f) => fs.existsSync(f)) || '';
}

/** SKILL.md 의 description 첫 문장(80자). */
function describe(file) {
  const fm = read(file).match(/^﻿?---\r?\n([\s\S]*?)\r?\n---/)?.[1] || '';
  const m = fm.match(/^description:[ \t]*(?:[|>][-+]?[ \t]*\r?\n[ \t]+)?(.+)$/m);
  const d = (m?.[1] || '').trim().replace(/^["']|["']$/g, '');
  return (d.split(/(?<=[.!?。])\s/)[0] || d).slice(0, 80);
}

/** 켠 이름(플러그인 · 플러그인:스킬 · 스킬) → [{ name, desc }]. 플러그인 하나는 스킬 8개까지. 설명을 못 찾으면 이름만. */
export function skillList(names = [], home = os.homedir()) {
  const plugins = pluginDirs(home);
  const userSkill = (s) => [path.join(home, '.claude', 'skills', s, 'SKILL.md'), ...dirs(path.join(home, '.claude', 'skills', 'synced')).map((b) => path.join(home, '.claude', 'skills', 'synced', b, s, 'SKILL.md'))].find((f) => fs.existsSync(f));
  const out = [];
  for (const n of names) {
    if (n === 'headroom') continue; // 실행 감싸기용, 스킬 아님
    const [p, s] = n.includes(':') ? n.split(':') : [n, ''];
    const pd = plugins.find((x) => x.plugin === p);
    if (s) {
      const f = pd && path.join(pd.dir, 'skills', s, 'SKILL.md');
      out.push({ name: n, desc: f ? describe(f) : '' });
    } else if (pd && dirs(path.join(pd.dir, 'skills')).length) {
      for (const k of dirs(path.join(pd.dir, 'skills')).slice(0, 8)) out.push({ name: `${p}:${k}`, desc: describe(path.join(pd.dir, 'skills', k, 'SKILL.md')) });
    } else {
      const f = userSkill(n);
      out.push({ name: n, desc: f ? describe(f) : '' });
    }
  }
  return out;
}

/** --append-system-prompt-file 에 넣을 본문. 둘 다 없으면 ''. */
export function systemAppend({ outputStyle = '', plugins = [] } = {}, home = os.homedir()) {
  const style = outputStyle ? stripFront(read(outputStyleFile(outputStyle, home))) : '';
  const skills = skillList(plugins, home);
  const section = skills.length
    ? ['# 켜진 기술', '해당되는 일이면 먼저 Skill 도구로 그 스킬을 불러 지시를 따르라. 플러그인 이름만 있으면 그 플러그인의 스킬 중 맞는 것을 부른다.', ...skills.map((k) => `- ${k.name}${k.desc ? ` — ${k.desc}` : ''}`)].join('\n')
    : '';
  return [style, section].filter(Boolean).join('\n\n');
}
