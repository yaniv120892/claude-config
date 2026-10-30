import type { On } from 'claude-code'
import { describe, expect, test } from 'claude-code/testing'

import { fail, ok } from './fixtures'
import { slash } from './slash'

import { allowRules, changesPr, isAllowedBy, isGitWrite, runsGit } from '../hooks/git-write'

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

describe('isAllowedBy', () => {
  test('covers a write its rule matches', () => {
    expect(isAllowedBy(['Bash(git *)'], 'git commit -m "x\n\nbody"')).toBe(true)
    expect(isAllowedBy(['Bash(git push:*)'], 'git push origin main')).toBe(true)
    expect(isAllowedBy(['Bash(gh pr merge 12 --squash)'], 'gh pr merge 12 --squash')).toBe(true)
    expect(isAllowedBy(['Bash(git *)'], 'cd /tmp && git commit -m x && ~/bin/ship.sh')).toBe(true)
  })

  test('needs every write covered', () => {
    expect(isAllowedBy(['Bash(git *)'], 'git commit -m x && gh pr merge 3')).toBe(false)
    expect(isAllowedBy(['Bash(git push:*)'], 'git pushx')).toBe(false)
    expect(isAllowedBy(['Bash(git commit:*)'], 'git push')).toBe(false)
    expect(isAllowedBy(['Read(*)', 'Bash(gh api *)'], 'git push')).toBe(false)
    expect(isAllowedBy([], 'git push')).toBe(false)
  })

  test('never covers a write behind a wrapper or a substitution', () => {
    expect(isAllowedBy(['Bash(timeout *)', 'Bash(git *)'], 'timeout 60 git push')).toBe(false)
    expect(isAllowedBy(['Bash(echo *)'], 'echo "$(git push)"')).toBe(false)
    expect(isAllowedBy(['Bash(bash *)'], 'bash -c "git push"')).toBe(false)
    expect(isAllowedBy(['Bash(*)'], 'CLAUDE_GIT_OK=1 git commit -m x')).toBe(false)
  })

  test('allowRules reads permissions.allow and nothing else', () => {
    expect(allowRules({ permissions: { allow: ['Bash(git *)', 3], deny: ['Bash(rm *)'] } })).toEqual(['Bash(git *)'])
    expect(allowRules(null)).toEqual([])
    expect(allowRules({ permissions: { allow: 'Bash(git *)' } })).toEqual([])
  })
})

type Answer = 'Allow once' | 'Allow for this session' | 'Deny'

/** The checkout `/w/repo` as git reports it: on `feature` tracking `origin/feature`, `origin/HEAD` at main. */
type Checkout = { branch?: string | null; upstream?: string | null; config?: string; hasOrigin?: boolean; isCwdBroken?: boolean }

