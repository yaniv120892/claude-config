import { record } from './json'
import type { BoardCheck, BoardPr, BoardReviewer, BoardThread, CheckState, Quota, ReviewerState, Ticket } from '../types'

const MERGED_DAYS = 7
const DAY_MS = 86_400_000
const MINUTE_MS = 60_000
export const BOARD_POLL_MS = 2 * MINUTE_MS
export const SLOW_POLL_MS = 10 * MINUTE_MS
// Below this share of the hour's GraphQL points left, the board reads at the slow pace.
const LOW_QUOTA_SHARE = 0.2
const RATE_LIMITED = /rate limit/i
// Also what makes an id safe to build a pattern from.
const TICKET_ID = /^[A-Za-z][A-Za-z0-9]*-\d+$/
const TICKET_MENTION = /\b([A-Za-z][A-Za-z0-9]*)-(\d+)\b/g

/**
 * GitHub charges a query by the `first:` sizes of its nested connections, so each search asks only for what its rows
 * show: an open PR its checks, threads and reviewers; a merged one its deploys and the files an alert is compared to.
 */
export const BOARD_QUERY = `
query($open: String!, $merged: String!) {
  rateLimit { limit remaining resetAt cost }
  open: search(query: $open, type: ISSUE, first: 25) { nodes { ...Open } }
  merged: search(query: $merged, type: ISSUE, first: 20) { nodes { ...Merged } }
}
fragment Open on PullRequest {
  number title url isDraft state reviewDecision mergeable headRefName headRefOid isCrossRepository
  author { login }
  repository { nameWithOwner }
  reviewRequests(first: 5) { nodes { requestedReviewer { ... on User { login } ... on Team { name } } } }
  latestReviews(first: 5) { nodes { author { login } state } }
  commits(last: 1) { nodes { commit { statusCheckRollup { state contexts(first: 40) { nodes {
    __typename
    ... on CheckRun { name status conclusion detailsUrl }
    ... on StatusContext { context state targetUrl }
  } } } } } }
  reviewThreads(last: 20) { nodes {
    isResolved path line
    comments(first: 1) { nodes { author { login } body url } }
    latest: comments(last: 1) { nodes { author { login } } }
  } }
}
fragment Merged on PullRequest {
  number title url state mergedAt headRefName
  author { login }
  repository { nameWithOwner deployments { totalCount } }
  mergeCommit { deployments(first: 5) { nodes { environment createdAt statuses(first: 5) { nodes { state createdAt } } } } }
  files(first: 40) { nodes { path } }
}`

/**
 * The two searches the board runs: my open PRs, and mine merged in the last week. The week keeps my own PRs out of
 * the inbox and a late deploy matched to its alerts; the board shows only the last day of them (`isOnBoard`).
 */
export function boardSearches(now: number): { open: string; merged: string } {
  const since = new Date(now - MERGED_DAYS * DAY_MS).toISOString().slice(0, 10)
  return {
    open: 'is:pr is:open author:@me archived:false sort:updated-desc',
    merged: `is:pr is:merged author:@me merged:>=${since} sort:updated-desc`,
  }
}

type Json = Record<string, unknown>

function nodes(value: unknown): Json[] {
  const list = record(value).nodes
  return Array.isArray(list) ? list.map(record) : []
}

