export const PR_VIEW = {
  number: 51,
  title: 'feat(mods): add the mods plugin',
  url: 'https://github.com/owner/claude-config/pull/51',
  state: 'OPEN',
  isDraft: false,
  mergeable: 'CONFLICTING',
  reviewDecision: 'CHANGES_REQUESTED',
  statusCheckRollup: [
    { __typename: 'CheckRun', name: 'tests', status: 'COMPLETED', conclusion: 'SUCCESS' },
    { __typename: 'CheckRun', name: 'lint', status: 'COMPLETED', conclusion: 'FAILURE' },
    { __typename: 'CheckRun', name: 'deploy', status: 'IN_PROGRESS', conclusion: '' },
    { __typename: 'CheckRun', name: 'docs', status: 'COMPLETED', conclusion: 'SKIPPED' },
    { __typename: 'StatusContext', context: 'ci/legacy', state: 'PENDING' },
  ],
}

type Thread = { isResolved: boolean; path: string; line: number | null; author: string | null; body: string }

export function threadsAnswer(threads: readonly Thread[]): string {
  const nodes = threads.map(({ author, body, ...thread }) => ({
    ...thread,
    comments: { nodes: [{ author: author === null ? null : { login: author }, body }] },
  }))
  return JSON.stringify({ data: { repository: { pullRequest: { reviewThreads: { nodes } } } } })
}

export const THREADS = threadsAnswer([
  { isResolved: false, path: 'hooks/register.tsx', line: 12, author: 'reviewer', body: 'Rename this.\nIt reads oddly.' },
  { isResolved: true, path: 'README.md', line: 3, author: 'reviewer', body: 'Done' },
  { isResolved: false, path: 'install.sh', line: null, author: null, body: 'Outdated?' },
])

function ran(exitCode: number, stdout: string, stderr: string) {
  return { value: { exitCode, stdout, stderr, isStdoutTruncated: false, isStderrTruncated: false } }
}

export const ok = (stdout: string) => ran(0, stdout, '')
export const fail = (stderr: string) => ran(1, '', stderr)
