import { describe, expect, test } from 'claude-code/testing'

import { usageLimits } from '../hooks/usage'

describe('usageLimits', () => {
  test('shows the 5-hour window before the weekly one, rounded', () => {
    const limits = usageLimits([
      { kind: 'seven_day', percentUsed: 41.5, resetsAt: '2026-10-12T00:00:00Z' },
      { kind: 'five_hour', percentUsed: 23.4 },
    ])
    expect(limits).toEqual([
      { label: '5h', percent: 23 },
      { label: 'wk', percent: 42 },
    ])
  })

  test('leaves out a spend limit and a window with no reading', () => {
    expect(usageLimits([{ kind: 'spend_limit', percentUsed: 80 }, { kind: 'seven_day', percentUsed: 7 }])).toEqual([
      { label: 'wk', percent: 7 },
    ])
    expect(usageLimits([])).toEqual([])
  })
})
