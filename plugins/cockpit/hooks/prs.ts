import type { BoardCheck, BoardPr, BoardThread, CheckState, Ticket } from '../types'

const MERGED_DAYS = 7
const DAY_MS = 86_400_000
// Also what makes an id safe to build a pattern from.
const TICKET_ID = /^[A-Za-z][A-Za-z0-9]*-\d+$/

export const BOARD_QUERY = `
query($open: String!, $merged: String!) {
  open: search(query: $open, type: ISSUE, first: 30) { nodes { ...Row } }
  merged: search(query: $merged, type: ISSUE, first: 15) { nodes { ...Row ... on PullRequest { files(first: 60) { nodes { path } } } } }
}
fragment Row on PullRequest {
  number title url isDraft state mergedAt reviewDecision mergeable headRefName
  author { login }
  repository { nameWithOwner }
  mergeCommit { deployments(first: 10) { nodes { environment createdAt statuses(first: 10) { nodes { state createdAt } } } } }
  commits(last: 1) { nodes { commit { statusCheckRollup { contexts(first: 60) { nodes {
    __typename
    ... on CheckRun { name status conclusion detailsUrl }
    ... on StatusContext { context state targetUrl }
  } } } } } }
  reviewThreads(first: 60) { nodes {
    isResolved path line
    comments(first: 1) { nodes { author { login } body url } }
    latest: comments(last: 1) { nodes { author { login } } }
  } }
}`

/** The two searches the board runs: my open PRs, and mine merged in the last week. */
export function boardSearches(now: number): { open: string; merged: string } {
  const since = new Date(now - MERGED_DAYS * DAY_MS).toISOString().slice(0, 10)
  return {
    open: 'is:pr is:open author:@me archived:false sort:updated-desc',
    merged: `is:pr is:merged author:@me merged:>=${since} sort:updated-desc`,
  }
}

type Json = Record<string, unknown>

function record(value: unknown): Json {
  return typeof value === 'object' && value !== null ? { ...value } : {}
}

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
    state: row.state === 'MERGED' ? 'MERGED' : 'OPEN',
    isDraft: row.isDraft === true,
    reviewDecision: decision === 'APPROVED' || decision === 'CHANGES_REQUESTED' || decision === 'REVIEW_REQUIRED' ? decision : null,
    hasConflicts: row.mergeable === 'CONFLICTING',
    checks: nodes(rollup.contexts).map(parseCheck),
    threads: nodes(row.reviewThreads)
      .filter(thread => thread.isResolved !== true)
      .map(thread => parseThread(thread, author)),
    files: nodes(row.files).map(file => text(file.path)),
    mergedAt: time(row.mergedAt),
    deployedAt: deployedAt(row.mergeCommit, prodEnvironment),
  }
}

/** The board's PRs from the GraphQL answer: open ones first, then the merged, each newest first. */
export function parseBoard(stdout: string, prodEnvironment: string): BoardPr[] {
  const data = record(record(JSON.parse(stdout)).data)
  return [...nodes(data.open), ...nodes(data.merged)]
    .map(row => parseRow(row, prodEnvironment))
    .filter(pr => pr !== null)
}

export function parseTickets(answer: string): Ticket[] {
  const issues = record(JSON.parse(answer)).issues
  if (!Array.isArray(issues)) return []
  return issues.map(record).map(issue => ({
    id: text(issue.id),
    title: text(issue.title),
    url: text(issue.url),
    status: text(issue.status),
  }))
}

export function countChecks(checks: readonly BoardCheck[]): Record<CheckState, number> {
  const counts: Record<CheckState, number> = { pass: 0, fail: 0, pending: 0 }
  for (const check of checks) counts[check.state] += 1
  return counts
}

/** The ticket a PR works on: the one whose id its title or branch names. */
export function ticketOf(pr: BoardPr, tickets: readonly Ticket[]): Ticket | null {
  const named = `${pr.title} ${pr.branch}`.toLowerCase()
  return tickets.find(ticket => TICKET_ID.test(ticket.id) && new RegExp(`\\b${ticket.id.toLowerCase()}\\b`).test(named)) ?? null
}

export function age(since: number, now: number): string {
  const minutes = Math.max(0, Math.round((now - since) / 60_000))
  if (minutes < 60) return `${minutes}m`
  const hours = Math.round(minutes / 60)
  return hours < 48 ? `${hours}h` : `${Math.round(hours / 24)}d`
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
