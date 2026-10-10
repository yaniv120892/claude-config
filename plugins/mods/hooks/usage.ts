import type { SessionRateLimit } from 'claude-code'

import type { UsageLimit } from '../types'

const LIMIT_LABELS: Record<string, string> = { five_hour: '5h', seven_day: 'wk' }

export function usageColor(percent: number): string {
  if (percent >= 75) return 'red'
  if (percent >= 50) return 'yellow'
  return 'green'
}

/** The 5-hour and weekly windows, in that order; others, such as a gateway's spend limit, are left out. */
export function usageLimits(rateLimits: readonly SessionRateLimit[]): UsageLimit[] {
  return Object.entries(LIMIT_LABELS).flatMap(([kind, label]) => {
    const limit = rateLimits.find(each => each.kind === kind)
    return limit === undefined ? [] : [{ label, percent: Math.round(limit.percentUsed) }]
  })
}
