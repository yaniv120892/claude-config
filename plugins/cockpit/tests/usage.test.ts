import { describe, expect, test } from 'claude-code/testing'

import { bar, parsePinned, recordUsage, skillButtons, usageDays, usageLimits } from '../hooks/usage'

describe('the usage history', () => {
  test('a day counts only what each session added since the day before', async () => {
    const limits = usageLimits([
      { kind: 'five_hour', percentUsed: 40.4 },
      { kind: 'seven_day', percentUsed: 12, resetsAt: '2026-11-12T00:00:00Z' },
    ])
    let ledger = recordUsage({}, { day: '2026-11-09', sessionId: 'a', costUsd: 2, limits })
    ledger = recordUsage(ledger, { day: '2026-11-09', sessionId: 'b', costUsd: 1, limits: [] })
    ledger = recordUsage(ledger, { day: '2026-11-10', sessionId: 'a', costUsd: 5, limits: usageLimits([{ kind: 'five_hour', percentUsed: 80 }]) })
    ledger = recordUsage(ledger, { day: '2026-11-10', sessionId: 'a', costUsd: 5.5, limits: usageLimits([{ kind: 'five_hour', percentUsed: 30 }]) })
    expect(usageDays(ledger)).toEqual([
      { day: '2026-11-09', costUsd: 3, fiveHourPeak: 40, weekPeak: 12 },
      { day: '2026-11-10', costUsd: 3.5, fiveHourPeak: 80, weekPeak: 0 },
    ])
  })

  test('keeps the last fourteen days', async () => {
    let ledger = {}
    for (let day = 1; day <= 20; day += 1) {
      ledger = recordUsage(ledger, { day: `2026-10-${String(day).padStart(2, '0')}`, sessionId: 'a', costUsd: day, limits: [] })
    }
    const days = usageDays(ledger)
    expect(days.length).toBe(14)
    expect(days[0]?.day).toBe('2026-10-07')
  })

  test('draws a bar of the asked width', async () => {
    expect(bar(50, 8)).toBe('████░░░░')
    expect(bar(140, 4)).toBe('████')
  })
})

describe('the skill buttons', () => {
  test('pinned prompts lead, then the skills that load most', async () => {
    const pinned = parsePinned('/pr-workflows:pr-polish 12, simplify')
    const buttons = skillButtons(pinned, { simplify: 4, 'code-review': 9, 'dev-workflows:research': 2 })
    expect(buttons.map(button => button.prompt)).toEqual(['pr-workflows:pr-polish 12', 'simplify', 'code-review', 'dev-workflows:research'])
    expect(buttons[1]).toEqual({ prompt: 'simplify', count: 4, isPinned: true })
  })
})