function text(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function time(value: unknown): number | null {
  const at = typeof value === 'string' ? Date.parse(value) : Number.NaN
  return Number.isNaN(at) ? null : at
}

const PASSED = new Set(['SUCCESS', 'NEUTRAL', 'SKIPPED', 'STALE'])
const FAILED = new Set(['FAILURE', 'ERROR', 'TIMED_OUT', 'CANCELLED', 'ACTION_REQUIRED', 'STARTUP_FAILURE'])

function checkState(outcome: string): CheckState {
  if (PASSED.has(outcome)) return 'pass'
  return FAILED.has(outcome) ? 'fail' : 'pending'
}

function parseCheck(context: Json): BoardCheck {
  if (context.__typename === 'StatusContext') {
    return { name: text(context.context), state: checkState(text(context.state)), url: text(context.targetUrl) || null }
  }
  const outcome = context.status === 'COMPLETED' ? text(context.conclusion) : ''
  return { name: text(context.name), state: checkState(outcome), url: text(context.detailsUrl) || null }
}

function parseThread(thread: Json, prAuthor: string): BoardThread {
  const first = nodes(thread.comments)[0] ?? {}
  const author = text(record(first.author).login) || 'ghost'
  const lastAuthor = text(record(nodes(thread.latest)[0]?.author).login)
  return {
    path: text(thread.path),
    line: typeof thread.line === 'number' ? thread.line : null,
    author,
    excerpt: text(first.body).split('\n')[0] ?? '',
    url: text(first.url) || null,
    isReplied: lastAuthor !== '' && lastAuthor === prAuthor && author !== prAuthor,
  }
}

/**
 * When one deployment went live: its first success. A deployment a later one replaced
 * may keep only its INACTIVE status, which still proves it was live, from about when it was made.
 */
function liveAt(deployment: Json): number | null {
  const statuses = nodes(deployment.statuses)
  const successes = statuses
    .filter(status => status.state === 'SUCCESS')
    .map(status => time(status.createdAt))
    .filter(at => at !== null)
  if (successes.length > 0) return Math.min(...successes)
  return statuses.some(status => status.state === 'INACTIVE') ? time(deployment.createdAt) : null
}

/** When the commit first went live in the production environment. */
function deployedAt(mergeCommit: unknown, prodEnvironment: string): number | null {
  const wanted = prodEnvironment.toLowerCase()
  const live = nodes(record(mergeCommit).deployments)
    .filter(deployment => text(deployment.environment).toLowerCase().includes(wanted))
    .map(liveAt)
    .filter(at => at !== null)
  return live.length === 0 ? null : Math.min(...live)
}

const REVIEW_STATE: Readonly<Record<string, ReviewerState>> = {
  APPROVED: 'approved',
  CHANGES_REQUESTED: 'changes',
  COMMENTED: 'commented',
}

/** Who is on the PR besides its author: the last review each left, and a request standing over an older review. */
function parseReviewers(row: Json, prAuthor: string): BoardReviewer[] {
  const byName = new Map<string, ReviewerState>()
  for (const review of nodes(row.latestReviews)) {
    const state = REVIEW_STATE[text(review.state)]
    if (state !== undefined) byName.set(text(record(review.author).login), state)
  }
  for (const request of nodes(row.reviewRequests)) {
    const reviewer = record(request.requestedReviewer)
    byName.set(text(reviewer.login) || text(reviewer.name), 'requested')
  }
  return [...byName]
    .filter(([name]) => name !== '' && name !== prAuthor)
    .map(([name, state]) => ({ name, state }))
}

function parseRow(row: Json, prodEnvironment: string): BoardPr | null {
  const url = text(row.url)
  if (url === '' || typeof row.number !== 'number') return null
  const author = text(record(row.author).login)
  const rollup = record(record(nodes(row.commits)[0]?.commit).statusCheckRollup)
  const decision = text(row.reviewDecision)
  return {
    url,
    repo: text(record(row.repository).nameWithOwner),
    number: row.number,
    title: text(row.title),
    branch: text(row.headRefName),
    headSha: text(row.headRefOid),
    isFromFork: row.isCrossRepository === true,
    state: row.state === 'MERGED' ? 'MERGED' : 'OPEN',
    isDraft: row.isDraft === true,
    reviewDecision: decision === 'APPROVED' || decision === 'CHANGES_REQUESTED' || decision === 'REVIEW_REQUIRED' ? decision : null,
    hasConflicts: row.mergeable === 'CONFLICTING',
    checks: nodes(rollup.contexts).map(parseCheck),
    checksState: typeof rollup.state === 'string' ? checkState(rollup.state === 'EXPECTED' ? 'PENDING' : rollup.state) : null,
    threads: nodes(row.reviewThreads)
      .filter(thread => thread.isResolved !== true)
      .map(thread => parseThread(thread, author)),
    reviewers: parseReviewers(row, author),
    files: nodes(row.files).map(file => text(file.path)),
    mergedAt: time(row.mergedAt),
    deployedAt: deployedAt(row.mergeCommit, prodEnvironment),
    // An open row does not ask; only a merged one shows whether its repo deploys.
    hasDeploys: record(record(row.repository).deployments).totalCount !== 0,
  }
}

/** The board's PRs from the GraphQL answer: open ones first, then the merged, each newest first. */
export function parseBoard(stdout: string, prodEnvironment: string): BoardPr[] {
  const data = record(record(JSON.parse(stdout)).data)
  return [...nodes(data.open), ...nodes(data.merged)]
    .map(row => parseRow(row, prodEnvironment))
    .filter(pr => pr !== null)
}

/** What the board's query cost and left of the hour's GraphQL points, or null when the answer does not say. */
export function parseQuota(stdout: string): Quota | null {
  const rateLimit = record(record(record(JSON.parse(stdout)).data).rateLimit)
  const { limit, remaining, cost } = rateLimit
  const isCounted = typeof limit === 'number' && typeof remaining === 'number'
  if (!isCounted) return null
  return { limit, remaining, resetAt: time(rateLimit.resetAt), cost: typeof cost === 'number' ? cost : 0, isExhausted: false }
}

/** Whether gh failed because GitHub's rate limit refused the query. */
export function isRateLimited({ stdout, stderr }: { stdout: string; stderr: string }): boolean {
  return RATE_LIMITED.test(stderr) || stdout.includes('"RATE_LIMIT')
}

/** The quota after a read the rate limit refused: none left, until the reset the last read reported. */
export function exhaustedQuota(last: Quota | null): Quota {
  return { limit: last?.limit ?? 0, remaining: 0, resetAt: last?.resetAt ?? null, cost: last?.cost ?? 0, isExhausted: true }
}

function isLowQuota(quota: Quota | null): boolean {
  return quota !== null && quota.limit > 0 && quota.remaining / quota.limit < LOW_QUOTA_SHARE
}

/**
 * When the board is next read: two minutes on, or ten when the hour's points run low or Slack events bring
 * the changes; after a refusal, once the quota resets.
 */
export function nextReadAt({ quota, now, hasEvents }: { quota: Quota | null; now: number; hasEvents: boolean }): number {
  if (quota?.isExhausted === true) {
    const resetAt = quota.resetAt ?? 0
    return resetAt > now ? resetAt : now + SLOW_POLL_MS
  }
  const isSlow = hasEvents || isLowQuota(quota)
  return now + (isSlow ? SLOW_POLL_MS : BOARD_POLL_MS)
}

/** The footer note when the quota slowed the board, or null at the normal pace. */
export function quotaNote(quota: Quota | null): string | null {
  if (quota === null) return null
  if (quota.isExhausted) return 'slowed: GitHub quota used up'
  return isLowQuota(quota) ? `slowed: GitHub quota ${quota.remaining}/${quota.limit}` : null
}

export function parseTickets({ answer, isDone }: { answer: string; isDone: boolean }): Ticket[] {
  const issues = record(JSON.parse(answer)).issues
  if (!Array.isArray(issues)) return []
  return issues.map(record).map(issue => ({
    id: text(issue.id),
    title: text(issue.title),
    url: text(issue.url),
    status: text(issue.status),
    isDone,
  }))
}

export function countChecks(checks: readonly BoardCheck[]): Record<CheckState, number> {
  const counts: Record<CheckState, number> = { pass: 0, fail: 0, pending: 0 }
  for (const check of checks) counts[check.state] += 1
  return counts
}

/** The ticket a PR works on: the one whose id its title or branch names. */
export function ticketOf(pr: BoardPr, tickets: readonly Ticket[]): Ticket | null {
  return tickets.find(ticket => namesTicket({ pr, ticketId: ticket.id })) ?? null
}

/** Whether a PR's title or branch names the ticket. */
export function namesTicket({ pr, ticketId }: { pr: BoardPr; ticketId: string }): boolean {
  if (!TICKET_ID.test(ticketId)) return false
  return new RegExp(`\\b${ticketId.toLowerCase()}\\b`).test(`${pr.title} ${pr.branch}`.toLowerCase())
}

/**
 * The ticket a workspace title or branch names. A mention counts when its team key is one the
 * board's tickets use, or when it is written in capitals (`YAN-12`), so `cockpit-2` is no ticket.
 */
export function ticketIdIn({ text, teamKeys }: { text: string; teamKeys: ReadonlySet<string> }): string | null {
  for (const [, key = '', number = ''] of text.matchAll(TICKET_MENTION)) {
    const isKnownTeam = teamKeys.has(key.toUpperCase())
    const isWrittenAsKey = key.length >= 2 && key === key.toUpperCase()
    const isTicket = isKnownTeam || isWrittenAsKey
    if (isTicket) return `${key.toUpperCase()}-${number}`
  }
  return null
}

export function teamKeysOf(tickets: readonly Ticket[]): Set<string> {
  return new Set(tickets.map(ticket => ticket.id.split('-')[0]?.toUpperCase() ?? '').filter(key => key !== ''))
}

/** The title of the cmux workspace with this id, from `cmux workspace list --json`. */
export function workspaceTitle({ listing, workspaceId }: { listing: string; workspaceId: string }): string | null {
  const parsed: unknown = JSON.parse(listing)
  const listed = record(parsed).workspaces
  const workspaces = Array.isArray(listed) ? listed.map(record) : []
  const found = workspaces.find(workspace => text(workspace.id) === workspaceId)
  return found === undefined ? null : text(found.title)
}

export function age(since: number, now: number): string {
  const minutes = Math.max(0, Math.round((now - since) / 60_000))
  if (minutes < 60) return `${minutes}m`
  const hours = Math.round(minutes / 60)
  return hours < 48 ? `${hours}h` : `${Math.round(hours / 24)}d`
}

/** Open PRs, and the ones merged in the last day: a day on, a merged PR is in production. */
export function isOnBoard({ pr, now }: { pr: BoardPr; now: number }): boolean {
  return pr.state === 'OPEN' || (pr.mergedAt !== null && now - pr.mergedAt <= DAY_MS)
}

/** PRs that reached production since the last read: the ones to announce. */
export function newlyDeployed(last: readonly BoardPr[] | null, next: readonly BoardPr[]): BoardPr[] {
  if (last === null) return []
  const deployedBefore = new Set(last.filter(pr => pr.deployedAt !== null).map(pr => pr.url))
  return next.filter(pr => pr.deployedAt !== null && !deployedBefore.has(pr.url))
}

export function asDismissed(stored: unknown): string[] {
  return Array.isArray(stored) ? stored.filter(url => typeof url === 'string') : []
}

/** An open PR that can merge now: not a draft, no conflicts, every check passed, and approved or needing no review. */
export function isReadyToMerge(pr: BoardPr): boolean {
  const isBlocked = pr.state !== 'OPEN' || pr.isDraft || pr.hasConflicts
  if (isBlocked) return false
  const counts = countChecks(pr.checks)
  // The rollup counts every check, beyond the page of them the board reads.
  const isRollupGreen = pr.checksState === null || pr.checksState === 'pass'
  const isGreen = counts.fail === 0 && counts.pending === 0 && isRollupGreen
  const isReviewed = pr.reviewDecision === 'APPROVED' || pr.reviewDecision === null
  return isGreen && isReviewed
}

/** What changed on my open PRs since the last read, each as one line to toast. The first read says nothing. */
export function prChanges({ last, next }: { last: readonly BoardPr[] | null; next: readonly BoardPr[] }): string[] {
  if (last === null) return []
  const before = new Map(last.map(pr => [pr.url, pr]))
  return next.flatMap(pr => {
    const previous = before.get(pr.url)
    const isStillOpen = previous !== undefined && previous.state === 'OPEN' && pr.state === 'OPEN'
    return isStillOpen ? changesOf({ previous, pr }) : []
  })
}

/** A ticket that is still open although a PR naming it merged and none naming it is open: one to move to Done. */
export function isMergedButOpen({ ticket, prs }: { ticket: Ticket; prs: readonly BoardPr[] }): boolean {
  if (ticket.isDone) return false
  const named = prs.filter(pr => namesTicket({ pr, ticketId: ticket.id }))
  return named.some(pr => pr.state === 'MERGED') && !named.some(pr => pr.state === 'OPEN')
}

function changesOf({ previous, pr }: { previous: BoardPr; pr: BoardPr }): string[] {
  const label = `${pr.repo}#${pr.number}`
  const changes: string[] = []
  const failing = pr.checks.filter(check => check.state === 'fail')
  const wasFailing = countChecks(previous.checks).fail > 0
  const isNewFailure = failing.length > 0 && !wasFailing
  if (isNewFailure) changes.push(`${label}: CI failed (${failing.map(check => check.name).join(', ')}).`)
  const newThreads = waitingThreads(pr) - waitingThreads(previous)
  if (newThreads > 0) changes.push(`${label}: ${newThreads} new review thread${newThreads === 1 ? '' : 's'}.`)
  const isNewlyReady = isReadyToMerge(pr) && !isReadyToMerge(previous)
  if (isNewlyReady) changes.push(`${label} is green and ready to merge.`)
  return changes
}

function waitingThreads(pr: BoardPr): number {
  return pr.threads.filter(thread => !thread.isReplied).length
}
