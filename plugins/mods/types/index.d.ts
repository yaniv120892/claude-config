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

export type Band = {
  location: GitLocation
  model: string
  contextPercent: number | null
  /** Empty off a subscription, or before the first response reports a window. */
  usageLimits: UsageLimit[]
}

export type UsageLimit = { label: string; percent: number }

export type PrRead = { pr: PullRequest | null; error: string | null }

declare module 'claude-code' {
  interface PluginState {
    mods: {
      /** True once the person chose "Allow for this session" at the git write gate. */
      gitGrant: boolean
      /** Null until the band's first read. */
      band: Band | null
      /** Null until the PR's first read. */
      prRead: PrRead | null
    }
  }
}
