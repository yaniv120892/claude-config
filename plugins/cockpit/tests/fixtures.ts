type RowOptions = {
  number: number
  state?: 'OPEN' | 'MERGED'
  mergedAt?: string | null
  deployments?: { environment: string; createdAt?: string; statuses: { state: string; createdAt: string }[] }[]
  checks?: object[]
  threads?: object[]
  title?: string
  hasDeploys?: boolean
  reviewDecision?: string | null
  isFromFork?: boolean
  requested?: string[]
  reviews?: { login: string; state: string }[]
}

/** A search result as the board's query asks for it: an open PR's fragment, or a merged PR's slimmer one. */
export function row(options: RowOptions) {
  return options.state === 'MERGED' ? mergedRow(options) : openRow(options)
}

function openRow({ number, checks = [], threads = [], title, reviewDecision = 'REVIEW_REQUIRED', isFromFork = false, requested = [], reviews = [] }: RowOptions) {
  return {
    number,
    title: title ?? `feat(YAN-${number}): change ${number}`,
    url: `https://github.com/acme/app/pull/${number}`,
    isDraft: false,
    state: 'OPEN',
    reviewDecision,
    mergeable: 'MERGEABLE',
    headRefName: `yan-${number}-change`,
    headRefOid: `sha${number}`,
    isCrossRepository: isFromFork,
    author: { login: 'me' },
    repository: { nameWithOwner: 'acme/app' },
    reviewRequests: { nodes: requested.map(login => ({ requestedReviewer: { login } })) },
    latestReviews: { nodes: reviews.map(review => ({ author: { login: review.login }, state: review.state })) },
    commits: { nodes: [{ commit: { statusCheckRollup: { contexts: { nodes: checks } } } }] },
    reviewThreads: { nodes: threads },
  }
}

function mergedRow({ number, mergedAt = null, deployments = [], title, hasDeploys = true }: RowOptions) {
  return {
    number,
    title: title ?? `feat(YAN-${number}): change ${number}`,
    url: `https://github.com/acme/app/pull/${number}`,
    state: 'MERGED',
    mergedAt,
    headRefName: `yan-${number}-change`,
    author: { login: 'me' },
    repository: { nameWithOwner: 'acme/app', deployments: { totalCount: hasDeploys ? 3 : 0 } },
    mergeCommit: { deployments: { nodes: deployments.map(d => ({ ...d, statuses: { nodes: d.statuses } })) } },
    files: { nodes: [{ path: 'src/billing/charge.ts' }] },
  }
}

export function thread({ author, lastAuthor, isResolved = false }: { author: string; lastAuthor?: string; isResolved?: boolean }) {
  return {
    isResolved,
    path: 'src/billing/charge.ts',
    line: 7,
    comments: { nodes: [{ author: { login: author }, body: 'Rename this.\nIt reads oddly.', url: 'https://github.com/acme/app/pull/1#discussion_r1' }] },
    latest: { nodes: [{ author: { login: lastAuthor ?? author } }] },
  }
}

export const PLENTY_OF_QUOTA = { limit: 5000, remaining: 4800, resetAt: '2026-11-01T11:00:00Z', cost: 3 }

export function boardAnswer(open: object[], merged: object[] = [], rateLimit: object = PLENTY_OF_QUOTA): string {
  return JSON.stringify({ data: { rateLimit, open: { nodes: open }, merged: { nodes: merged } } })
}

function ran(exitCode: number, stdout: string, stderr: string) {
  return { value: { exitCode, stdout, stderr, isStdoutTruncated: false, isStderrTruncated: false } }
}

export const ok = (stdout: string) => ran(0, stdout, '')
export const fail = (stderr: string) => ran(1, '', stderr)
