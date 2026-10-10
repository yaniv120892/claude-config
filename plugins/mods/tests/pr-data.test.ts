import { describe, expect, test } from 'claude-code/testing'

import { checkState, countChecks, parsePrView, parseThreads, prViewError, settledChecks } from '../hooks/pr-data'
import type { CheckState } from '../types'
import { PR_VIEW, THREADS } from './fixtures'

describe('parsePrView', () => {
  test('reads the PR and its checks', () => {
    const parsed = parsePrView(JSON.stringify({ ...PR_VIEW, reviewDecision: '' }))
    expect(parsed.number).toBe(51)
    expect(parsed.mergeable).toBe('CONFLICTING')
    expect(parsed.reviewDecision).toBe(null)
    expect(parsed.checks.map(check => check.state)).toEqual(['pass', 'fail', 'pending', 'skipped', 'pending'])
    expect(parsed.checks[4]?.name).toBe('ci/legacy')
  })

  test('counts the checks by state', () => {
    expect(countChecks(parsePrView(JSON.stringify(PR_VIEW)).checks)).toEqual({ fail: 1, pending: 2, pass: 1, skipped: 1 })
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
    expect(threads[0]).toEqual({ path: 'hooks/register.tsx', line: 12, author: 'reviewer', excerpt: 'Rename this.' })
    expect(threads[1]?.author).toBe('ghost')
  })

  test('an empty answer has no threads', () => {
    expect(parseThreads('{}')).toEqual([])
  })
})

describe('helpers', () => {
  test('prViewError is quiet when the branch has no PR', () => {
    expect(prViewError('no pull requests found for branch "x"')).toBe(null)
    expect(prViewError('HTTP 401: Bad credentials\nmore')).toBe('HTTP 401: Bad credentials')
    expect(prViewError('')).toBe('gh failed')
  })
})

describe('settledChecks', () => {
  const running = { ...parsePrView(JSON.stringify(PR_VIEW)), threads: [] }
  const finished = (pending: CheckState, failed: CheckState = 'fail') => ({
    ...running,
    checks: running.checks.map(check => {
      if (check.state === 'pending') return { ...check, state: pending }
      return check.state === 'fail' ? { ...check, state: failed } : check
    }),
  })

  test('names the failures once nothing pends', () => {
    expect(settledChecks(running, finished('pass'))).toBe('PR #51: 1 check failed (lint)')
    expect(settledChecks(running, finished('fail'))).toBe('PR #51: 3 checks failed (lint, deploy, ci/legacy)')
  })

  test('says passed when nothing failed', () => {
    expect(settledChecks(running, finished('pass', 'pass'))).toBe('PR #51: checks passed')
  })

  test('stays quiet on a first read, another PR, a run still pending, or a settled PR read again', () => {
    expect(settledChecks(null, finished('pass'))).toBe(null)
    expect(settledChecks(running, { ...finished('pass'), number: 52 })).toBe(null)
    expect(settledChecks(running, running)).toBe(null)
    expect(settledChecks(finished('pass'), finished('pass'))).toBe(null)
  })
})
