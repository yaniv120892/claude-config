import { describe, expect, test } from 'claude-code/testing'

import { changesPr, isGitWrite, runsGit } from '../hooks/git-write'

// Both halves matter: the default-branch guard reads only the commands
// isGitWrite flags, so a missed write is never checked.
const WRITES = [
  'git commit -m "x"',
  'git commit',
  'git push origin main',
  'git push --force',
  'git -C /some/repo commit -m x',
  'cd /tmp && git push',
  'gh pr create --title x',
  'gh pr merge 12 --squash',
  'gh pr merge',
  'gh pr create',
  'git status\ngit push',
  // The old escape hatch is gone: only the person approves now.
  'CLAUDE_GIT_OK=1 git commit -m "x"',
  // Global options a character window used to lose the subcommand behind.
  'git -C "$REPO" push',
  'git -c core.sshCommand="ssh -i k" push origin HEAD',
  'git -C /a/very/long/worktree/path/that/goes/on/and/on/for/a/while/yet push',
  'git --no-pager -C repo commit -am wip',
  'sudo -E git push',
  'env GIT_TRACE=1 /usr/bin/git push',
  'echo $(git push 2>&1)',
  'gh -R owner/repo pr merge 3',
  'bash -c "git push origin main"',
  // Shell keywords and wrappers in front of the program.
  'for b in a c; do git push origin $b; done',
  'if git push; then echo ok; fi',
  '! git commit -m x',
  'timeout 60 git push',
  'find . -name x -exec git commit -m x \\;',
  // A line continuation between the options and the subcommand.
  'git -C repo \\\n  push origin main',
  'gh pr \\\n create',
  // gh takes its flags anywhere.
  'gh pr -R owner/repo merge 3',
]
const READS = [
  'gh pr list --state merged',
  'gh pr view 12 --json mergeable',
  'gh pr view 12 --json reviewDecision,mergeable,isDraft',
  'gh pr diff 391',
  'gh pr checks 217',
  'gh pr view 391 --json headRefOid,files',
  'git log --oneline -5',
  'git status --short',
  'git diff origin/main...HEAD',
  'grep -n commit_id lib/github.py',
  'python3 -m py_compile lib/github.py && echo done',
  'sed -i "" s/old/new/ lib/github.py # commit_id stays',
  'gh search prs --owner someone --merged',
  'git log --grep=push',
  'git show HEAD:commit.txt',
  "gh pr view 3 --json title -q '.title'",
  'cat pushed.log # then git push later',
]

describe('isGitWrite', () => {
  for (const command of WRITES) {
    test(`asks about: ${command}`, () => {
      expect(isGitWrite(command)).toBe(true)
    })
  }
  for (const command of READS) {
    test(`lets through: ${command}`, () => {
      expect(isGitWrite(command)).toBe(false)
    })
  }
})

describe('what moves the PR and the band', () => {
  test('changesPr: pushes and gh pr writes, not commits or reads', () => {
    for (const command of ['git push', 'gh pr ready 51', 'gh pr close 51', 'gh pr comment 51 -b x', 'gh pr merge 3']) {
      expect(changesPr(command)).toBe(true)
    }
    for (const command of ['git commit -m x', 'gh pr view 51', 'gh pr checks 51', 'ls']) {
      expect(changesPr(command)).toBe(false)
    }
  })

  test('changesPr: gh api calls that send to a PR, not reads or other endpoints', () => {
    for (const command of [
      'gh api repos/o/r/pulls/58/comments -f body=x -F line=1',
      'gh api repos/o/r/pulls/58/comments/9/replies -f body="a reply"',
      'gh api -X PATCH repos/o/r/pulls/58 -f title=y',
      'gh api --method DELETE /repos/o/r/issues/58/labels/bug',
      "gh api graphql -f query='mutation { resolveReviewThread(input: {threadId: \"x\"}) { clientMutationId } }'",
    ]) {
      expect(changesPr(command)).toBe(true)
    }
    for (const command of [
      'gh api repos/o/r/pulls/58/comments',
      'gh api -X GET repos/o/r/pulls/58/comments -f per_page=100',
      'gh api repos/o/r/pulls/58/comments --jq .[].id',
      "gh api graphql -f query='query { viewer { login } }'",
      'gh api -X POST repos/o/r/dispatches -f event_type=x',
    ]) {
      expect(changesPr(command)).toBe(false)
    }
  })

  test('runsGit: any git or gh call', () => {
    expect(runsGit('cd x && git checkout main')).toBe(true)
    expect(runsGit('ls -la && cat README.md')).toBe(false)
  })
})
