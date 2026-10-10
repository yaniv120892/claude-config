import { describe, expect, test } from 'claude-code/testing'

import {
  alertText,
  formatCost,
  formatResetIn,
  markAlerted,
  notAlertedYet,
  pastAlertLine,
  shownReset,
  usageColor,
  usageLimits,
} from '../hooks/usage'

const NOW = Date.parse('2026-10-05T09:00:00.000Z')
const IN_72_MINUTES = '2026-10-05T10:12:00.000Z'

describe('usageColor', () => {
  test('matches the old statusline thresholds', () => {
    expect(usageColor(49)).toBe('green')
    expect(usageColor(50)).toBe('yellow')
    expect(usageColor(74)).toBe('yellow')
    expect(usageColor(75)).toBe('red')
  })
})

describe('usageLimits', () => {
  test('shows the 5-hour window before the weekly one, rounded, with its reset', () => {
    const limits = usageLimits([
      { kind: 'seven_day', percentUsed: 41.5, resetsAt: '2026-10-12T00:00:00Z' },
      { kind: 'five_hour', percentUsed: 23.4 },
    ])
    expect(limits).toEqual([
      { label: '5h', name: '5-hour', percent: 23, resetsAt: null },
      { label: 'wk', name: 'Weekly', percent: 42, resetsAt: '2026-10-12T00:00:00Z' },
    ])
  })

  test('leaves out a spend limit and a window with no reading', () => {
    expect(usageLimits([{ kind: 'spend_limit', percentUsed: 80 }, { kind: 'seven_day', percentUsed: 7 }])).toEqual([
      { label: 'wk', name: 'Weekly', percent: 7, resetsAt: null },
    ])
    expect(usageLimits([])).toEqual([])
  })
})

describe('reset times', () => {
  test('read as minutes, hours and minutes, or days and hours', () => {
    expect(formatResetIn('2026-10-05T09:45:00.000Z', NOW)).toBe('45m')
    expect(formatResetIn(IN_72_MINUTES, NOW)).toBe('1h12m')
    expect(formatResetIn('2026-10-08T13:30:00.000Z', NOW)).toBe('3d4h')
  })

  test('are absent once passed or unreadable', () => {
    expect(formatResetIn('2026-10-05T08:59:00.000Z', NOW)).toBe(null)
    expect(formatResetIn('soon', NOW)).toBe(null)
  })

  test('show only from 75%', () => {
    const limit = { label: '5h', name: '5-hour', percent: 74, resetsAt: IN_72_MINUTES }
    expect(shownReset(limit, NOW)).toBe(null)
    expect(shownReset({ ...limit, percent: 75 }, NOW)).toBe('1h12m')
    expect(shownReset({ ...limit, percent: 99, resetsAt: null }, NOW)).toBe(null)
  })
})

describe('alerts', () => {
  const fiveHour = { label: '5h', name: '5-hour', percent: 92, resetsAt: IN_72_MINUTES }
  const weekly = { label: 'wk', name: 'Weekly', percent: 89, resetsAt: null }

  test('fire from 90%, once per window', () => {
    expect(pastAlertLine([fiveHour, weekly])).toEqual([fiveHour])
    const alerted = markAlerted({}, [fiveHour])
    expect(notAlertedYet([fiveHour], alerted)).toEqual([])
    expect(notAlertedYet([{ ...fiveHour, resetsAt: '2026-10-05T15:00:00.000Z' }], alerted)).toHaveLength(1)
  })

  test('say the window, the percent and the reset', () => {
    expect(alertText(fiveHour, NOW)).toBe('5-hour usage at 92%, resets in 1h12m')
    expect(alertText({ ...weekly, percent: 95 }, NOW)).toBe('Weekly usage at 95%')
  })
})

test('formatCost reads in dollars and cents', () => {
  expect(formatCost(1.237)).toBe('$1.24')
  expect(formatCost(0)).toBe('$0.00')
})
