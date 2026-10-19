// 맡은 경로 밖 수정 판단 — git status 전후 차이가 아니라 그 멤버 자신의 도구 이벤트(onTool 의 {tool, path})로 한다.
// 같은 작업 트리에서 여러 멤버가 동시에 돌면 git 차이에 남의 수정이 섞이므로 git 차이는 참고용으로만 남긴다.
import { outsideOwns } from '../owns.mjs';

export const EDIT_TOOLS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit']);

/**
 * tools: 이번 실행의 도구 이벤트 [{tool, path}], changed: git 전후 차이 [경로], others: 같은 시간에 돈 멤버 [{id, owns}].
 * → { outside: 자기가 owns 밖에 고친 경로, bash: Bash 를 썼는지(Bash 로 고친 파일은 판단 불가),
 *     gitOnly: [{path, member}] 도구 이벤트엔 없고 git 에만 보인 owns 밖 변경 — member 는 그 경로를 owns 로 가진 같이 돈 멤버('' 면 모름) }
 */
export function judgeEdits({ tools = [], changed = [], owns = [], memberId, others = [] }) {
  const edited = [...new Set(tools.filter((t) => EDIT_TOOLS.has(t.tool) && t.path).map((t) => t.path))];
  const outside = outsideOwns(edited, owns, memberId);
  const mine = new Set(edited);
  const gitOnly = outsideOwns(changed, owns, memberId)
    .filter((p) => !mine.has(p))
    .map((p) => ({ path: p, member: others.find((o) => !outsideOwns([p], o.owns || [], o.id).length)?.id || '' }));
  return { outside, bash: tools.some((t) => t.tool === 'Bash'), gitOnly };
}
