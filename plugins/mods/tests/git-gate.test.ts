import type { On } from 'claude-code'
import { describe, expect, test } from 'claude-code/testing'

import { slash } from './slash'

import { changesPr, isGitWrite, runsGit } from '../hooks/git-write'

// The cases settings/tests/test-require-git-approval.sh held for the shell
// gate this mod replaced. Both halves matter: a gate that asks about reads
// gets approved without reading.
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

type Answer = 'Allow once' | 'Allow for this session' | 'Deny'

describe('the gate', () => {
  // The test's own hooks sit beneath the plugin: one answers the dialog the
  // way the person would, one stands for the shell.
  const harness = (on: On, answer: Answer) => {
    const asked: string[] = []
    const ran: string[] = []
    on('tool.call', { tool: 'AskUserQuestion' }, ($, e) => {
      const question = e.questions[0]?.question ?? ''
      asked.push(question)
      return { result: { questions: e.questions, answers: { [question]: answer } } }
    })
    on('tool.call', { tool: 'Bash' }, ($, e) => {
      ran.push(e.command)
      return { result: { stdout: '', stderr: '', interrupted: false } }
    })
    return { asked, ran }
  }

  test('asks before a push and runs it once allowed', async ($, on) => {
    const { asked, ran } = harness(on, 'Allow once')
    const result = await $.tool.call({ tool: 'Bash', command: 'git push origin feature' })
    expect(result.deny).toBeUndefined()
    expect(asked.length).toBe(1)
    expect(asked[0]).toContain('git push origin feature')
    expect(ran).toEqual(['git push origin feature'])
  })

  test('refuses the write the person denies', async ($, on) => {
    const { ran } = harness(on, 'Deny')
    const result = await $.tool.call({ tool: 'Bash', command: 'gh pr merge 12 --squash' })
    expect(ran).toEqual([])
    expect(result.isError === true || result.deny !== undefined).toBe(true)
  })

  test('stops asking once allowed for the session, until /git-gate reset', async ($, on) => {
    const { asked, ran } = harness(on, 'Allow for this session')
    await $.tool.call({ tool: 'Bash', command: 'git commit -m one' })
    await $.tool.call({ tool: 'Bash', command: 'git push' })
    expect(asked.length).toBe(1)
    expect(ran).toEqual(['git commit -m one', 'git push'])

    await $.command.run(slash('git-gate', 'reset'))
    await $.tool.call({ tool: 'Bash', command: 'git push' })
    expect(asked.length).toBe(2)
  })

  test('refuses when nobody can be asked', async ($, on) => {
    const ran: string[] = []
    on('tool.call', { tool: 'AskUserQuestion' }, () => ({ deny: 'no one to ask' }))
    on('tool.call', { tool: 'Bash' }, ($, e) => {
      ran.push(e.command)
      return { result: { stdout: '', stderr: '', interrupted: false } }
    })
    const result = await $.tool.call({ tool: 'Bash', command: 'git push' })
    expect(ran).toEqual([])
    expect(result.isError === true || result.deny !== undefined).toBe(true)
  })

  test('never asks about a read', async ($, on) => {
    const { asked, ran } = harness(on, 'Deny')
    await $.tool.call({ tool: 'Bash', command: 'gh pr view 12 --json mergeable' })
    expect(asked).toEqual([])
    expect(ran).toEqual(['gh pr view 12 --json mergeable'])
  })
})
