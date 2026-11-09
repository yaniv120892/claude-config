import type { InboxItem, Reviewer, SlackLink } from '../types'

export type PullRequestAddress = { url: string; repo: string; number: number }

export type SlackMessage = {
  id: string
  channel: string
  from: string
  text: string
  permalink: string
  at: number
  isAlertChannel: boolean
}

export type SidecarLine =
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

/** Every distinct GitHub PR the text links to, in order. */
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
  return Array.isArray(stored) ? stored.filter(item => typeof item?.prUrl === 'string') : []
}

/**
 * The inbox with the message's PRs on top. A PR already waiting keeps its row, moved up;
 * one already reviewed or dismissed comes back only when it is posted again later.
 */
export function addToInbox(inbox: readonly InboxItem[], message: SlackMessage): { inbox: InboxItem[]; added: InboxItem[] } {
  const added: InboxItem[] = []
  let next = [...inbox]
  for (const address of pullRequestsIn(message.text)) {
    const known = next.find(item => item.prUrl === address.url)
    if (known !== undefined && known.at >= message.at) continue
    const item: InboxItem = {
      prUrl: address.url,
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
    if (known === undefined || known.handledBy !== null) added.push(item)
  }
  return { inbox: next.slice(0, MAX_INBOX), added }
}

export function markHandled(inbox: readonly InboxItem[], prUrl: string, handledBy: InboxItem['handledBy']): InboxItem[] {
  return inbox.map(item => (item.prUrl === prUrl ? { ...item, handledBy } : item))
}

export function waiting(inbox: readonly InboxItem[]): InboxItem[] {
  return inbox.filter(item => item.handledBy === null)
}
