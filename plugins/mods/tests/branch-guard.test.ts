import type { On } from 'claude-code'
import { describe, expect, test } from 'claude-code/testing'

import { gitWrites, resolvePath } from '../hooks/branch-guard'
import { fail, ok } from './fixtures'

const CWD = '/w/repo'
const HOME = '/Users/me'
const directories = (command: string) => gitWrites(command, CWD, HOME).map(write => write.directory)

describe('gitWrites', () => {
  test('finds commits and pushes, not other git calls or mentions', () => {
    expect(directories('git commit -m x && git push')).toEqual([CWD, CWD])
    expect(directories('git status && git log')).toEqual([])
    expect(directories('echo "then git commit"')).toEqual([])
    expect(directories('grep -r "git push" .')).toEqual([])
  })

  test('sees through prefixes, wrappers, subshells, brace groups and shell -c', () => {
    expect(directories('FOO=bar git commit')).toEqual([CWD])
    expect(directories('GIT_SSH_COMMAND="ssh -i key" git push')).toEqual([CWD])
    expect(directories('sudo env git commit')).toEqual([CWD])
    expect(directories('(git commit)')).toEqual([CWD])
    expect(directories('{ git commit; }')).toEqual([CWD])
    expect(directories('bash -c "cd /w/other && git push"')).toEqual(['/w/other'])
  })

  test('follows every cd in order, relative ones from where the last left off', () => {
    expect(directories('cd /w/repo/.claude/worktrees/x/plugins/mods && npm test && cd ../.. && git commit')).toEqual([
      '/w/repo/.claude/worktrees/x',
    ])
    expect(directories('cd sub; git commit; cd ..; git push')).toEqual(['/w/repo/sub', CWD])
    expect(directories('cd ~/code && git push')).toEqual(['/Users/me/code'])
  })

  test('applies -C only to its own git call, relative to the current directory', () => {
    expect(directories('git -C /w/decoy status && git commit')).toEqual([CWD])
    expect(directories('git -C ../other commit')).toEqual(['/w/other'])
    expect(directories('git -C /tmp/precommit-notes commit')).toEqual(['/tmp/precommit-notes'])
  })

  test('expands the variables the command assigns, and gives up on the rest', () => {
    expect(directories('W=/w/wt; git -C $W commit && git -C "${W}" push')).toEqual(['/w/wt', '/w/wt'])
    expect(directories('git -C $UNSET commit')).toEqual([null])
    expect(directories('cd $(git rev-parse --show-toplevel) && git commit')).toEqual([null])
    expect(directories('cd - && git commit')).toEqual([null])
  })

  test('opts out only through a prefix on the git call itself', () => {
    expect(gitWrites('ALLOW_DEFAULT_BRANCH_WRITE=1 git commit', CWD, HOME)[0]?.isOptedOut).toBe(true)
    expect(gitWrites('git commit -m "ALLOW_DEFAULT_BRANCH_WRITE=1"', CWD, HOME)[0]?.isOptedOut).toBe(false)
    expect(gitWrites('ALLOW_DEFAULT_BRANCH_WRITE=1; git commit', CWD, HOME)[0]?.isOptedOut).toBe(false)
  })
})

test('resolvePath folds . and .. against the base', () => {
  expect(resolvePath('/a/b', '../c/./d')).toBe('/a/c/d')
  expect(resolvePath('/a/b', '/x')).toBe('/x')
  expect(resolvePath('/a', '../../..')).toBe('/')
})

/** `/w/repo` on `main`, a worktree `/w/repo/wt` on `feature`, and `/w/plain` with no remote. */
function fakeCheckouts(on: On) {
  const branches: Record<string, string> = { '/w/repo': 'main', '/w/repo/wt': 'feature', '/w/plain': 'main' }
  const ran: string[] = []
  on('session.cwd', () => ({ value: '/w/repo' }))
  on('env.get', () => ({ value: HOME }))
  on('process.run', ($, e) => {
    const cwd = e.init?.cwd ?? ''
    const command = e.argv.filter(arg => arg !== '--no-optional-locks').join(' ')
    ran.push(command)
    if (command === 'git symbolic-ref --quiet --short HEAD') {
      return branches[cwd] === undefined ? fail('not a git repository') : ok(`${branches[cwd]}\n`)
    }
    if (command.startsWith('git symbolic-ref --quiet --short refs/remotes/origin/HEAD')) {
      return cwd === '/w/plain' ? fail('') : ok('origin/main\n')
    }
    if (command.startsWith('git rev-parse --verify')) return fail('')
    return ok('')
  })
  on('tool.call', { tool: 'Bash' }, () => ({ result: { stdout: '', stderr: '', interrupted: false } }))
  return { ran }
}

const NO_GATE = { options: { gitGate: false, statusBand: false } }

describe('the default-branch guard', () => {
  test('refuses a commit on the default branch, naming the opt-out', NO_GATE, async ($, on) => {
    fakeCheckouts(on)
    const called = await $.tool.call({ tool: 'Bash', command: 'git commit -m x' })
    expect(called.deny).toContain("you are on 'main', the default branch")
    expect(called.deny).toContain('ALLOW_DEFAULT_BRANCH_WRITE=1')
  })

  test('lets a write through on a feature branch, however the command reaches it', NO_GATE, async ($, on) => {
    fakeCheckouts(on)
    for (const command of ['cd wt && git commit -m x', 'W=/w/repo/wt; git -C $W push', 'cd /w/repo/wt/a/b && cd ../.. && git push']) {
      expect((await $.tool.call({ tool: 'Bash', command })).deny).toBeUndefined()
    }
  })

  test('stays out of an opt-out, a path it cannot read, and a repo with no default branch', NO_GATE, async ($, on) => {
    fakeCheckouts(on)
    for (const command of ['ALLOW_DEFAULT_BRANCH_WRITE=1 git commit -m x', 'git -C $ELSEWHERE commit', 'git -C /w/plain push']) {
      expect((await $.tool.call({ tool: 'Bash', command })).deny).toBeUndefined()
    }
  })

  test('runs no git for a command that writes nothing', NO_GATE, async ($, on) => {
    const { ran } = fakeCheckouts(on)
    await $.tool.call({ tool: 'Bash', command: 'ls -la && git status' })
    expect(ran).toEqual([])
  })

  test('is off when switched off', { options: { gitGate: false, statusBand: false, branchGuard: false } }, async ($, on) => {
    fakeCheckouts(on)
    expect((await $.tool.call({ tool: 'Bash', command: 'git commit -m x' })).deny).toBeUndefined()
  })
})
