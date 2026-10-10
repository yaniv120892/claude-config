import { describe, expect, test } from 'claude-code/testing'

import { checkState, countChecks, isReadyToMerge, parsePrView, parseThreads, prAddresses, prStatus, prViewError, settledChecks } from '../hooks/pr-data'
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
  test('keeps the unresolved threads, first line of the first comment, and counts the resolved', () => {
    const { threads, resolvedThreads } = parseThreads(THREADS, 'author')
    expect(threads.length).toBe(3)
    expect(resolvedThreads).toBe(1)
    expect(threads[0]).toEqual({
      path: 'hooks/register.tsx',
      line: 12,
      author: 'reviewer',
      excerpt: 'Rename this.',
      isReplied: false,
    })
    expect(threads[1]?.author).toBe('ghost')
  })

  test('reads a thread as replied when the PR author wrote its last comment', () => {
    expect(parseThreads(THREADS, 'author').threads.map(thread => thread.isReplied)).toEqual([false, false, true])
  })

  test('an empty answer has no threads', () => {
    expect(parseThreads('{}', 'author')).toEqual({ threads: [], resolvedThreads: 0 })
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
  const running = { ...parsePrView(JSON.stringify(PR_VIEW)), threads: [], resolvedThreads: 0 }
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

describe('the PR summary', () => {
  const pr = { ...parsePrView(JSON.stringify(PR_VIEW)), threads: [], resolvedThreads: 0 }

  test('reads the merge state and the author', () => {
    expect(pr.mergeState).toBe('DIRTY')
    expect(pr.author).toBe('author')
    expect(parsePrView(JSON.stringify({ ...PR_VIEW, mergeStateStatus: 'NEW_STATE', author: null })).mergeState).toBe('UNKNOWN')
  })

  test('names where GitHub stands, merged and closed before draft before the review', () => {
    expect(prStatus({ ...pr, state: 'MERGED', isDraft: true }).label).toBe('merged')
    expect(prStatus({ ...pr, state: 'CLOSED' }).label).toBe('closed')
    expect(prStatus({ ...pr, isDraft: true }).label).toBe('draft')
    expect(prStatus({ ...pr, reviewDecision: 'REVIEW_REQUIRED' }).label).toBe('awaiting review')
    expect(prStatus({ ...pr, reviewDecision: 'APPROVED' }).label).toBe('approved')
    expect(prStatus(pr).label).toBe('changes requested')
    expect(prStatus({ ...pr, reviewDecision: null }).label).toBe('open')
  })

  test('is ready to merge only when open, not a draft, and GitHub says it merges clean', () => {
    expect(isReadyToMerge({ ...pr, mergeState: 'CLEAN' })).toBe(true)
    expect(isReadyToMerge({ ...pr, mergeState: 'HAS_HOOKS' })).toBe(true)
    expect(isReadyToMerge({ ...pr, mergeState: 'BLOCKED' })).toBe(false)
    expect(isReadyToMerge({ ...pr, mergeState: 'CLEAN', isDraft: true })).toBe(false)
    expect(isReadyToMerge({ ...pr, mergeState: 'CLEAN', state: 'MERGED' })).toBe(false)
  })
})

test('prAddresses finds each PR link once, with its repository', () => {
  const output = 'Creating pull request\nhttps://github.com/owner/claude-config/pull/57\n'
  expect(prAddresses(output + output)).toEqual([
    { owner: 'owner', repo: 'claude-config', number: 57, url: 'https://github.com/owner/claude-config/pull/57' },
  ])
  expect(prAddresses('[{"url":"https://github.com/a/b/pull/1"},{"url":"https://github.com/a/b/pull/2"}]')).toHaveLength(2)
  expect(prAddresses('no links')).toEqual([])
})
