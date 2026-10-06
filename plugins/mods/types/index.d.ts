// The session state the mods keep in $.state, and the shapes the status band
// and the PR pane draw from.

export type GitLocation = {
  /** The repository's name, or null outside a repository. */
  repo: string | null
  /** The session directory's own name. */
  dir: string
  /** The checked-out branch, or null on a detached HEAD or outside a repository. */
  branch: string | null
  isDirty: boolean
}

export type CheckState = 'pass' | 'fail' | 'pending' | 'skipped'

export type PrCheck = { name: string; state: CheckState }

export type PrThread = {
  path: string
  line: number | null
  author: string
  /** The thread's first comment, first line only. */
  excerpt: string
  url: string
}

export type PullRequest = {
  number: number
  title: string
  url: string
  state: 'OPEN' | 'MERGED' | 'CLOSED'
  isDraft: boolean
  mergeable: 'MERGEABLE' | 'CONFLICTING' | 'UNKNOWN'
  reviewDecision: 'APPROVED' | 'CHANGES_REQUESTED' | 'REVIEW_REQUIRED' | null
  checks: PrCheck[]
  threads: PrThread[]
}

declare module 'claude-code' {
  interface PluginState {
    mods: {
      /** True once the person chose "Allow for this session" at the git write gate. */
      gitGrant: boolean
      location: GitLocation | null
      model: string | null
      contextPercent: number | null
      pr: PullRequest | null
      /** Why the PR could not be read (gh missing, not signed in); null when it was. */
      prError: string | null
      /** When the PR was last read, in ms since the epoch; 0 before the first read. */
      prFetchedAt: number
    }
  }
}
