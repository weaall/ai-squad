#!/usr/bin/env node
// 시연용: 몇 초 간격으로 메시지·작업·이벤트를 만들어 보드가 움직이는 모습을 보여 준다.
// 실제 기록과 섞이지 않게 data/demo/ 아래 별도 파일에만 쓴다. 보드는 `squad board --demo` 로 이 파일을 읽는다.
// v0.3: 토큰 사용량(end 이벤트의 usage), 승인 요청(approvals.jsonl), 답 없는 인계, 멈춘 멤버도 보여 준다.
// v0.4: 예산 경고(오늘 사용량을 상한의 80% 넘게 + 예산 승인 카드), 의존 작업(선행·잠금), 검수 칸, 일일 보고, 데스크톱 inbox,
//       상세(SQL·파일·명령·되돌리기)가 붙은 DB 마이그레이션 승인 요청. 모든 상세에 "시연" 표시를 남긴다.
//
//   node scripts/demo-events.mjs [project] [--interval 2500] [--count N] [--reset]
//     --reset  시연 파일을 지우고 끝낸다
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { appendJsonl, loadMembers, newId, projectPaths, readJsonl, updateTask } from '../lib/store.mjs';
import { loadApprovals, requestApproval } from '../lib/approvals.mjs';
import { loadConfig } from '../lib/config.mjs';
import { finishReview } from '../lib/runner.mjs';
import { buildReport, dateKey } from '../lib/report.mjs';
import { addInbox, doneInbox, takeInbox } from '../lib/inbox.mjs';
import { budgetTokens } from '../lib/state.mjs';

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
const task = (member, title, detail, status = 'todo', ago = 0, extra = {}) =>
  appendJsonl(paths.tasks, { id: newId('T'), title, detail, member, status, createdBy: 'order', createdAt: iso(-ago), updatedAt: iso(-ago), summary: '', demo: true, ...extra });
const setTask = (id, patch) => updateTask(paths.tasks, id, patch);
const tool = (member, name, p) => ev(member, { type: 'tool', tool: name, path: p });
// 예산은 보드와 같은 기준(budgetTokens 환산)으로 센다. 0 은 상한 없음.
const daily = loadConfig(ROOT).budget.daily;
const usedToday = () => readJsonl(paths.events).filter((e) => e.usage && dateKey(e.at) === dateKey(Date.now())).reduce((n, e) => n + budgetTokens(e.usage), 0);
// 시연용 사용량 — 실제 값이 아니다. 상한이 있으면 바퀴가 돌아도 상한의 95% 를 넘기지 않는다(80% 경고는 보이게).
const usage = (input, output, cacheRead = 0) => {
  const u = { input, output, cacheRead, cacheWrite: Math.round(input / 4) };
  return daily > 0 && usedToday() + budgetTokens(u) > daily * 0.95 ? { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } : u;
};
const end = (member, taskId, u, ago = 0) => ev(member, { type: 'end', taskId, status: 'idle', text: '완료', usage: u }, ago);
const finish = (t, summary, u) => {
  setTask(t.id, { status: 'done', summary, usage: u });
  end(t.member, t.id, u);
};

