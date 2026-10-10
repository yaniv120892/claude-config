import type { SessionRateLimit } from 'claude-code'

import type { UsageLimit } from '../types'

const LIMIT_LABELS = [
  ['five_hour', '5h', '5-hour'],
  ['seven_day', 'wk', 'Weekly'],
] as const

export const RESET_SHOWN_FROM_PERCENT = 75
export const ALERT_FROM_PERCENT = 90

const MINUTE_MS = 60_000
const HOUR_MINUTES = 60
const DAY_MINUTES = 24 * HOUR_MINUTES

/** Which windows were already toasted: each label and the reset of the window it was toasted in. */
export type AlertedWindows = Record<string, string>

export function usageColor(percent: number): string {
  if (percent >= 75) return 'red'
  if (percent >= 50) return 'yellow'
  return 'green'
}

export function usageLimits(rateLimits: readonly SessionRateLimit[]): UsageLimit[] {
  return LIMIT_LABELS.flatMap(([kind, label, name]) => {
    const limit = rateLimits.find(each => each.kind === kind)
    if (limit === undefined) return []
    return [{ label, name, percent: Math.round(limit.percentUsed), resetsAt: limit.resetsAt ?? null }]
  })
}

/** `45m`, `2h14m` or `3d4h` until the reset; null once it has passed or when it cannot be read. */
export function formatResetIn(resetsAt: string, now: number): string | null {
  const minutes = Math.ceil((Date.parse(resetsAt) - now) / MINUTE_MS)
  if (!Number.isFinite(minutes) || minutes <= 0) return null
  if (minutes < HOUR_MINUTES) return `${minutes}m`
  if (minutes < DAY_MINUTES) return `${Math.floor(minutes / HOUR_MINUTES)}h${minutes % HOUR_MINUTES}m`
  return `${Math.floor(minutes / DAY_MINUTES)}d${Math.floor((minutes % DAY_MINUTES) / HOUR_MINUTES)}h`
}

export function shownReset(limit: UsageLimit, now: number): string | null {
  const isNearCap = limit.percent >= RESET_SHOWN_FROM_PERCENT
  return isNearCap && limit.resetsAt !== null ? formatResetIn(limit.resetsAt, now) : null
}

export function pastAlertLine(limits: readonly UsageLimit[]): UsageLimit[] {
  return limits.filter(limit => limit.percent >= ALERT_FROM_PERCENT)
}

export function notAlertedYet(limits: readonly UsageLimit[], alerted: AlertedWindows): UsageLimit[] {
  return limits.filter(limit => alerted[limit.label] !== (limit.resetsAt ?? ''))
}

export function markAlerted(alerted: AlertedWindows, limits: readonly UsageLimit[]): AlertedWindows {
  return { ...alerted, ...Object.fromEntries(limits.map(limit => [limit.label, limit.resetsAt ?? ''])) }
}

export function asAlertedWindows(stored: unknown): AlertedWindows {
  return stored !== null && typeof stored === 'object' && !Array.isArray(stored) ? (stored as AlertedWindows) : {}
}

export function alertText(limit: UsageLimit, now: number): string {
  const reset = limit.resetsAt === null ? null : formatResetIn(limit.resetsAt, now)
  return `${limit.name} usage at ${limit.percent}%${reset === null ? '' : `, resets in ${reset}`}`
}

export function formatCost(usd: number): string {
  return `$${usd.toFixed(2)}`
}