describe('the gate', () => {
  // The test's own hooks sit beneath the plugin: one answers the dialog the
  // way the person would, one stands for the shell, one for git.
  const harness = (on: On, answer: Answer, allow: string[] = [], checkout: Checkout = {}) => {
    const { branch = 'feature', upstream = 'refs/heads/feature', config = '', hasOrigin = true, isCwdBroken = false } = checkout
    const asked: string[] = []
    const ran: string[] = []
    on('session.cwd', () => {
      if (isCwdBroken) throw new Error('no session')
      return { value: '/w/repo' }
    })
    on('env.get', ($, e) => ({ value: e.name === 'HOME' ? '/home/me' : undefined }))
    on('fs.read', ($, e) => {
      if (e.path !== '/home/me/.claude/settings.json') throw new Error(`unexpected read of ${e.path}`)
      return { value: JSON.stringify({ permissions: { allow } }) }
    })
    on('process.run', ($, e) => {
      const git = e.argv.filter(arg => arg !== '--no-optional-locks').join(' ')
      if (git === 'git symbolic-ref --quiet --short HEAD') return branch === null ? fail('') : ok(`${branch}\n`)
      if (git.startsWith('git symbolic-ref --quiet --short refs/remotes/origin/HEAD')) return hasOrigin ? ok('origin/main\n') : fail('')
      if (git.startsWith('git config --get-regexp')) return config ? ok(config) : fail('')
      if (git.startsWith('git config --get branch.')) return upstream === null ? fail('') : ok(`${upstream}\n`)
      return fail(`unexpected ${git}`)
    })
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

  test('asks before a push to the default branch and runs it once allowed', async ($, on) => {
    const { asked, ran } = harness(on, 'Allow once')
    const result = await $.tool.call({ tool: 'Bash', command: 'git push origin HEAD:main' })
    expect(result.deny).toBeUndefined()
    expect(asked.length).toBe(1)
    expect(asked[0]).toContain('git push origin HEAD:main')
    expect(ran).toEqual(['git push origin HEAD:main'])
  })

  test('refuses the write the person denies', async ($, on) => {
    const { ran } = harness(on, 'Deny')
    const result = await $.tool.call({ tool: 'Bash', command: 'gh pr merge 12 --squash' })
    expect(ran).toEqual([])
    expect(result.isError === true || result.deny !== undefined).toBe(true)
  })

  test('stops asking once allowed for the session, until /git-gate reset', async ($, on) => {
    const { asked, ran } = harness(on, 'Allow for this session')
    await $.tool.call({ tool: 'Bash', command: 'gh pr merge 1' })
    await $.tool.call({ tool: 'Bash', command: 'git push origin HEAD:main' })
    expect(asked.length).toBe(1)
    expect(ran).toEqual(['gh pr merge 1', 'git push origin HEAD:main'])

    await $.command.run(slash('git-gate', 'reset'))
    await $.tool.call({ tool: 'Bash', command: 'gh pr merge 1' })
    expect(asked.length).toBe(2)
  })

  test('refuses when nobody can be asked', async ($, on) => {
    const ran: string[] = []
    on('tool.call', { tool: 'AskUserQuestion' }, () => ({ deny: 'no one to ask' }))
    on('tool.call', { tool: 'Bash' }, ($, e) => {
      ran.push(e.command)
      return { result: { stdout: '', stderr: '', interrupted: false } }
    })
    const result = await $.tool.call({ tool: 'Bash', command: 'gh pr merge 3' })
    expect(ran).toEqual([])
    expect(result.isError === true || result.deny !== undefined).toBe(true)
  })

  test('skips the dialog for a write the user settings already allow', async ($, on) => {
    const { asked, ran } = harness(on, 'Deny', ['Bash(git *)'])
    await $.tool.call({ tool: 'Bash', command: 'git push origin HEAD:main' })
    await $.tool.call({ tool: 'Bash', command: 'gh pr merge 3' })
    expect(asked.length).toBe(1)
    expect(ran).toEqual(['git push origin HEAD:main'])
  })

  test('never asks about a read', async ($, on) => {
    const { asked, ran } = harness(on, 'Deny')
    await $.tool.call({ tool: 'Bash', command: 'gh pr view 12 --json mergeable' })
    expect(asked).toEqual([])
    expect(ran).toEqual(['gh pr view 12 --json mergeable'])
  })

  // On `feature`, tracking `origin/feature`.
  const OFF_DEFAULT_BRANCH = [
    'git commit -m x',
    'git push',
    'git push origin',
    'git push -u origin HEAD',
    'git push origin feature',
    'git push --force-with-lease origin HEAD:feature',
    'git push origin +feature:refs/heads/feature other',
    'git push origin --delete old',
    'cd /w/repo && git add -A && git commit -m x && git push -u origin HEAD',
    'B=feature; git push origin "HEAD:$B"',
    'gh pr create --title x --body y',
    'git push origin HEAD && gh pr create --fill',
  ]
  const MAY_LAND_ON_DEFAULT_BRANCH = [
    'git push origin HEAD:main',
    'git push origin x:refs/heads/main',
    'git push origin +HEAD:main',
    'git push origin main',
    'git push origin feature main',
    'git push origin --delete main',
    'git push origin :main',
    'git push --all origin',
    'git push --mirror origin',
    'git push --prune origin feature',
    'git push origin :',
    'git push origin "refs/heads/*:refs/heads/*"',
    'git push origin HEAD:$TARGET',
    'git push --delete origin',
    'git -c push.default=matching push',
    'GIT_DIR=/w/other/.git git commit -m x',
    'git -C $ELSEWHERE commit -m x',
    'cd $(mktemp -d) && git commit -m x',
    'timeout 60 git push',
    'gh pr merge 3 --squash',
    'git commit -m x && gh pr merge 3',
  ]

  for (const command of OFF_DEFAULT_BRANCH) {
    test(`runs without asking: ${command}`, async ($, on) => {
      const { asked, ran } = harness(on, 'Deny')
      expect((await $.tool.call({ tool: 'Bash', command })).deny).toBeUndefined()
      expect(asked).toEqual([])
      expect(ran).toEqual([command])
    })
  }
  for (const command of MAY_LAND_ON_DEFAULT_BRANCH) {
    test(`asks about: ${command}`, async ($, on) => {
      const { asked, ran } = harness(on, 'Deny')
      await $.tool.call({ tool: 'Bash', command })
      expect(asked.length).toBe(1)
      expect(ran).toEqual([])
    })
  }

  const UNPROVEN_CHECKOUTS: [string, Checkout, string][] = [
    ['a bare push whose upstream is the default branch', { upstream: 'refs/heads/main' }, 'git push'],
    ['a push naming the remote whose upstream is the default branch', { upstream: 'refs/heads/main' }, 'git push origin'],
    ['a bare push with push.default matching', { config: 'push.default matching\n' }, 'git push'],
    ['a bare push with a configured remote push refspec', { config: 'remote.origin.push HEAD:main\n' }, 'git push'],
    ['a detached HEAD', { branch: null }, 'git commit -m x'],
    ['a repository with no default branch it can read', { hasOrigin: false }, 'git commit -m x'],
    ['the default branch, opted out of the guard', { branch: 'main' }, 'ALLOW_DEFAULT_BRANCH_WRITE=1 git commit -m x'],
  ]
  for (const [name, checkout, command] of UNPROVEN_CHECKOUTS) {
    test(`asks about ${name}`, async ($, on) => {
      const { asked, ran } = harness(on, 'Deny', [], checkout)
      await $.tool.call({ tool: 'Bash', command })
      expect(asked.length).toBe(1)
      expect(ran).toEqual([])
    })
  }

  test('asks when a lookup throws', async ($, on) => {
    const { asked, ran } = harness(on, 'Deny', [], { isCwdBroken: true })
    await $.tool.call({ tool: 'Bash', command: 'git commit -m x' })
    expect(asked.length).toBe(1)
    expect(ran).toEqual([])
  })

  test('/git-gate names the new scope', async ($, on) => {
    harness(on, 'Deny')
    const shown = await $.command.run(slash('git-gate'))
    expect(JSON.stringify(shown)).toContain('may land on the default branch')
    expect(JSON.stringify(shown)).toContain('gh pr create')
  })
})
