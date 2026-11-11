export type Tab = 'inbox' | 'prs' | 'alerts' | 'skills'

export type Reviewer = 'claude' | 'codex'

/** A Slack message that holds a GitHub PR link. */
export type InboxItem = {
  /** The PR's URL: one row per PR, however often it is posted. */
  prUrl: string
  /** The Slack message: `<channel id>:<ts>`; empty for a row an earlier version stored. */
  messageId: string
  /** The thread a reply joins: `<channel id>:<ts>` of its first message, the message itself when it is top-level. */
  threadId: string
  repo: string
  number: number
  from: string
  channel: string
  permalink: string
  excerpt: string
  /** When the message was posted, in epoch milliseconds. */
  at: number
  handledBy: Reviewer | 'dismissed' | null
}

export type CheckState = 'pass' | 'fail' | 'pending'

export type BoardCheck = { name: string; state: CheckState; url: string | null }

export type BoardThread = {
  path: string
  line: number | null
  author: string
  /** The thread's first comment, first line only. */
  excerpt: string
  url: string | null
  /** The PR's author wrote the thread's last comment, so it waits on the reviewer. */
  isReplied: boolean
}

export type BoardPr = {
  url: string
  repo: string
  number: number
  title: string
  branch: string
  /** The head commit the board read; a merge names it, so a later push makes the merge refuse. */
  headSha: string
  /** The head branch lives in a fork, so the base repo holds no branch of it to delete. */
  isFromFork: boolean
  state: 'OPEN' | 'MERGED'
  isDraft: boolean
  reviewDecision: 'APPROVED' | 'CHANGES_REQUESTED' | 'REVIEW_REQUIRED' | null
  hasConflicts: boolean
  checks: BoardCheck[]
  /** Unresolved review threads only. */
  threads: BoardThread[]
  files: string[]
  mergedAt: number | null
  /** When the merge commit's deployment to production succeeded. */
  deployedAt: number | null
  /** Whether the repo has any deployment at all; a repo with none is finished at merge. */
  hasDeploys: boolean
}

export type Ticket = {
  id: string
  title: string
  url: string
  status: string
  /** Done within the last day; a day on, it leaves the board. */
  isDone: boolean
}

/** A Merge pressed once: which PR, and when. */
export type PendingMerge = { url: string; at: number }

/** The ticket this session works on, and where its id was found. */
export type Focus = {
  ticketId: string
  source: 'workspace' | 'branch'
}

export type Board = {
  prs: BoardPr[]
  tickets: Ticket[]
  error: string | null
  ticketsError: string | null
  readAt: number
}

export type AlertVerdict = 'likely' | 'unlikely' | 'unclear'

export type Alert = {
  /** The Slack message: `<channel id>:<ts>`. */
  id: string
  channel: string
  permalink: string
  text: string
  at: number
  /** The deployed PR the alert was compared to; null when none was in its watch window. */
  prUrl: string | null
  verdict: AlertVerdict | null
  reason: string
}

export type SlackLink = {
  state: 'off' | 'starting' | 'standby' | 'connected' | 'error'
  detail: string
}

export type UsageLimit = { label: string; percent: number; resetsAt: number | null }

/** How full the context is: against the auto-compact threshold when auto-compact is on, else against the window. */
export type ContextGauge = {
  percent: number
  /** Tokens left before auto-compact runs; null when it is off or its threshold is not known. */
  tokensToCompact: number | null
  isAutoCompactOff: boolean
}

export type UsageView = {
  context: ContextGauge | null
  limits: UsageLimit[]
  costUsd: number | null
}

export type SkillButton = { prompt: string; count: number; isPinned: boolean }

declare module 'claude-code' {
  interface PluginState {
    cockpit: {
      tab: Tab
      inbox: Shaped<InboxItem[]>
      board: Shaped<Board | null>
      alerts: Shaped<Alert[]>
      dismissed: string[]
      expanded: string | null
      isShowingDismissed: boolean
      slack: SlackLink
      usage: Shaped<UsageView | null>
      skills: Shaped<SkillButton[]>
      /** The row whose reply field is open, and what has been typed in it. */
      replyingTo: string | null
      replyDraft: string
      focus: Shaped<Focus | null>
      /** The PRs tab shows every PR, not only the focus ticket's. */
      isShowingAllPrs: boolean
      /** The ticket row expanded to list its PRs. */
      openTicket: string | null
      /** The PR whose Merge was pressed once, and when: a second press soon after merges it. */
      confirmingMerge: PendingMerge | null
    }
  }
}
