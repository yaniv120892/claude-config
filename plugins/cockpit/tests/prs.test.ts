import { describe, expect, test } from 'claude-code/testing'

import { boardSearches, countChecks, isMergedButOpen, isOnBoard, isReadyToMerge, newlyDeployed, parseBoard, parseTickets, prChanges, ticketIdIn, ticketOf, workspaceTitle } from '../hooks/prs'
import { boardAnswer, row, thread } from './fixtures'

const CHECKS = [
  { __typename: 'CheckRun', name: 'tests', status: 'COMPLETED', conclusion: 'SUCCESS', detailsUrl: 'https://ci/1' },
  { __typename: 'CheckRun', name: 'lint', status: 'COMPLETED', conclusion: 'FAILURE', detailsUrl: 'https://ci/2' },
  { __typename: 'CheckRun', name: 'deploy', status: 'IN_PROGRESS', conclusion: null },
  { __typename: 'StatusContext', context: 'ci/legacy', state: 'PENDING', targetUrl: '' },
  { __typename: 'CheckRun', name: 'old', status: 'COMPLETED', conclusion: 'STALE', detailsUrl: '' },
]

describe('the PR board', () => {
  test('reads checks and unresolved threads, and marks a thread I answered last as replied', async () => {
    const answer = boardAnswer([
      row({
        number: 1,
        checks: CHECKS,
        threads: [thread({ author: 'reviewer' }), thread({ author: 'reviewer', lastAuthor: 'me' }), thread({ author: 'reviewer', isResolved: true })],
      }),
    ])
    const [pr] = parseBoard(answer, 'production')
    expect(countChecks(pr?.checks ?? [])).toEqual({ pass: 2, fail: 1, pending: 2 })
    expect(pr?.threads.map(one => one.isReplied)).toEqual([false, true])
    expect(pr?.threads[0]?.excerpt).toBe('Rename this.')
    expect(pr?.files).toEqual(['src/billing/charge.ts'])
  })

  test('a merged PR is deployed only once its production deployment succeeded', async () => {
    const preview = { environment: 'Preview', statuses: [{ state: 'SUCCESS', createdAt: '2026-11-01T10:00:00Z' }] }
    const pending = { environment: 'Production', statuses: [{ state: 'IN_PROGRESS', createdAt: '2026-11-01T10:01:00Z' }] }
    const live = {
      environment: 'Production – app',
      statuses: [
        { state: 'INACTIVE', createdAt: '2026-11-02T10:00:00Z' },
        { state: 'SUCCESS', createdAt: '2026-11-01T10:05:00Z' },
      ],
    }
    const replaced = {
      environment: 'Production',
      createdAt: '2026-11-01T09:00:00Z',
      statuses: [{ state: 'INACTIVE', createdAt: '2026-11-03T10:00:00Z' }],
    }
    const answer = boardAnswer([], [
      row({ number: 5, state: 'MERGED', mergedAt: '2026-11-01T08:55:00Z', deployments: [replaced] }),
      row({ number: 2, state: 'MERGED', mergedAt: '2026-11-01T10:00:00Z', deployments: [preview, pending] }),
      row({ number: 3, state: 'MERGED', mergedAt: '2026-11-01T10:00:00Z', deployments: [preview, live] }),
    ])
    const [superseded, waiting, deployed] = parseBoard(answer, 'production')
    if (waiting === undefined || deployed === undefined) throw new Error('the board lost a merged PR')
    expect(superseded?.deployedAt).toBe(Date.parse('2026-11-01T09:00:00Z'))
    expect(waiting.deployedAt).toBe(null)
    expect(deployed.deployedAt).toBe(Date.parse('2026-11-01T10:05:00Z'))
    const before = [waiting, { ...deployed, deployedAt: null }]
    expect(newlyDeployed(before, [waiting, deployed]).map(pr => pr.number)).toEqual([3])
    expect(newlyDeployed(null, [deployed])).toEqual([])
  })

  test('searches my open PRs and the ones merged in the last week, and shows a merged one for a day', async () => {
    const now = Date.parse('2026-11-10T08:00:00Z')
    const searches = boardSearches(now)
    expect(searches.open).toContain('is:open author:@me')
    expect(searches.merged).toContain('merged:>=2026-11-03')
    const [open, today, lastWeek] = parseBoard(
      boardAnswer([row({ number: 1 })], [row({ number: 2, state: 'MERGED', mergedAt: '2026-11-09T09:00:00Z' }), row({ number: 3, state: 'MERGED', mergedAt: '2026-11-08T07:00:00Z' })]),
      'production',
    )
    const isAnyMissing = open === undefined || today === undefined || lastWeek === undefined
    if (isAnyMissing) throw new Error('the board lost a PR')
    expect([open, today, lastWeek].map(pr => isOnBoard({ pr, now }))).toEqual([true, true, false])
  })

  test('links a PR to the ticket its title or branch names', async () => {
    const answer = JSON.stringify({ issues: [{ id: 'YAN-1', title: 'One', url: 'https://linear.app/x/issue/YAN-1', status: 'In Progress' }] })
    const tickets = parseTickets({ answer, isDone: false })
    const [first, eleventh] = parseBoard(boardAnswer([row({ number: 1 }), row({ number: 11 })]), 'production')
    expect(first === undefined ? null : ticketOf(first, tickets)?.id).toBe('YAN-1')
    expect(eleventh === undefined ? null : ticketOf(eleventh, tickets)).toBe(null)
    const nameless = [{ id: '', title: 'No id', url: '', status: '', isDone: false }]
    expect(first === undefined ? null : ticketOf(first, nameless)).toBe(null)
  })
})

