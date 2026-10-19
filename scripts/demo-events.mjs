#!/usr/bin/env node
// 시연용: 몇 초 간격으로 메시지·작업·이벤트를 만들어 보드가 움직이는 모습을 보여 준다.
// 실제 기록과 섞이지 않게 data/demo/ 아래 별도 파일에만 쓴다. 보드는 `squad board --demo` 로 이 파일을 읽는다.
//
//   node scripts/demo-events.mjs [project] [--interval 2500] [--count N] [--reset]
//     --reset  시연 파일을 지우고 끝낸다
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { appendJsonl, loadMembers, newId, projectPaths, readJsonl, updateTask } from '../lib/store.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { values: o, positionals } = parseArgs({
  allowPositionals: true,
  options: { interval: { type: 'string', default: '2500' }, count: { type: 'string' }, reset: { type: 'boolean' } },
});
const project = positionals[0] || 'qugo';
const paths = projectPaths(ROOT, project, { demo: true });

if (o.reset) {
  fs.rmSync(path.dirname(paths.tasks), { recursive: true, force: true });
  // 다른 프로젝트 시연 이벤트는 남긴다
  const rest = readJsonl(paths.events).filter((e) => e.project !== project);
  fs.writeFileSync(paths.events, rest.map((e) => JSON.stringify(e)).join('\n') + (rest.length ? '\n' : ''));
  console.log(`시연 데이터를 지웠습니다 (${project})`);
  process.exit(0);
}

const ids = new Set(loadMembers(paths).map((m) => m.id));
const need = ['order', 'site', 'org-dashboard', 'admin-dashboard', 'survey-report', 'backend', 'biz-docs', 'ops'];
const missing = need.filter((id) => !ids.has(id));
if (missing.length) {
  console.error(`시연에 필요한 멤버가 없습니다: ${missing.join(', ')}`);
  process.exit(1);
}

const iso = (ms = 0) => new Date(Date.now() + ms).toISOString();
const msg = (from, to, kind, text, taskId, ago = 0) =>
  appendJsonl(paths.messages, { id: newId('M'), at: iso(-ago), from, to, kind, text, ...(taskId ? { taskId } : {}), demo: true });
const ev = (member, e, ago = 0) => appendJsonl(paths.events, { at: iso(-ago), project, member, ...e, demo: true });
const task = (member, title, detail, status = 'todo', ago = 0) =>
  appendJsonl(paths.tasks, { id: newId('T'), title, detail, member, status, createdBy: 'order', createdAt: iso(-ago), updatedAt: iso(-ago), summary: '', demo: true });
const setTask = (id, patch) => updateTask(paths.tasks, id, patch);
const tool = (member, name, p) => ev(member, { type: 'tool', tool: name, path: p });

// 처음 열었을 때 비어 보이지 않게 지난 기록 몇 개를 깔아 둔다
if (!readJsonl(paths.messages).length) {
  const m = 60000;
  const t1 = task('survey-report', '결과지 KOSS 요약 문단 문구 정리', 'lib/report-content 한 곳에서만 고친다', 'done', 40 * m);
  setTask(t1.id, { summary: '요약 문단 3개를 report-content 로 옮기고 PDF 출력 확인' });
  const t2 = task('backend', '기관별 응답 집계 API 에 부서 범주 추가', '부서명 대신 범주, k-익명성 기준', 'todo', 30 * m);
  task('ops', '보안 로드맵 2단계 점검표 갱신', 'SECURITY-ROADMAP.md 만, 배포는 사람 확인 후', 'todo', 25 * m);
  task('biz-docs', '검진기관 PoC 제안서 초안', '유투바이오·메디체크 기준, KOSS+K-ELS 중심', 'todo', 20 * m);
  msg('human', 'order', 'order', '결과지 요약 문구 정리하고 부서 범주 집계도 준비해 주세요', '', 42 * m);
  msg('order', 'survey-report', 'order', '결과지 KOSS 요약 문단 문구 정리', t1.id, 41 * m);
  msg('survey-report', 'order', 'report', '요약 문단을 report-content 로 옮겼습니다. PDF 출력 확인 끝.', t1.id, 35 * m);
  msg('order', 'backend', 'order', '기관별 응답 집계 API 에 부서 범주 추가', t2.id, 30 * m);
  msg('backend', 'order', 'question', '범주 기준표는 어디서 받나요? 가명처리 문서 기준으로 할까요?', t2.id, 28 * m);
  msg('order', 'backend', 'answer', 'docs/PSEUDONYMIZATION.md 기준으로 진행하세요.', t2.id, 27 * m);
  ev('survey-report', { type: 'end', status: 'idle', text: '완료' }, 35 * m);
  ev('backend', { type: 'log', status: 'idle', text: '답변 대기 끝, 다음 순서 대기' }, 26 * m);
  console.log('시연 기본 기록을 깔았습니다');
}

