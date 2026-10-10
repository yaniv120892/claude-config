import type { CheckState, MergeState, PrCheck, PrThread, PullRequest } from '../types'
import { truncate } from './text'

export const PR_FIELDS = 'number,title,url,headRefName,state,isDraft,mergeable,reviewDecision,mergeStateStatus,author,statusCheckRollup'
export const THREADS_QUERY = `query($owner: String!, $repo: String!, $number: Int!) {
  repository(owner: $owner, name: $repo) {
    pullRequest(number: $number) {
      reviewThreads(first: 100) {
        nodes {
          isResolved path line
          comments(first: 1) { nodes { author { login } body } }
          latest: comments(last: 1) { nodes { author { login } } }
        }
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
const MERGE_STATES = new Set<string>(['CLEAN', 'HAS_HOOKS', 'BEHIND', 'BLOCKED', 'DIRTY', 'DRAFT', 'UNSTABLE'])
const PR_URL = /https:\/\/github\.com\/([\w.-]+)\/([\w.-]+)\/pull\/(\d+)/g

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

export function parsePrView(json: string): Omit<PullRequest, 'threads' | 'resolvedThreads'> {
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
  const mergeState = String(view.mergeStateStatus)
  const author = view.author as { login?: unknown } | null | undefined
  return {
    number: Number(view.number),
    title: String(view.title),
    url: String(view.url),
    headRefName: String(view.headRefName ?? ''),
    state: view.state === 'MERGED' || view.state === 'CLOSED' ? view.state : 'OPEN',
    isDraft: view.isDraft === true,
    mergeable: mergeable === 'MERGEABLE' || mergeable === 'CONFLICTING' ? mergeable : 'UNKNOWN',
    reviewDecision:
      decision === 'APPROVED' || decision === 'CHANGES_REQUESTED' || decision === 'REVIEW_REQUIRED'
        ? decision
        : null,
    mergeState: MERGE_STATES.has(mergeState) ? (mergeState as MergeState) : 'UNKNOWN',
    author: typeof author?.login === 'string' ? author.login : 'ghost',
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
            latest?: { nodes: { author: { login: string } | null }[] }
          }[]
        }
      }
    }
  }
}

export function parseThreads(json: string, prAuthor: string): { threads: PrThread[]; resolvedThreads: number } {
  const answer = JSON.parse(json) as ThreadsAnswer
  const nodes = answer.data?.repository?.pullRequest?.reviewThreads?.nodes ?? []
  const threads = nodes
    .filter(thread => !thread.isResolved)
    .map(thread => {
      const first = thread.comments.nodes[0]
      const firstLine = (first?.body ?? '').trim().split('\n')[0] ?? ''
      const lastAuthor = thread.latest?.nodes[0]?.author?.login
      return {
        path: thread.path,
        line: thread.line,
        author: first?.author?.login ?? 'ghost',
        excerpt: truncate(firstLine, EXCERPT_LENGTH),
        isReplied: lastAuthor === prAuthor,
      }
    })
  return { threads, resolvedThreads: nodes.length - threads.length }
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

/** Where GitHub stands on the PR, in a word or two, and the colour to draw it in. */
export function prStatus(pr: PullRequest): { label: string; color: string } {
  if (pr.state === 'MERGED') return { label: 'merged', color: 'magenta' }
  if (pr.state === 'CLOSED') return { label: 'closed', color: 'gray' }
  if (pr.isDraft) return { label: 'draft', color: 'gray' }
  switch (pr.reviewDecision) {
    case 'APPROVED':
      return { label: 'approved', color: 'green' }
    case 'CHANGES_REQUESTED':
      return { label: 'changes requested', color: 'red' }
    case 'REVIEW_REQUIRED':
      return { label: 'awaiting review', color: 'yellow' }
    default:
      return { label: 'open', color: 'cyan' }
  }
}

/** Open, not a draft, and GitHub would merge it now: checks, reviews and branch rules all met. */
export function isReadyToMerge(pr: PullRequest): boolean {
  return pr.state === 'OPEN' && !pr.isDraft && (pr.mergeState === 'CLEAN' || pr.mergeState === 'HAS_HOOKS')
}

export type PrAddress = { owner: string; repo: string; number: number; url: string }

/** Every GitHub PR link in the text, each once, as `gh pr create` prints the one it made. */
export function prAddresses(text: string): PrAddress[] {
  const seen = new Map<string, PrAddress>()
  for (const [url, owner = '', repo = '', number = ''] of text.matchAll(PR_URL)) {
    seen.set(url, { owner, repo, number: Number(number), url })
  }
  return [...seen.values()]
}

export function basename(path: string): string {
  return path.replace(/\/+$/, '').split('/').pop() ?? path
}
