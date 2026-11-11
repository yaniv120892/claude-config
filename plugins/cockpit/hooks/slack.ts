import type { InboxItem, Reviewer, SlackLink } from '../types'

type PullRequestAddress = { url: string; repo: string; number: number }

export type SlackMessage = {
  id: string
  threadId: string
  channel: string
  from: string
  text: string
  permalink: string
  at: number
  isAlertChannel: boolean
}

type SidecarLine =
  | { kind: 'status'; link: SlackLink }
  | { kind: 'message'; message: SlackMessage }

const PULL_REQUEST = /https:\/\/github\.com\/([\w.-]+\/[\w.-]+)\/pull\/(\d+)/g
const MAX_INBOX = 50
const EXCERPT_LENGTH = 140
const LINK_STATES: readonly string[] = ['off', 'starting', 'standby', 'connected', 'error'] satisfies SlackLink['state'][]

export const REVIEW_SKILL = {
  claude: '/pr-workflows:pr-review',
  codex: '/pr-workflows:codex-pr-review',
} as const satisfies Record<Reviewer, string>

export function pullRequestsIn(text: string): PullRequestAddress[] {
  const found = new Map<string, PullRequestAddress>()
  for (const [, repo, number] of text.matchAll(PULL_REQUEST)) {
    if (repo === undefined || number === undefined) continue
    const url = `https://github.com/${repo}/pull/${number}`
    if (!found.has(url)) found.set(url, { url, repo, number: Number(number) })
  }
  return [...found.values()]
}

/** A child's output arrives in pieces that need not end on a line: the whole lines, and what is left over. */
export function takeLines(buffered: string): { lines: string[]; rest: string } {
  const parts = buffered.split('\n')
  const rest = parts.pop() ?? ''
  return { lines: parts.filter(line => line.trim() !== ''), rest }
}

function isLinkState(state: unknown): state is SlackLink['state'] {
  return typeof state === 'string' && LINK_STATES.includes(state)
}

function text(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

/** One line the sidecar printed, or null for anything else it wrote. */
export function parseSidecarLine(line: string): SidecarLine | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(line)
  } catch {
    return null
  }
  if (typeof parsed !== 'object' || parsed === null) return null
  const fields: Record<string, unknown> = { ...parsed }
  if (fields.kind === 'status' && isLinkState(fields.state)) {
    return { kind: 'status', link: { state: fields.state, detail: text(fields.detail) } }
  }
  if (fields.kind === 'message' && typeof fields.id === 'string' && typeof fields.at === 'number') {
    return {
      kind: 'message',
      message: {
        id: fields.id,
        threadId: typeof fields.threadId === 'string' ? fields.threadId : fields.id,
        channel: text(fields.channel),
        from: text(fields.from),
        text: text(fields.text),
        permalink: text(fields.permalink),
        at: fields.at,
        isAlertChannel: fields.isAlertChannel === true,
      },
    }
  }
  return null
}

export function excerptOf(body: string): string {
  const line = body.replace(/\s+/g, ' ').trim()
  return line.length > EXCERPT_LENGTH ? `${line.slice(0, EXCERPT_LENGTH - 1)}…` : line
}

export function asInbox(stored: unknown): InboxItem[] {
  if (!Array.isArray(stored)) return []
  return stored
    .filter(item => typeof item?.prUrl === 'string')
    .map(item => {
      const messageId = typeof item.messageId === 'string' ? item.messageId : ''
      return { ...item, messageId, threadId: typeof item.threadId === 'string' ? item.threadId : messageId }
    })
}

export const QUICK_REACTIONS = [
  { name: 'eyes', glyph: '👀' },
  { name: 'white_check_mark', glyph: '✅' },
  { name: '+1', glyph: '👍' },
] as const

/** Where a Slack message lives, from its `<channel id>:<ts>` id; null for an id that names none. */
export function slackAddress(messageId: string): { channel: string; ts: string } | null {
  const [channel = '', ts = ''] = messageId.split(':')
  const isAddress = channel !== '' && /^\d+\.\d+$/.test(ts)
  return isAddress ? { channel, ts } : null
}

