// The sidecar's pure parts, kept apart from the socket so `node --test` covers them.

const CHANNEL_ID = /^[CGD][A-Z0-9]{8,}$/
const IGNORED_SUBTYPES = new Set(['message_changed', 'message_deleted', 'channel_join', 'channel_leave'])

/** Splits the alert-channel option into channel ids and names still to resolve. */
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
 * or blocks and leaves `text` empty, and an unfurled link sits in neither.
 */
export function flattenMessage(event) {
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
    ...(event.blocks ?? []).flatMap(blockText),
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
 * What the mod is told of an event, or null for one it has no use for:
 * every message of an alert channel, and elsewhere a PR link someone else posted.
 */
export function relevantMessage({ event, selfUserId, alertChannelIds }) {
  if (event?.type !== 'message' || IGNORED_SUBTYPES.has(event.subtype)) return null
  if (typeof event.channel !== 'string' || typeof event.ts !== 'string') return null
  const text = flattenMessage(event)
  const isAlertChannel = alertChannelIds.has(event.channel)
  const isOthersPullRequest = event.user !== selfUserId && mentionsPullRequest(text)
  if (!isAlertChannel && !isOthersPullRequest) return null
  return { channel: event.channel, user: event.user ?? null, botName: event.username ?? null, ts: event.ts, text, isAlertChannel }
}

/** Reconnect waits: 1 s, doubling to 30 s. */
export function backoffMs(attempt) {
  return Math.min(30_000, 1000 * 2 ** Math.min(attempt, 5))
}
