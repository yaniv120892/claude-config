import type { SkillButton, UsageLimit } from '../types'

const MAX_SKILL_BUTTONS = 12
const LIMIT_LABELS: Record<string, string> = { five_hour: '5h', seven_day: 'Week', spend_limit: 'Spend' }

type RateLimit = { kind: string; percentUsed: number; resetsAt?: string }

export function usageLimits(rateLimits: readonly RateLimit[]): UsageLimit[] {
  return rateLimits.map(limit => ({
    label: LIMIT_LABELS[limit.kind] ?? limit.kind,
    percent: Math.round(limit.percentUsed),
    resetsAt: limit.resetsAt === undefined ? null : Date.parse(limit.resetsAt),
  }))
}

function asRecord<T>(stored: unknown): Record<string, T> {
  return typeof stored === 'object' && stored !== null && !Array.isArray(stored) ? { ...stored } : {}
}

export function bar(percent: number, width: number): string {
  const filled = Math.round((Math.min(100, Math.max(0, percent)) / 100) * width)
  return `${'▰'.repeat(filled)}${'▱'.repeat(width - filled)}`
}

/** How wide each bar in the usage strip is: none on a narrow pane, so the numbers stay. */
export function stripBarWidth(columns: number): number {
  return Math.max(0, Math.min(8, Math.floor((columns - 56) / 4)))
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
