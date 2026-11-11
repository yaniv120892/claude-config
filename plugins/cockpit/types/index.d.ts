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

export type ReviewerState = 'requested' | 'approved' | 'changes' | 'commented'

/** Someone on an open PR other than its author: asked for a review, or the last review they left. */
export type BoardReviewer = { name: string; state: ReviewerState }

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
  /** GitHub's verdict over all the checks, the ones past the page the board reads included; null when it has none. */
  checksState: CheckState | null
  /** Unresolved review threads only; an open PR's alone. */
  threads: BoardThread[]
  /** An open PR's alone. */
  reviewers: BoardReviewer[]
  /** A merged PR's alone: what an alert is compared to. */
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

/** GitHub's GraphQL points for the hour, as the board's last read left them. */
export type Quota = {
  limit: number
  remaining: number
  resetAt: number | null
  /** What the board's query cost. */
  cost: number
  /** GitHub refused the read for its rate limit. */
  isExhausted: boolean
}

export type Board = {
  prs: BoardPr[]
  tickets: Ticket[]
  error: string | null
  ticketsError: string | null
  readAt: number
  quota: Quota | null
}

/** The board one session read for every session on the machine, and when the next read is due. */
export type SharedBoard = { board: Board; nextReadAt: number }

/** Which session reads the board now, and until when its claim holds. */
export type BoardLease = { owner: string; until: number }

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

/** What Slack's answers showed of the app's scopes: a reaction or reply that went through, or one refused for a scope. */
export type ScopeVerdict = 'ok' | 'missing'

/** What the setup checklist reads beyond the options, kept in the store for every session. */
export type SetupFacts = {
  /** Per Slack method, whether its last call went through or was refused for a scope. */
  scopes: Record<string, ScopeVerdict>
  /** When the sidecar last forwarded a message from an event channel. */
  lastEventAt: number | null
}

/** One thing the cockpit needs set up: whether it is, and what to do when it is not. */
export type SetupStep = { id: string; label: string; isDone: boolean; todo: string }

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
      /** The row whose ask-for-review field is open, and the reviewer typed in it. */
      askingReviewFor: string | null
      reviewerDraft: string
      setupFacts: Shaped<SetupFacts>
    }
  }
}
