import type { SessionRateLimit } from 'claude-code'

import type { UsageLimit } from '../types'

const LIMIT_LABELS = [
  ['five_hour', '5h'],
  ['seven_day', 'wk'],
] as const

export function usageColor(percent: number): string {
  if (percent >= 75) return 'red'
  if (percent >= 50) return 'yellow'
  return 'green'
}

export function usageLimits(rateLimits: readonly SessionRateLimit[]): UsageLimit[] {
  return LIMIT_LABELS.flatMap(([kind, label]) => {
    const limit = rateLimits.find(each => each.kind === kind)
    return limit === undefined ? [] : [{ label, percent: Math.round(limit.percentUsed) }]
  })
}
