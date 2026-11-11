import type { SkillButton, UsageDay, UsageLimit } from '../types'

const KEPT_DAYS = 14
const MAX_SKILL_BUTTONS = 12
const LIMIT_LABELS: Record<string, string> = { five_hour: '5-hour', seven_day: 'Weekly', spend_limit: 'Spend' }

type RateLimit = { kind: string; percentUsed: number; resetsAt?: string }

/** One day's readings: each session's running cost, and the highest each limit stood at. */
type LedgerDay = { sessions: Record<string, number>; fiveHourPeak: number; weekPeak: number }

type UsageLedger = Record<string, LedgerDay>

type UsageReading = { day: string; sessionId: string; costUsd: number | null; limits: readonly UsageLimit[] }

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

export function asLedger(stored: unknown): UsageLedger {
  return asRecord(stored)
}

function peak(limits: readonly UsageLimit[], label: string, last: number): number {
  return Math.max(last, limits.find(limit => limit.label === label)?.percent ?? 0)
}

export function recordUsage(ledger: UsageLedger, reading: UsageReading): UsageLedger {
  const last = ledger[reading.day] ?? { sessions: {}, fiveHourPeak: 0, weekPeak: 0 }
  const sessions = reading.costUsd === null ? last.sessions : { ...last.sessions, [reading.sessionId]: reading.costUsd }
  const day: LedgerDay = {
    sessions,
    fiveHourPeak: peak(reading.limits, LIMIT_LABELS.five_hour ?? '', last.fiveHourPeak),
    weekPeak: peak(reading.limits, LIMIT_LABELS.seven_day ?? '', last.weekPeak),
  }
  const kept = Object.entries({ ...ledger, [reading.day]: day })
    .sort(([a], [b]) => a.localeCompare(b))
    .slice(-KEPT_DAYS)
  return Object.fromEntries(kept)
}

/**
 * Each day's cost, oldest first. A session's cost runs on across days, so a day counts
 * only what the session added since the day before.
 */
export function usageDays(ledger: UsageLedger): UsageDay[] {
  const spentBefore: Record<string, number> = {}
  return Object.entries(ledger)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([day, { sessions, fiveHourPeak, weekPeak }]) => {
      let costUsd = 0
      for (const [sessionId, total] of Object.entries(sessions)) {
        costUsd += Math.max(0, total - (spentBefore[sessionId] ?? 0))
        spentBefore[sessionId] = Math.max(total, spentBefore[sessionId] ?? 0)
      }
      return { day, costUsd, fiveHourPeak, weekPeak }
    })
}

export function bar(percent: number, width: number): string {
  const filled = Math.round((Math.min(100, Math.max(0, percent)) / 100) * width)
  return `${'█'.repeat(filled)}${'░'.repeat(width - filled)}`
}

export function usageColor(percent: number): 'green' | 'yellow' | 'red' {
  if (percent >= 75) return 'red'
  return percent >= 50 ? 'yellow' : 'green'
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