let ctx = {};
// 처음 열었을 때 비어 보이지 않게 지난 기록 몇 개를 깔아 둔다
if (!readJsonl(paths.messages).length) {
  const m = 60000;
  const t1 = task('survey-report', '결과지 KOSS 요약 문단 문구 정리', 'lib/report-content 한 곳에서만 고친다', 'done', 40 * m);
  setTask(t1.id, { summary: '요약 문단 3개를 report-content 로 옮기고 PDF 출력 확인', usage: usage(18200, 2400, 41000) });
  const t2 = task('backend', '기관별 응답 집계 API 에 부서 범주 추가', '부서명 대신 범주, k-익명성 기준', 'todo', 30 * m);
  // 멈춤: 50분 전에 받은 할 일이 있는데 한 번도 움직이지 않았다
  task('ops', '보안 로드맵 2단계 점검표 갱신', 'SECURITY-ROADMAP.md 만, 배포는 사람 확인 후', 'todo', 50 * m);
  task('biz-docs', '검진기관 PoC 제안서 초안', '유투바이오·메디체크 기준, KOSS+K-ELS 중심', 'todo', 20 * m);
  msg('human', 'order', 'order', '결과지 요약 문구 정리하고 부서 범주 집계도 준비해 주세요', '', 42 * m);
  msg('order', 'survey-report', 'order', '결과지 KOSS 요약 문단 문구 정리', t1.id, 41 * m);
  msg('survey-report', 'order', 'report', '요약 문단을 report-content 로 옮겼습니다. PDF 출력 확인 끝.', t1.id, 35 * m);
  msg('order', 'backend', 'order', '기관별 응답 집계 API 에 부서 범주 추가', t2.id, 30 * m);
  msg('backend', 'order', 'question', '범주 기준표는 어디서 받나요? 가명처리 문서 기준으로 할까요?', t2.id, 28 * m);
  msg('order', 'backend', 'answer', 'docs/PSEUDONYMIZATION.md 기준으로 진행하세요.', t2.id, 27 * m);
  end('survey-report', t1.id, usage(18200, 2400, 41000), 35 * m);
  ev('order', { type: 'plan', text: '계획 2개', usage: usage(6400, 900) }, 41 * m);
  // 답 없는 인계: 45분 전에 넘겼는데 받은 쪽이 아직 답하지 않았다
  msg('site', 'biz-docs', 'handoff', '검진기관 안내 문구가 PoC 문서와 맞는지 봐 주세요. 제 owns 밖입니다.', '', 45 * m);
  ev('backend', { type: 'log', status: 'idle', text: '답변 대기 끝, 다음 순서 대기' }, 26 * m);

  // v0.4 의존: 부서 범주 API(t2)가 끝나야 대시보드 필터를 시작할 수 있다 → 칸반에 "선행"·잠금
  task('org-dashboard', '대시보드에 부서 범주 필터 추가', '백엔드 집계 API 가 끝난 뒤', 'todo', 25 * m, { dependsOn: [t2.id], step: 2 });
  // v0.4 검수: 사이트 작업이 끝나 검수 멤버(사업 문서)를 기다린다
  ctx.review = task('site', '검진기관 안내 페이지 문구 보강', 'app/service/** 만', 'review', 18 * m, {
    reviewer: 'biz-docs', summary: '검진기관 안내 3문단 보강, 금지어 점검 통과',
    diffStat: [{ path: 'qugo_fe_web/app/service/checkup/page.tsx', add: 42, del: 9 }, { path: 'qugo_fe_web/lib/guides/checkup.ts', add: 18, del: 2 }],
    usage: usage(16400, 2100, 30000),
  });
  msg('site', 'biz-docs', 'handoff', '검수 부탁드립니다: 검진기관 안내 페이지 문구 보강', ctx.review.id, 17 * m);
  // v0.4 예산: 오늘 사용량을 하루 상한의 82% 쯤으로(시연 값) → 상단 막대가 노랗게, 오더의 예산 확인 카드
  if (daily > 0) {
    // 캐시 없이 입력·출력만 쓰면 환산 토큰 = 그대로 합이라 82% 에 정확히 맞는다
    const need = Math.max(0, Math.round(daily * 0.82) - usedToday());
    ev('survey-report', { type: 'end', status: 'idle', text: '완료', usage: { input: Math.round(need * 0.8), output: need - Math.round(need * 0.8), cacheRead: 0, cacheWrite: 0 } }, 15 * m);
    requestApproval(paths, {
      from: 'order', action: 'budget', text: '예산 82% — 계획 · 대시보드 부서 범주 필터 일정 다시 잡기',
      reason: '오늘 전체 사용량이 하루 상한의 82% 입니다 (시연 값)', scope: '오늘 남은 토큰 예산', demo: true,
    });
  }
  // v0.4 데스크톱 세션 inbox: 하나는 끝, 하나는 대기
  const i1 = addInbox(paths, '결과지 A4 여백을 이 세션에서 바로 손봐 줘 (시연)');
  takeInbox(paths);
  doneInbox(paths, i1.id, '여백 12mm 로 맞추고 PDF 출력 확인 (시연)');
  addInbox(paths, '메인 페이지 히어로 문구 두 안을 비교해 줘 (시연)');
  console.log('시연 기본 기록을 깔았습니다');
}

