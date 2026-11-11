import type { SessionRateLimit } from 'claude-code'

import type { ContextGauge, UsageLimit } from '../types'
import { asRecord } from './store'

const LIMIT_LABELS = [
  ['five_hour', '5h', '5-hour'],
  ['seven_day', 'wk', 'Weekly'],
] as const

export const ALERT_FROM_PERCENT = 90

const MINUTE_MS = 60_000
const HOUR_MINUTES = 60
const DAY_HOURS = 24
const DAY_MINUTES = DAY_HOURS * HOUR_MINUTES

/** The fields of the session's context usage the gauge reads, as `$.session.usage({ breakdown })` returns them. */
type ContextReading = {
  tokens?: number
  percent?: number
  breakdown?: { autoCompactThreshold?: number; isAutoCompactEnabled: boolean }
}

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

/**
 * The context as a share of the auto-compact threshold, so 100% is the moment it compacts.
 *
 * Counts the tokens the last API response was answered over, not the breakdown's
 * `totalTokens`: a summary breakdown estimates locally and can read a fraction of the
 * real window. With auto-compact off, or no threshold known, it is the share of the window.
 */
export function contextGauge({ tokens, percent, breakdown }: ContextReading): ContextGauge | null {
  const compactAt = breakdown?.isAutoCompactEnabled === true ? breakdown.autoCompactThreshold : undefined
  const isAutoCompactOff = breakdown?.isAutoCompactEnabled === false
  const canMeasureToCompact = tokens !== undefined && compactAt !== undefined && compactAt > 0
  if (canMeasureToCompact) {
    return { percent: Math.round((tokens / compactAt) * 100), tokensToCompact: Math.max(0, compactAt - tokens), isAutoCompactOff }
  }
  return percent === undefined ? null : { percent: Math.round(percent), tokensToCompact: null, isAutoCompactOff }
}

export function kiloTokens(tokens: number): string {
  return tokens >= 1000 ? `${Math.round(tokens / 1000)}k` : String(tokens)
}

/** `45m`, `2h14m` or `3d4h` until the reset; null once it has passed or when it cannot be read. */
export function formatResetIn(resetsAt: string, now: number): string | null {
  const minutes = Math.ceil((Date.parse(resetsAt) - now) / MINUTE_MS)
  if (!Number.isFinite(minutes) || minutes <= 0) return null
  if (minutes < HOUR_MINUTES) return `${minutes}m`
  if (minutes < DAY_MINUTES) return `${Math.floor(minutes / HOUR_MINUTES)}h${minutes % HOUR_MINUTES}m`
  return `${Math.floor(minutes / DAY_MINUTES)}d${Math.floor((minutes % DAY_MINUTES) / HOUR_MINUTES)}h`
}

/** `45m`, `2h` or `6d` until the reset, rounded to its largest unit, as the band draws it; null when unknown or passed. */
export function shownReset(limit: UsageLimit, now: number): string | null {
  if (limit.resetsAt === null) return null
  const minutes = Math.round((Date.parse(limit.resetsAt) - now) / MINUTE_MS)
  if (!Number.isFinite(minutes) || minutes <= 0) return null
  if (minutes < HOUR_MINUTES) return `${minutes}m`
  const hours = Math.round(minutes / HOUR_MINUTES)
  return hours < 2 * DAY_HOURS ? `${hours}h` : `${Math.round(hours / DAY_HOURS)}d`
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
  return asRecord<AlertedWindows>(stored)
}

export function alertText(limit: UsageLimit, now: number): string {
  const reset = limit.resetsAt === null ? null : formatResetIn(limit.resetsAt, now)
  return `${limit.name} usage at ${limit.percent}%${reset === null ? '' : `, resets in ${reset}`}`
}

export function formatCost(usd: number): string {
  return `$${usd.toFixed(2)}`
}
