// The sidecar's pure parts, kept apart from the socket so `node --test` covers them.

const CHANNEL_ID = /^[CGD][A-Z0-9]{8,}$/
// A plain message has no subtype; every other subtype is an edit, a deletion or channel housekeeping.
const MESSAGE_SUBTYPES = new Set([undefined, 'bot_message', 'file_share', 'thread_broadcast'])

export function parseChannels(option) {
  const entries = String(option ?? '')
    .split(',')
    .map(entry => entry.trim().replace(/^#/, ''))
    .filter(entry => entry !== '')
  return {
    ids: entries.filter(entry => CHANNEL_ID.test(entry)),
    names: entries.filter(entry => !CHANNEL_ID.test(entry)).map(name => name.toLowerCase()),
  }
}

function blockText(block) {
  if (block === null || typeof block !== 'object') return []
  const own = typeof block.text === 'string' ? [block.text] : blockText(block.text)
  const url = typeof block.url === 'string' ? [block.url] : []
  const nested = [...(block.elements ?? []), ...(block.fields ?? [])].flatMap(blockText)
  return [...own, ...url, ...nested]
}

/**
 * All the text a message shows: a monitoring bot puts the alert in attachments
 * or blocks, often beside a one-line `text`. A `rich_text` block is the
 * composer's copy of `text`, so it is read only when there is no text.
 */
export function flattenMessage(event) {
  const hasText = typeof event.text === 'string' && event.text.trim() !== ''
  const parts = [
    event.text,
    ...(event.attachments ?? []).flatMap(attachment => [
      attachment.pretext,
      attachment.title,
      attachment.title_link,
      attachment.text,
      attachment.fallback,
      ...(attachment.fields ?? []).map(field => `${field.title}: ${field.value}`),
      ...(attachment.blocks ?? []).flatMap(blockText),
    ]),
    ...(event.blocks ?? []).filter(block => !hasText || block?.type !== 'rich_text').flatMap(blockText),
  ]
  const seen = new Set()
  return parts
    .filter(part => typeof part === 'string' && part.trim() !== '')
    .filter(part => !seen.has(part) && seen.add(part))
    .join('\n')
    // Slack wraps a link as <url|label>.
    .replace(/<(https?:\/\/[^|>]+)(\|[^>]*)?>/g, '$1')
}

export function mentionsPullRequest(text) {
  return /https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/pull\/\d+/.test(text)
}

export function permalinkOf(workspaceUrl, channel, ts) {
  return `${workspaceUrl.replace(/\/$/, '')}/archives/${channel}/p${ts.replace('.', '')}`
}

/**
 * What the mod is told of an event, or null for one it has no use for. In an
 * alert channel that is each top-level message someone else posted: a reply in
 * an alert's thread is discussion, not a new alert. Elsewhere it is a PR link
 * a person posted: a bot's "PR opened" notice is not a request to review.
 */
export function relevantMessage({ event, selfUserId, alertChannelIds }) {
  if (event?.type !== 'message' || !MESSAGE_SUBTYPES.has(event.subtype)) return null
  if (typeof event.channel !== 'string' || typeof event.ts !== 'string') return null
  if (event.user === selfUserId) return null
  const text = flattenMessage(event)
  const isAlertChannel = alertChannelIds.has(event.channel)
  const isTopLevel = event.thread_ts === undefined || event.thread_ts === event.ts
  const isFromPerson = typeof event.user === 'string' && event.bot_id === undefined && event.subtype !== 'bot_message'
  const isRelevant = isAlertChannel ? isTopLevel : isFromPerson && mentionsPullRequest(text)
  if (!isRelevant) return null
  return { channel: event.channel, user: event.user ?? null, botName: event.username ?? null, ts: event.ts, text, isAlertChannel }
}

/** Whether the lock's holder is gone: its file names no process, or one that is not a sidecar (a reused pid). */
export function isLockStale({ holder, commandOf }) {
  if (!Number.isInteger(holder) || holder <= 0) return true
  return !String(commandOf(holder) ?? '').includes('slack-socket')
}

/** Reconnect waits: 1 s, doubling to 30 s. */
export function backoffMs(attempt) {
  return Math.min(30_000, 1000 * 2 ** Math.min(attempt, 5))
}