// 한 바퀴 시나리오. 끝나면 처음부터 다시 돈다.
let round = 0;
const steps = [
  () => {
    msg('human', 'order', 'order', '메인 페이지 SEO 점검하고 기업 대시보드 이번 달 KPI 카드 정리해 주세요');
    ev('order', { type: 'plan', text: '계획 2개', usage: usage(7200, 1100) });
  },
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
    end('admin-dashboard', ctx.admin.id, usage(9100, 1300, 22000));
  },
  () => {
    msg('order', 'backend', 'answer', 'dev 쪽 마이그레이션 먼저, 부서 범주는 그 뒤 이름으로 다시 만드세요.');
    ev('backend', { type: 'start', text: '마이그레이션 순서 정리' });
    // 위험 행위는 직접 하지 않고 승인을 요청한다 → 보드에 확인 모달이 뜬다 (이미 대기 중이면 또 만들지 않는다)
    if (!loadApprovals(paths).some((a) => a.status === 'pending' && a.from === 'backend')) {
      requestApproval(paths, {
        from: 'backend', action: 'migrate', text: '부서 범주 마이그레이션을 로컬 DB 에 적용',
        reason: 'dev 마이그레이션 뒤 순서로 이름을 다시 만들었습니다. 적용해야 집계 API 를 시험할 수 있습니다.',
        scope: 'qugo_be_api/prisma/migrations/** (로컬 DB 만, 운영 DB 아님)', demo: true,
        risk: 'high',
        details: '**시연 데이터입니다 — 실제 마이그레이션이 아닙니다.**\n\n- 응답 집계에 `department_category` 열을 더합니다(부서명 대신 범주, k-익명성 기준).\n- 로컬 DB 에만 적용합니다. 운영 DB 는 건드리지 않습니다.',
        files: ['qugo_be_api/prisma/schema.prisma', 'qugo_be_api/prisma/migrations/20261019_dept_category/migration.sql'],
        commands: ['cd qugo_be_api', 'npx prisma migrate dev --name dept_category'],
        diff: [
          '-- 시연용 예시 SQL (실제 파일 아님)',
          'ALTER TABLE "SurveyResponse" ADD COLUMN "departmentCategory" TEXT;',
          'CREATE INDEX "SurveyResponse_org_dept_idx" ON "SurveyResponse" ("organizationId", "departmentCategory");',
          'UPDATE "SurveyResponse" SET "departmentCategory" = \'기타\' WHERE "departmentCategory" IS NULL;',
        ].join('\n'),
        rollback: '로컬 DB 에서 npx prisma migrate reset 후 dev 브랜치 마이그레이션까지 다시 적용 (시연)',
      });
      ev('backend', { type: 'log', status: 'blocked', text: '승인 대기 · DB 마이그레이션' });
    }
    tool('org-dashboard', 'Edit', 'qugo_fe_web/app/organization/dashboard/page.tsx');
  },
  () => {
    tool('backend', 'Edit', 'qugo_be_api/prisma/schema.prisma');
    tool('site', 'Bash', '');
  },
  () => {
    // v0.4: 끝난 작업은 검수 멤버(사업 문서)를 기다린다 → 칸반 "검수" 칸, 마지막 단계에서 통과
    const u = usage(24800, 3100, 52000);
    setTask(ctx.site.id, {
      status: 'review', reviewer: 'biz-docs', summary: 'h1 하나 유지, 부제 p 로, sitemap 수정일 갱신', usage: u,
      diffStat: [{ path: 'qugo_fe_web/app/page.tsx', add: 12, del: 4 }, { path: 'qugo_fe_web/app/sitemap.ts', add: 2, del: 1 }],
    });
    ev('site', { type: 'end', taskId: ctx.site.id, status: 'idle', text: '검수 대기', usage: u });
    msg('site', 'order', 'report', '메인 메타·h1 점검 끝. 부제는 p, sitemap 갱신. 테스트 통과.', ctx.site.id);
    msg('site', 'biz-docs', 'handoff', '검수 부탁드립니다: 메인 페이지 메타·h1 점검', ctx.site.id);
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
    finish(ctx.org, "KPI 카드에 '전월 대비' 배지, 이번 달 강조", usage(15600, 2200, 30500));
    msg('org-dashboard', 'order', 'report', "KPI 카드 '전월 대비' 표시 끝. tsc·eslint 통과.", ctx.org.id);
  },
  () => {
    msg('ops', 'order', 'note', '배포 체크리스트는 그대로입니다. push 는 계속 보류합니다.');
    ev('backend', { type: 'end', status: 'idle', text: '완료', usage: usage(11300, 1700, 19000) });
  },
  () => {
    finish(ctx.biz, 'PoC 한 장 요약, 대외 금지어 점검', usage(20500, 4200, 26000));
    msg('biz-docs', 'order', 'report', 'PoC 한 장 요약 초안 끝. 임상 자문은 "협의 중"으로 표기.', ctx.biz.id);
  },
  () => msg('order', 'human', 'report', '이번 지시 3건 완료, 백엔드 마이그레이션 순서 정리됨. push 는 보류 상태입니다.'),
  () => {
    // 검수 대기 작업이 있으면 검수 멤버가 통과시킨다(시연)
    const r = readJsonl(paths.tasks).find((t) => t.status === 'review');
    if (r) finishReview({ paths, task: r, reviewer: r.reviewer || 'biz-docs', verdict: { pass: true, note: '문구·금지어 확인, 통과 (시연)' } });
    writeReport();
  },
];

/** 오늘 보고를 시연 폴더(data/demo/<project>/reports)에 쓴다 — 보드의 "보고" 탭 */
function writeReport() {
  const date = dateKey(Date.now());
  const r = buildReport({
    project: paths, date, members: loadMembers(paths), tasks: readJsonl(paths.tasks), messages: readJsonl(paths.messages),
    approvals: loadApprovals(paths), events: readJsonl(paths.events).filter((e) => e.project === project), budget: loadConfig(ROOT).budget,
  });
  fs.mkdirSync(paths.reports, { recursive: true });
  fs.writeFileSync(path.join(paths.reports, `${date}.md`), r.markdown.replace(/\n/, '\n\n> 시연 데이터로 만든 보고입니다.\n'), 'utf8');
}
writeReport();

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
