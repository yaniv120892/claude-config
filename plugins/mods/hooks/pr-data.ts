// Reading a PR out of gh's answers, and summing it up for the band and pane.
import type { CheckState, PrCheck, PrThread, PullRequest } from '../types'

export const PR_FIELDS = 'number,title,url,state,isDraft,mergeable,reviewDecision,statusCheckRollup'
export const THREADS_QUERY = `query($owner: String!, $name: String!, $number: Int!) {
  repository(owner: $owner, name: $name) {
    pullRequest(number: $number) {
      reviewThreads(first: 100) {
        nodes { isResolved path line comments(first: 1) { nodes { author { login } body url } } }
      }
    }
  }
}`

const PR_URL = /^https:\/\/[^/]+\/([^/]+)\/([^/]+)\/pull\/(\d+)/
const EXCERPT_LENGTH = 100
const PASSING = new Set(['SUCCESS', 'NEUTRAL'])
const SKIPPED = new Set(['SKIPPED', 'STALE'])
const FAILING = new Set(['FAILURE', 'ERROR'])
const NO_PR = /no pull requests? found|not a git repository|could not determine/i

/** A check run or commit status from `statusCheckRollup`, as one state. */
export function checkState(entry: Record<string, unknown>): CheckState {
  if (entry.__typename === 'StatusContext') {
    const state = String(entry.state)
    if (PASSING.has(state)) return 'pass'
    if (FAILING.has(state)) return 'fail'
    return 'pending'
  }
  if (entry.status !== 'COMPLETED') return 'pending'
  const conclusion = String(entry.conclusion)
  if (PASSING.has(conclusion)) return 'pass'
  if (SKIPPED.has(conclusion)) return 'skipped'
  return 'fail'
}

/** `gh pr view --json` output, less the review threads GraphQL has to supply. */
export function parsePrView(json: string): Omit<PullRequest, 'threads'> {
  const view = JSON.parse(json) as Record<string, unknown>
  const rollup = Array.isArray(view.statusCheckRollup)
    ? (view.statusCheckRollup as Record<string, unknown>[])
    : []
  const checks: PrCheck[] = rollup.map(entry => ({
    name: String(entry.name ?? entry.context ?? 'check'),
    state: checkState(entry),
  }))
  const decision = view.reviewDecision
  const mergeable = view.mergeable
  return {
    number: Number(view.number),
    title: String(view.title),
    url: String(view.url),
    state: view.state === 'MERGED' || view.state === 'CLOSED' ? view.state : 'OPEN',
    isDraft: view.isDraft === true,
    mergeable: mergeable === 'MERGEABLE' || mergeable === 'CONFLICTING' ? mergeable : 'UNKNOWN',
    reviewDecision:
      decision === 'APPROVED' || decision === 'CHANGES_REQUESTED' || decision === 'REVIEW_REQUIRED'
        ? decision
        : null,
    checks,
  }
}

type ThreadsAnswer = {
  data?: {
    repository?: {
      pullRequest?: {
        reviewThreads?: {
          nodes?: {
            isResolved: boolean
            path: string
            line: number | null
            comments: { nodes: { author: { login: string } | null; body: string; url: string }[] }
          }[]
        }
      }
    }
  }
}

/** The unresolved review threads out of the GraphQL answer. */
export function parseThreads(json: string): PrThread[] {
  const answer = JSON.parse(json) as ThreadsAnswer
  const nodes = answer.data?.repository?.pullRequest?.reviewThreads?.nodes ?? []
  return nodes
    .filter(thread => !thread.isResolved)
    .map(thread => {
      const first = thread.comments.nodes[0]
      const firstLine = (first?.body ?? '').trim().split('\n')[0] ?? ''
      return {
        path: thread.path,
        line: thread.line,
        author: first?.author?.login ?? 'ghost',
        excerpt: firstLine.length > EXCERPT_LENGTH ? `${firstLine.slice(0, EXCERPT_LENGTH)}…` : firstLine,
        url: first?.url ?? '',
      }
    })
}

/** `owner`, `name` and `number` out of a PR's URL, for the threads query. */
export function prUrlParts(url: string): { owner: string; name: string; number: string } | null {
  const [, owner, name, number] = PR_URL.exec(url) ?? []
  return owner && name && number ? { owner, name, number } : null
}

/** gh's stderr when `gh pr view` failed: null when the branch simply has no PR. */
export function prViewError(stderr: string): string | null {
  return NO_PR.test(stderr) ? null : (stderr.trim().split('\n')[0] ?? 'gh failed')
}

export function checksSummary(checks: readonly PrCheck[]): { failing: number; pending: number; passing: number } {
  return {
    failing: checks.filter(check => check.state === 'fail').length,
    pending: checks.filter(check => check.state === 'pending').length,
    passing: checks.filter(check => check.state === 'pass').length,
  }
}

export function contextColor(percent: number): string {
  if (percent >= 75) return 'red'
  if (percent >= 50) return 'yellow'
  return 'green'
}

export function basename(path: string): string {
  return path.replace(/\/+$/, '').split('/').pop() ?? path
}

export function dirname(path: string): string {
  const trimmed = path.replace(/\/+$/, '')
  return trimmed.slice(0, trimmed.lastIndexOf('/')) || '/'
}
