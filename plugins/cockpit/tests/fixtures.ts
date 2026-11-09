type RowOptions = {
  number: number
  state?: 'OPEN' | 'MERGED'
  mergedAt?: string | null
  deployments?: { environment: string; createdAt?: string; statuses: { state: string; createdAt: string }[] }[]
  checks?: object[]
  threads?: object[]
  title?: string
}

export function row({ number, state = 'OPEN', mergedAt = null, deployments = [], checks = [], threads = [], title }: RowOptions) {
  return {
    number,
    title: title ?? `feat(YAN-${number}): change ${number}`,
    url: `https://github.com/acme/app/pull/${number}`,
    isDraft: false,
    state,
    mergedAt,
    reviewDecision: 'REVIEW_REQUIRED',
    mergeable: 'MERGEABLE',
    headRefName: `yan-${number}-change`,
    author: { login: 'me' },
    repository: { nameWithOwner: 'acme/app' },
    mergeCommit: state === 'MERGED' ? { deployments: { nodes: deployments.map(d => ({ ...d, statuses: { nodes: d.statuses } })) } } : null,
    commits: { nodes: [{ commit: { statusCheckRollup: { contexts: { nodes: checks } } } }] },
    reviewThreads: { nodes: threads },
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

export function boardAnswer(open: object[], merged: object[] = []): string {
  return JSON.stringify({ data: { open: { nodes: open }, merged: { nodes: merged } } })
}

function ran(exitCode: number, stdout: string, stderr: string) {
  return { value: { exitCode, stdout, stderr, isStdoutTruncated: false, isStderrTruncated: false } }
}

export const ok = (stdout: string) => ran(0, stdout, '')
export const fail = (stderr: string) => ran(1, '', stderr)
