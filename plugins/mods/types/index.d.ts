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
  /** The PR's author wrote the thread's last comment, so it waits on the reviewer. */
  isReplied: boolean
}

/** GitHub's mergeStateStatus: CLEAN can merge now; the rest say what stands in the way. */
export type MergeState = 'CLEAN' | 'HAS_HOOKS' | 'BEHIND' | 'BLOCKED' | 'DIRTY' | 'DRAFT' | 'UNSTABLE' | 'UNKNOWN'

export type PullRequest = {
  number: number
  title: string
  url: string
  headRefName: string
  state: 'OPEN' | 'MERGED' | 'CLOSED'
  isDraft: boolean
  mergeable: 'MERGEABLE' | 'CONFLICTING' | 'UNKNOWN'
  reviewDecision: 'APPROVED' | 'CHANGES_REQUESTED' | 'REVIEW_REQUIRED' | null
  mergeState: MergeState
  author: string
  checks: PrCheck[]
  /** The unresolved review threads. */
  threads: PrThread[]
  resolvedThreads: number
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

/** When each PR skill last ran, by what it ran against: a branch, a PR number or a PR URL. */
export type PrSkillRuns = Record<string, Record<string, string>>

export type PrSkillState = {
  /** The repository the session is in, which every branch and number key starts with. */
  root: string | null
  runs: PrSkillRuns
}

declare module 'claude-code' {
  interface PluginState {
    mods: {
      /** True once the person chose "Allow for this session" at the git write gate. */
      gitGrant: boolean
      /** Null until the band's first read. A reload that changes Band's fields bumps the atom's shape tag. */
      band: Shaped<Band | null>
      /** Null until the PR's first read. */
      prRead: PrRead | null
      /** The PRs opened this session, newest first: the URLs found, and each one's last read. */
      sessionPrUrls: string[]
      sessionPrs: Shaped<PullRequest[]>
      /** Which PR skills ran on each PR, mirrored from the store so the band reads it without I/O. */
      prSkills: PrSkillState
    }
  }
}