/** What a Slack Web API answer says went wrong, in words the person can act on; null when it went through. */
export function slackRefusal({ status, text }: { status: number; text: string }): string | null {
  let answer: { ok?: unknown; error?: unknown; needed?: unknown } = {}
  try {
    answer = JSON.parse(text)
  } catch {
    return status === 429 ? 'Slack is rate limiting; try again in a minute' : `Slack answered ${status} with no JSON`
  }
  // A reaction already there is the outcome asked for.
  const isDone = answer.ok === true || answer.error === 'already_reacted'
  if (isDone) return null
  if (answer.error === 'missing_scope') {
    return `the Slack app lacks the ${String(answer.needed ?? 'needed')} scope: update it from the manifest and reinstall it`
  }
  return `Slack said ${String(answer.error ?? status)}`
}

/** Who handled each PR, and the Slack time of the message they handled; kept apart from the inbox so a new message never undoes a dismissal. */
export type HandledMarks = Record<string, { by: Reviewer | 'dismissed'; at: number }>

type InboxAddition = {
  inbox: readonly InboxItem[]
  message: SlackMessage
  marks: HandledMarks
  ownPrUrls: ReadonlySet<string>
}

const MAX_MARKS = 200

function isHandled(marks: HandledMarks, prUrl: string, postedAt: number): boolean {
  const mark = marks[prUrl]
  return mark !== undefined && mark.at >= postedAt
}

/**
 * The inbox with the message's PRs on top, my own PRs left out. A PR already waiting keeps
 * its row, moved up; one already reviewed or dismissed comes back only when it is posted again after that.
 */
export function addToInbox({ inbox, message, marks, ownPrUrls }: InboxAddition): { inbox: InboxItem[]; added: InboxItem[] } {
  const added: InboxItem[] = []
  let next = [...inbox]
  for (const address of pullRequestsIn(message.text)) {
    if (ownPrUrls.has(address.url)) continue
    const known = next.find(item => item.prUrl === address.url)
    if (known !== undefined && known.at >= message.at) continue
    const item: InboxItem = {
      prUrl: address.url,
      messageId: message.id,
      threadId: message.threadId,
      repo: address.repo,
      number: address.number,
      from: message.from,
      channel: message.channel,
      permalink: message.permalink,
      excerpt: excerptOf(message.text),
      at: message.at,
      handledBy: null,
    }
    next = [item, ...next.filter(other => other.prUrl !== address.url)]
    const wasWaiting = known !== undefined && !isHandled(marks, known.prUrl, known.at)
    if (!wasWaiting && !isHandled(marks, item.prUrl, item.at)) added.push(item)
  }
  return { inbox: applyMarks(next.slice(0, MAX_INBOX), marks), added }
}

export function asMarks(stored: unknown): HandledMarks {
  return typeof stored === 'object' && stored !== null && !Array.isArray(stored) ? { ...stored } : {}
}

export function markHandled(marks: HandledMarks, mark: { prUrl: string; by: Reviewer | 'dismissed'; at: number }): HandledMarks {
  const newest = Object.entries({ ...marks, [mark.prUrl]: { by: mark.by, at: mark.at } })
    .sort((a, b) => b[1].at - a[1].at)
    .slice(0, MAX_MARKS)
  return Object.fromEntries(newest)
}

/** Each item as handled or waiting: a mark stands until the PR is posted again after it. */
export function applyMarks(inbox: readonly InboxItem[], marks: HandledMarks): InboxItem[] {
  return inbox.map(item => ({ ...item, handledBy: isHandled(marks, item.prUrl, item.at) ? (marks[item.prUrl]?.by ?? null) : null }))
}

export function waiting(inbox: readonly InboxItem[]): InboxItem[] {
  return inbox.filter(item => item.handledBy === null)
}
