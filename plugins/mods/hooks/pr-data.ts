import type { CheckState, PrCheck, PrThread, PullRequest } from '../types'
import { truncate } from './text'

export const PR_FIELDS = 'number,title,url,state,isDraft,mergeable,reviewDecision,statusCheckRollup'
// gh fills `{owner}` and `{repo}` from the current repository, as `gh pr view` does.
export const THREADS_QUERY = `query($owner: String!, $repo: String!, $number: Int!) {
  repository(owner: $owner, name: $repo) {
    pullRequest(number: $number) {
      reviewThreads(first: 100) {
        nodes { isResolved path line comments(first: 1) { nodes { author { login } body } } }
      }
    }
  }
}`

// In the order the pane lists them, worst first.
export const CHECK = {
  fail: { mark: '✗', color: 'red' },
  pending: { mark: '…', color: 'yellow' },
  pass: { mark: '✓', color: 'green' },
  skipped: { mark: '-', color: 'gray' },
} as const
export const CHECK_STATES = Object.keys(CHECK) as CheckState[]

const EXCERPT_LENGTH = 100
const PASSING = new Set(['SUCCESS', 'NEUTRAL'])
const SKIPPED = new Set(['SKIPPED', 'STALE'])
const FAILING = new Set(['FAILURE', 'ERROR'])
const NO_PR = /no pull requests? found|not a git repository|could not determine/i

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
            comments: { nodes: { author: { login: string } | null; body: string }[] }
          }[]
        }
      }
    }
  }
}

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
        excerpt: truncate(firstLine, EXCERPT_LENGTH),
      }
    })
}

/** Null when the branch simply has no PR, which is no error to show. */
export function prViewError(stderr: string): string | null {
  return NO_PR.test(stderr) ? null : stderr.trim().split('\n')[0] || 'gh failed'
}

export function countChecks(checks: readonly PrCheck[]): Record<CheckState, number> {
  const counts = { fail: 0, pending: 0, pass: 0, skipped: 0 }
  for (const check of checks) counts[check.state]++
  return counts
}

export function contextColor(percent: number): string {
  if (percent >= 75) return 'red'
  if (percent >= 50) return 'yellow'
  return 'green'
}

export function basename(path: string): string {
  return path.replace(/\/+$/, '').split('/').pop() ?? path
}