describe('the ticket a workspace works on', () => {
  const teamKeys = new Set(['YAN'])

  test('is the first mention of a known team, or one written in capitals', async () => {
    expect(ticketIdIn({ text: 'YAN-172 cockpit', teamKeys })).toBe('YAN-172')
    expect(ticketIdIn({ text: 'yaniv120892/yan-174-cockpit-show', teamKeys })).toBe('YAN-174')
    expect(ticketIdIn({ text: 'fix RDBAZ-12 import', teamKeys })).toBe('RDBAZ-12')
  })

  test('is none for a name that only looks like one', async () => {
    expect(ticketIdIn({ text: 'cockpit-2', teamKeys })).toBe(null)
    expect(ticketIdIn({ text: 'main', teamKeys })).toBe(null)
  })

  test('reads the title of my own workspace from the cmux list', async () => {
    const listing = JSON.stringify({ workspaces: [{ id: 'a', title: 'Hermes' }, { id: 'b', title: 'YAN-9 work' }] })
    expect(workspaceTitle({ listing, workspaceId: 'b' })).toBe('YAN-9 work')
    expect(workspaceTitle({ listing, workspaceId: 'c' })).toBe(null)
  })
})

describe('what the board acts on', () => {
  const board = (open: object[], merged: object[] = []) => parseBoard(boardAnswer(open, merged), 'production')
  const ticket = { id: 'YAN-3', title: 'Receipts', url: '', status: 'In Progress', isDone: false }

  test('a PR is ready to merge when green, free of conflicts, and approved or needing no review', async () => {
    const [needsReview, approved, free, failing] = board([
      row({ number: 1 }),
      row({ number: 2, reviewDecision: 'APPROVED' }),
      row({ number: 3, reviewDecision: null }),
      row({ number: 4, reviewDecision: null, checks: [{ __typename: 'CheckRun', name: 'lint', status: 'COMPLETED', conclusion: 'FAILURE', detailsUrl: '' }] }),
    ])
    expect([needsReview, approved, free, failing].map(pr => pr !== undefined && isReadyToMerge(pr))).toEqual([false, true, true, false])
  })

  test('the first read toasts nothing, and a PR that only stayed failing toasts nothing again', async () => {
    const failing = board([row({ number: 1, checks: [{ __typename: 'CheckRun', name: 'lint', status: 'COMPLETED', conclusion: 'FAILURE', detailsUrl: '' }] })])
    expect(prChanges({ last: null, next: failing })).toEqual([])
    expect(prChanges({ last: failing, next: failing })).toEqual([])
  })

  test('a ticket is left open when a PR naming it merged and none naming it is open', async () => {
    const merged = board([], [row({ number: 3, state: 'MERGED', mergedAt: '2026-11-01T10:20:00Z' })])
    const stillOpen = board([row({ number: 3 })], [row({ number: 3, state: 'MERGED', mergedAt: '2026-11-01T10:20:00Z' })])
    expect(isMergedButOpen({ ticket, prs: merged })).toBe(true)
    expect(isMergedButOpen({ ticket, prs: stillOpen })).toBe(false)
    expect(isMergedButOpen({ ticket: { ...ticket, isDone: true }, prs: merged })).toBe(false)
  })

  test('reads whether the repo deploys at all', async () => {
    const [deploys, never] = board([row({ number: 1 }), row({ number: 2, hasDeploys: false })])
    expect([deploys?.hasDeploys, never?.hasDeploys]).toEqual([true, false])
  })
})
