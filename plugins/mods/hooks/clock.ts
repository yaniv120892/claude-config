export const LAST_ACTIVE_KEY_PREFIX = 'lastActive:'
// Shorter tool calls are normal and would only add noise to the context.
export const SLOW_TOOL_MS = 10_000
// Shorter pauses are the person reading or typing, not time away.
export const AWAY_MS = 30 * 60_000
export const LAST_ACTIVE_TTL_MS = 30 * 24 * 60 * 60_000

const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

/** `47s`, `3m 12s`, `2h 5m`, `1d 4h`: the two largest units. */
export function formatDuration(ms: number): string {
  const seconds = Math.round(ms / 1000)
  if (seconds < 60) return `${seconds}s`
  const units: [number, string][] = [
    [Math.floor(ms / DAY), 'd'],
    [Math.floor((ms % DAY) / HOUR), 'h'],
    [Math.floor((ms % HOUR) / MINUTE), 'm'],
    [Math.floor((ms % MINUTE) / 1000), 's'],
  ]
  const first = units.findIndex(([value]) => value > 0)
  return units
    .slice(first, first + 2)
    .filter(([value]) => value > 0)
    .map(([value, unit]) => `${value}${unit}`)
    .join(' ')
}

/** `Wed 2026-10-21 14:03 UTC+3`, in the zone `offsetMinutes` east of UTC. */
export function formatLocalTime(now: number, offsetMinutes: number): string {
  const local = new Date(now + offsetMinutes * MINUTE)
  const pad = (value: number) => String(value).padStart(2, '0')
  const date = `${local.getUTCFullYear()}-${pad(local.getUTCMonth() + 1)}-${pad(local.getUTCDate())}`
  const time = `${pad(local.getUTCHours())}:${pad(local.getUTCMinutes())}`
  const sign = offsetMinutes < 0 ? '-' : '+'
  const hours = Math.floor(Math.abs(offsetMinutes) / 60)
  const minutes = Math.abs(offsetMinutes) % 60
  const zone = `UTC${sign}${hours}${minutes > 0 ? `:${pad(minutes)}` : ''}`
  return `${WEEKDAYS[local.getUTCDay()]} ${date} ${time} ${zone}`
}

/** What a prompt carries: the time now, and how long the session sat idle when that is long enough to matter. */
export function promptClock(now: number, offsetMinutes: number, lastActive: number | null): string {
  const time = `Current local time: ${formatLocalTime(now, offsetMinutes)}.`
  if (lastActive === null || now - lastActive < AWAY_MS) return time
  return (
    `${time} This session was idle for ${formatDuration(now - lastActive)} before this prompt: ` +
    'branches, PRs, deploys and other state you saw earlier may have changed, so re-check before acting on them.'
  )
}

export function slowToolNote(tool: string, durationMs: number | undefined): string | null {
  if (durationMs === undefined || durationMs < SLOW_TOOL_MS) return null
  return `${tool} took ${formatDuration(durationMs)} to run.`
}

/** `+0300` → 180, `-0430` → -270; null for anything else. */
export function parseUtcOffset(text: string): number | null {
  const match = /^([+-])(\d{2})(\d{2})$/.exec(text.trim())
  if (match === null) return null
  const minutes = Number(match[2]) * 60 + Number(match[3])
  return match[1] === '-' ? -minutes : minutes
}
