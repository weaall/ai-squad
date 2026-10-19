// 멤버마다 git worktree — 같은 작업 트리에서 동시에 고치다 서로 변경이 섞이는 일을 막는다(2026-10-19 import 한 줄 사라짐).
// <프로젝트>/.squad-worktrees/<member>-<taskId> 에 squad/<member>/<taskId> 브랜치로 만들고, 끝나면 rebase 후 fast-forward 병합.
// .squad 는 sparse-checkout 으로 빼고 원래 .squad 로 정션 → NOTES·tasks 는 원래 경로에 쓰이고, claude 어댑터 linkedDirs 가 --add-dir 로 연다.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

export const WORKTREE_DIR = '.squad-worktrees';
export const CONFLICT_REASON = '병합 충돌';
// 원래 트리 것을 정션으로 잇는 폴더. 지울 때는 정션만 끊는다(실제 폴더가 지워지는 사고 방지).
const LINKS = ['.squad', 'node_modules'];

function git(cwd, args) {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8', windowsHide: true, maxBuffer: 64 << 20 });
  return { ok: r.status === 0, out: (r.stdout || '').trim(), err: (r.stderr || r.error?.message || '').trim() };
}
function must(cwd, args) {
  const r = git(cwd, args);
  if (!r.ok) throw new Error(`git ${args[0]} 실패: ${r.err.slice(0, 300)}`);
  return r.out;
}

/** 작업 공간을 만든다 → { dir, branch, base }. base = 원래 트리의 현재 브랜치. 분리된 HEAD 면 던진다. */
export function createWorktree({ root, member, taskId }) {
  const base = must(root, ['rev-parse', '--abbrev-ref', 'HEAD']);
  if (base === 'HEAD') throw new Error('원래 트리가 브랜치 위에 있지 않아 worktree 를 만들 수 없습니다');
  const dir = path.join(root, WORKTREE_DIR, `${member}-${taskId}`);
  const branch = `squad/${member}/${taskId}`;
  // 같은 작업을 다시 돌리면(재시도·반려) 남은 worktree 를 그대로 쓴다
  if (fs.existsSync(path.join(dir, '.git'))) return { dir, branch, base };
  must(root, ['worktree', 'add', '--no-checkout', '-b', branch, dir, base]);
  must(dir, ['sparse-checkout', 'set', '--no-cone', '/*', '!/.squad/']);
  // 정션 너머 .squad 파일을 git 이 변경으로 보지 않게(2.37+ 는 있는 파일의 skip-worktree 를 풀어 버린다)
  must(dir, ['config', '--worktree', 'sparse.expectFilesOutsideOfPatterns', 'true']);
  must(dir, ['checkout', '-q']);
  for (const name of LINKS) {
    const real = path.join(root, name);
    if (fs.existsSync(real) && !fs.existsSync(path.join(dir, name))) fs.symlinkSync(real, path.join(dir, name), 'junction');
  }
  return { dir, branch, base };
}

/** 정션만 끊고 worktree·브랜치를 지운다. 정션이 안 끊기면 던진다(git 이 정션 너머 실제 폴더까지 지우지 않게). */
export function removeWorktree({ root, dir, branch }) {
  for (const name of LINKS) {
    const p = path.join(dir, name);
    let st;
    try {
      st = fs.lstatSync(p);
    } catch {
      continue;
    }
    if (st.isSymbolicLink()) fs.unlinkSync(p); // 실패하면 던진다 → 아래 git 정리까지 가지 않는다
  }
  must(root, ['worktree', 'remove', '--force', dir]);
  git(root, ['branch', '-D', branch]);
}

/**
 * 끝난 작업 공간을 원래 브랜치로 합친다 → { status, commits, text }.
 * - empty: 커밋도 변경도 없음 → 정리
 * - merged: rebase 후 fast-forward 병합 → 정리
 * - dirty: 커밋 안 된 변경이 남음 → worktree 를 남긴다(지우면 작업이 사라짐)
 * - conflict: rebase 충돌이나 원래 트리의 같은 파일 수정으로 병합 못 함 → worktree 를 남긴다(blockedReason: CONFLICT_REASON)
 * 동기 실행이라 한 프로세스 안에서 두 멤버의 병합이 섞이지 않는다.
 */
export function finishWorktree({ root, dir, branch, base }) {
  const keep = (status, text) => ({ status, commits: Number(git(dir, ['rev-list', '--count', `${base}..HEAD`]).out) || 0, text: `${text} — worktree 를 남겼습니다: ${dir}` });
  // 정션 너머(.squad 의 tasks·messages 등 새 파일)는 원래 트리 것이라 뺀다
  if (git(dir, ['status', '--porcelain', '--', '.', ...LINKS.map((n) => `:(exclude)${n}`)]).out) return keep('dirty', '커밋하지 않은 변경이 있습니다');
  const commits = Number(must(dir, ['rev-list', '--count', `${base}..HEAD`]));
  if (!commits) {
    removeWorktree({ root, dir, branch });
    return { status: 'empty', commits: 0, text: '커밋 없음' };
  }
  const rb = git(dir, ['rebase', base]);
  if (!rb.ok) {
    git(dir, ['rebase', '--abort']);
    return keep('conflict', `${CONFLICT_REASON}: ${base} 위로 rebase 하지 못했습니다`);
  }
  const ff = git(root, ['merge', '--ff-only', branch]);
  if (!ff.ok) return keep('conflict', `${CONFLICT_REASON}: 원래 트리로 fast-forward 하지 못했습니다(${ff.err.split('\n')[0].slice(0, 200)})`);
  removeWorktree({ root, dir, branch });
  return { status: 'merged', commits, text: `${base} 에 커밋 ${commits}개 병합` };
}
