import type { BoardCheck, BoardPr, BoardThread, CheckState, Ticket } from '../types'

const MERGED_DAYS = 7
const DAY_MS = 86_400_000
// Also what makes an id safe to build a pattern from.
const TICKET_ID = /^[A-Za-z][A-Za-z0-9]*-\d+$/
const TICKET_MENTION = /\b([A-Za-z][A-Za-z0-9]*)-(\d+)\b/g

export const BOARD_QUERY = `
query($open: String!, $merged: String!) {
  open: search(query: $open, type: ISSUE, first: 30) { nodes { ...Row } }
  merged: search(query: $merged, type: ISSUE, first: 30) { nodes { ...Row ... on PullRequest { files(first: 60) { nodes { path } } } } }
}
fragment Row on PullRequest {
  number title url isDraft state mergedAt reviewDecision mergeable headRefName
  author { login }
  repository { nameWithOwner deployments { totalCount } }
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
  if (pr.state !== 'OPEN' || pr.isDraft || pr.hasConflicts) return false
  const counts = countChecks(pr.checks)
  const isGreen = counts.fail === 0 && counts.pending === 0
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
  if (failing.length > 0 && !wasFailing) changes.push(`${label}: CI failed (${failing.map(check => check.name).join(', ')}).`)
  const waiting = pr.threads.filter(thread => !thread.isReplied).length
  const waitedBefore = previous.threads.filter(thread => !thread.isReplied).length
  if (waiting > waitedBefore) changes.push(`${label}: ${waiting - waitedBefore} new review thread${waiting - waitedBefore === 1 ? '' : 's'}.`)
  if (isReadyToMerge(pr) && !isReadyToMerge(previous)) changes.push(`${label} is green and ready to merge.`)
  return changes
}
