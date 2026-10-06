// Which Bash commands the git write gate asks about.
//
// "Not part of a longer identifier": `merged`, `mergeable` and `commit_id` must
// not count as the bare verb. A gate that asks about reads trains the person to
// approve everything, which is what it exists to prevent. Each line is matched
// alone and no double quote is crossed, so a string that only mentions a write
// does not trip it.
const WORD = '[^A-Za-z0-9_\\n]'
const GIT_WRITE = new RegExp(`(^|${WORD})git${WORD}[^"\\n]{0,60}(commit|push)(${WORD}|$)`, 'm')
const GH_WRITE = new RegExp(
  `(^|${WORD})gh${WORD}[^"\\n]{0,60}pr${WORD}[^"\\n]{0,60}(create|merge)(${WORD}|$)`,
  'm',
)

export function isGitWrite(command: string): boolean {
  return GIT_WRITE.test(command) || GH_WRITE.test(command)
}

// A git or gh command that may have moved the branch, the worktree or the PR.
const GIT_OR_GH = /(^|[^A-Za-z0-9_])(git|gh)([^A-Za-z0-9_]|$)/
const MOVES_PR = /(^|[^A-Za-z0-9_])(push|pr)([^A-Za-z0-9_]|$)/

export function movesRepo(command: string): boolean {
  return GIT_OR_GH.test(command)
}

export function movesPr(command: string): boolean {
  return GIT_OR_GH.test(command) && MOVES_PR.test(command)
}