// 한 바퀴 시나리오. 끝나면 처음부터 다시 돈다.
let ctx = {};
let round = 0;
const steps = [
  () => msg('human', 'order', 'order', '메인 페이지 SEO 점검하고 기업 대시보드 이번 달 KPI 카드 정리해 주세요'),
  () => {
    ctx.site = task('site', `메인 페이지 메타·h1 점검${round ? ` (${round + 1}차)` : ''}`, 'h1 하나, metadata, sitemap 확인', 'doing');
    msg('order', 'site', 'order', '메인 페이지 메타·h1 점검 — SEO 최우선 영역', ctx.site.id);
    ev('site', { type: 'start', taskId: ctx.site.id, text: ctx.site.title });
  },
  () => {
    ctx.org = task('org-dashboard', `이번 달 KPI 카드에 전월 대비 표시${round ? ` (${round + 1}차)` : ''}`, "'이번 달'·'전월 대비' 표현만", 'doing');
    msg('order', 'org-dashboard', 'order', '이번 달 KPI 카드에 전월 대비 표시', ctx.org.id);
    ev('org-dashboard', { type: 'start', taskId: ctx.org.id, text: ctx.org.title });
  },
  () => tool('site', 'Read', 'qugo_fe_web/app/page.tsx'),
  () => {
    tool('org-dashboard', 'Read', 'qugo_fe_web/app/organization/page.tsx');
    tool('site', 'Grep', 'qugo_fe_web/app/**/layout.tsx');
  },
  () => tool('site', 'Edit', 'qugo_fe_web/app/page.tsx'),
  () => {
    ctx.admin = task('admin-dashboard', 'KPI 카드 공용 부품에 비교 배지 추가', 'org-dashboard 인계', 'doing');
    msg('org-dashboard', 'admin-dashboard', 'handoff', '공용 KpiCard 에 전월 대비 배지 슬롯이 필요합니다. 제 owns 밖이라 넘깁니다.', ctx.admin.id);
  },
  () => {
    ev('admin-dashboard', { type: 'start', taskId: ctx.admin.id, text: ctx.admin.title });
    tool('admin-dashboard', 'Read', 'qugo_fe_web/components/dashboard/KpiCard.tsx');
  },
  () => msg('site', 'order', 'question', '히어로 h1 "온라인 문진 플랫폼" 뒤에 부제 붙여도 되나요?', ctx.site.id),
  () => {
    msg('order', 'site', 'answer', 'h1 은 그대로 두고 부제는 p 로 넣으세요.', ctx.site.id);
    tool('admin-dashboard', 'Edit', 'qugo_fe_web/components/dashboard/KpiCard.tsx');
  },
  () => {
    ev('backend', { type: 'log', status: 'blocked', text: '마이그레이션 이름 충돌 — 확인 필요' });
    msg('backend', 'order', 'question', '부서 범주 마이그레이션 이름이 dev 와 겹칩니다. 순서 정해 주세요.');
  },
  () => {
    tool('admin-dashboard', 'Bash', '');
    tool('site', 'Edit', 'qugo_fe_web/app/sitemap.ts');
  },
  () => {
    msg('admin-dashboard', 'org-dashboard', 'handoff', 'KpiCard 에 compare 속성을 넣었습니다. 이제 쓰셔도 됩니다.', ctx.org.id);
    setTask(ctx.admin.id, { status: 'done', summary: 'compare 속성 추가, 테스트 통과' });
    ev('admin-dashboard', { type: 'end', status: 'idle', text: '완료' });
  },
  () => {
    msg('order', 'backend', 'answer', 'dev 쪽 마이그레이션 먼저, 부서 범주는 그 뒤 이름으로 다시 만드세요.');
    ev('backend', { type: 'start', text: '마이그레이션 순서 정리' });
    tool('org-dashboard', 'Edit', 'qugo_fe_web/app/organization/dashboard/page.tsx');
  },
  () => {
    tool('backend', 'Edit', 'qugo_be_api/prisma/schema.prisma');
    tool('site', 'Bash', '');
  },
  () => {
    setTask(ctx.site.id, { status: 'done', summary: 'h1 하나 유지, 부제 p 로, sitemap 수정일 갱신' });
    msg('site', 'order', 'report', '메인 메타·h1 점검 끝. 부제는 p, sitemap 갱신. 테스트 통과.', ctx.site.id);
    ev('site', { type: 'end', status: 'idle', text: '완료' });
  },
  () => {
    ctx.biz = task('biz-docs', '검진기관용 PoC 한 장 요약', 'KOSHA 근거 + 검진기관, 표본 건수 표기 금지', 'doing');
    msg('order', 'biz-docs', 'order', '검진기관용 PoC 한 장 요약', ctx.biz.id);
    ev('biz-docs', { type: 'start', taskId: ctx.biz.id, text: ctx.biz.title });
  },
  () => {
    tool('biz-docs', 'Write', 'qugo_fe_web/docs/business/poc-summary.md');
    tool('org-dashboard', 'Bash', '');
  },
  () => {
    setTask(ctx.org.id, { status: 'done', summary: "KPI 카드에 '전월 대비' 배지, 이번 달 강조" });
    msg('org-dashboard', 'order', 'report', "KPI 카드 '전월 대비' 표시 끝. tsc·eslint 통과.", ctx.org.id);
    ev('org-dashboard', { type: 'end', status: 'idle', text: '완료' });
  },
  () => {
    msg('ops', 'order', 'note', '배포 체크리스트는 그대로입니다. push 는 계속 보류합니다.');
    ev('backend', { type: 'end', status: 'idle', text: '완료' });
  },
  () => {
    setTask(ctx.biz.id, { status: 'done', summary: 'PoC 요약 한 장, 대외 금지어 점검' });
    msg('biz-docs', 'order', 'report', 'PoC 한 장 요약 초안 끝. 임상 자문은 "협의 중"으로 표기.', ctx.biz.id);
    ev('biz-docs', { type: 'end', status: 'idle', text: '완료' });
  },
  () => msg('order', 'human', 'report', '이번 지시 3건 완료, 백엔드 마이그레이션 순서 정리됨. push 는 보류 상태입니다.'),
];

const interval = Math.max(300, Number(o.interval) || 2500);
const limit = o.count ? Number(o.count) : Infinity;
let i = 0;
console.log(`시연 이벤트를 ${interval}ms 간격으로 보냅니다 (Ctrl+C 로 멈춤). 보드: node bin/squad.mjs board --demo`);
const timer = setInterval(() => {
  steps[i % steps.length]();
  i++;
  if (i % steps.length === 0) {
    round++;
    ctx = {};
  }
  if (i >= limit) clearInterval(timer);
}, interval);
