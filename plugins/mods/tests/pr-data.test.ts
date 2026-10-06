import { describe, expect, test } from 'claude-code/testing'

import { checksSummary, checkState, contextColor, parsePrView, parseThreads, prUrlParts, prViewError } from '../hooks/pr-data'

const VIEW = JSON.stringify({
  number: 51,
  title: 'feat(mods): add the mods plugin',
  url: 'https://github.com/owner/claude-config/pull/51',
  state: 'OPEN',
  isDraft: false,
  mergeable: 'CONFLICTING',
  reviewDecision: '',
  statusCheckRollup: [
    { __typename: 'CheckRun', name: 'tests', status: 'COMPLETED', conclusion: 'SUCCESS' },
    { __typename: 'CheckRun', name: 'lint', status: 'COMPLETED', conclusion: 'FAILURE' },
    { __typename: 'CheckRun', name: 'deploy', status: 'IN_PROGRESS', conclusion: '' },
    { __typename: 'CheckRun', name: 'docs', status: 'COMPLETED', conclusion: 'SKIPPED' },
    { __typename: 'StatusContext', context: 'ci/legacy', state: 'PENDING' },
  ],
})

const THREADS = JSON.stringify({
  data: {
    repository: {
      pullRequest: {
        reviewThreads: {
          nodes: [
            {
              isResolved: false,
              path: 'hooks/register.tsx',
              line: 12,
              comments: { nodes: [{ author: { login: 'reviewer' }, body: 'Rename this.\nIt reads oddly.', url: 'u1' }] },
            },
            {
              isResolved: true,
              path: 'README.md',
              line: 3,
              comments: { nodes: [{ author: { login: 'reviewer' }, body: 'Done', url: 'u2' }] },
            },
            {
              isResolved: false,
              path: 'install.sh',
              line: null,
              comments: { nodes: [{ author: null, body: 'Outdated?', url: 'u3' }] },
            },
          ],
        },
      },
    },
  },
})

describe('parsePrView', () => {
  test('reads the PR and its checks', () => {
    const parsed = parsePrView(VIEW)
    expect(parsed.number).toBe(51)
    expect(parsed.mergeable).toBe('CONFLICTING')
    expect(parsed.reviewDecision).toBe(null)
    expect(parsed.checks.map(check => check.state)).toEqual(['pass', 'fail', 'pending', 'skipped', 'pending'])
    expect(parsed.checks[4]?.name).toBe('ci/legacy')
  })

  test('sums the checks up', () => {
    expect(checksSummary(parsePrView(VIEW).checks)).toEqual({ failing: 1, pending: 2, passing: 1 })
  })
})

describe('checkState', () => {
  test('a commit status maps by state', () => {
    expect(checkState({ __typename: 'StatusContext', state: 'SUCCESS' })).toBe('pass')
    expect(checkState({ __typename: 'StatusContext', state: 'ERROR' })).toBe('fail')
  })

  test('a finished check run that is neither a pass nor a skip fails', () => {
    expect(checkState({ status: 'COMPLETED', conclusion: 'TIMED_OUT' })).toBe('fail')
    expect(checkState({ status: 'COMPLETED', conclusion: 'NEUTRAL' })).toBe('pass')
  })
})

describe('parseThreads', () => {
  test('keeps the unresolved threads, first line of the first comment', () => {
    const threads = parseThreads(THREADS)
    expect(threads.length).toBe(2)
    expect(threads[0]).toEqual({ path: 'hooks/register.tsx', line: 12, author: 'reviewer', excerpt: 'Rename this.', url: 'u1' })
    expect(threads[1]?.author).toBe('ghost')
  })

  test('an empty answer has no threads', () => {
    expect(parseThreads('{}')).toEqual([])
  })
})

describe('helpers', () => {
  test('prUrlParts reads owner, name and number', () => {
    expect(prUrlParts('https://github.com/owner/claude-config/pull/51')).toEqual({
      owner: 'owner',
      name: 'claude-config',
      number: '51',
    })
    expect(prUrlParts('not a url')).toBe(null)
  })

  test('prViewError is quiet when the branch has no PR', () => {
    expect(prViewError('no pull requests found for branch "x"')).toBe(null)
    expect(prViewError('HTTP 401: Bad credentials\nmore')).toBe('HTTP 401: Bad credentials')
  })

  test('contextColor matches the old statusline thresholds', () => {
    expect(contextColor(49)).toBe('green')
    expect(contextColor(50)).toBe('yellow')
    expect(contextColor(74)).toBe('yellow')
    expect(contextColor(75)).toBe('red')
  })
})
