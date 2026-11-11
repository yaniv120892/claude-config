import type { ContextGauge, SkillButton, UsageLimit } from '../types'

const MAX_SKILL_BUTTONS = 12
const LIMIT_LABELS: Record<string, string> = { five_hour: '5h', seven_day: 'Week', spend_limit: 'Spend' }

type RateLimit = { kind: string; percentUsed: number; resetsAt?: string }

/** The fields of the session's context usage the gauge reads, as `$.session.usage({ breakdown })` returns them. */
type ContextReading = {
  tokens?: number
  percent?: number
  breakdown?: { autoCompactThreshold?: number; isAutoCompactEnabled: boolean }
}

export function usageLimits(rateLimits: readonly RateLimit[]): UsageLimit[] {
  return rateLimits.map(limit => ({
    label: LIMIT_LABELS[limit.kind] ?? limit.kind,
    percent: Math.round(limit.percentUsed),
    resetsAt: limit.resetsAt === undefined ? null : Date.parse(limit.resetsAt),
  }))
}

/**
 * The context as a share of the auto-compact threshold, so 100% is the moment it compacts.
 *
 * Counts the tokens the last API response was answered over, not the breakdown's
 * `totalTokens`: a summary breakdown estimates locally and can read a fraction of the
 * real window. With auto-compact off, or no threshold known, it is the share of the window.
 * Kept identical to its twin in the other plugin, as tests/test_context_gauge_twins.py checks: plugins share no code.
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

function asRecord<T>(stored: unknown): Record<string, T> {
  return typeof stored === 'object' && stored !== null && !Array.isArray(stored) ? { ...stored } : {}
}

export function bar(percent: number, width: number): string {
  const filled = Math.round((Math.min(100, Math.max(0, percent)) / 100) * width)
  return `${'▰'.repeat(filled)}${'▱'.repeat(width - filled)}`
}

const STRIP_CHROME = 4
const GAUGE_TEXT = 18
const COST_TEXT = 9
const MAX_BAR = 8

/** How wide each bar in the usage strip is: what the pane has left once every gauge's text fits, none on a narrow pane. */
export function stripBarWidth({ columns, gauges }: { columns: number; gauges: number }): number {
  if (gauges === 0) return 0
  const spare = columns - STRIP_CHROME - COST_TEXT - gauges * GAUGE_TEXT
  return Math.max(0, Math.min(MAX_BAR, Math.floor(spare / gauges)))
}

export function usageColor(percent: number): 'success' | 'warning' | 'error' {
  if (percent >= 75) return 'error'
  return percent >= 50 ? 'warning' : 'success'
}

export function asCounts(stored: unknown): Record<string, number> {
  return asRecord(stored)
}

export function parsePinned(option: unknown): string[] {
  if (typeof option !== 'string') return []
  return option
    .split(',')
    .map(entry => entry.trim().replace(/^\//, ''))
    .filter(entry => entry !== '')
}

/** The pinned prompts in their order, then the skills that load most. */
export function skillButtons(pinned: readonly string[], counts: Record<string, number>): SkillButton[] {
  const pinnedSkills = new Set(pinned.map(prompt => prompt.split(' ')[0]))
  const frequent = Object.entries(counts)
    .filter(([skill]) => !pinnedSkills.has(skill))
    .sort((a, b) => b[1] - a[1])
    .map(([skill, count]) => ({ prompt: skill, count, isPinned: false }))
  const first = pinned.map(prompt => ({ prompt, count: counts[prompt.split(' ')[0] ?? ''] ?? 0, isPinned: true }))
  return [...first, ...frequent].slice(0, MAX_SKILL_BUTTONS)
}
