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
  /** What the session has cost so far, drawn only where no usage limit is reported. */
  costUsd: number | null
}

export type UsageLimit = {
  /** `5h` or `wk`, as the band draws it. */
  label: string
  /** `5-hour` or `Weekly`, as a toast says it. */
  name: string
  percent: number
  /** ISO 8601; null when the window reports no reset. */
  resetsAt: string | null
}

export type PrRead = { pr: PullRequest | null; error: string | null }

declare module 'claude-code' {
  interface PluginState {
    mods: {
      /** True once the person chose "Allow for this session" at the git write gate. */
      gitGrant: boolean
      /** Null until the band's first read. A reload that changes Band's fields bumps the atom's shape tag. */
      band: Shaped<Band | null>
      /** Null until the PR's first read. */
      prRead: PrRead | null
    }
  }
}
