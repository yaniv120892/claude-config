import { describe, expect, test } from 'claude-code/testing'

import { bar, contextGauge, kiloTokens, parsePinned, skillButtons, stripBarWidth, usageLimits } from '../hooks/usage'

describe('the usage strip', () => {
  test('labels each limit briefly', async () => {
    const limits = usageLimits([
      { kind: 'five_hour', percentUsed: 40.4 },
      { kind: 'seven_day', percentUsed: 12, resetsAt: '2026-11-12T00:00:00Z' },
    ])
    expect(limits).toEqual([
      { label: '5h', percent: 40, resetsAt: null },
      { label: 'Week', percent: 12, resetsAt: Date.parse('2026-11-12T00:00:00Z') },
    ])
  })

  test('draws a bar of the asked width', async () => {
    expect(bar(50, 8)).toBe('▰▰▰▰▱▱▱▱')
    expect(bar(140, 4)).toBe('▰▰▰▰')
  })

  test('drops the bars on a narrow pane, caps them on a wide one, and shrinks them as gauges are added', async () => {
    expect(stripBarWidth({ columns: 50, gauges: 3 })).toBe(0)
    expect(stripBarWidth({ columns: 80, gauges: 3 })).toBe(4)
    expect(stripBarWidth({ columns: 80, gauges: 4 })).toBe(0)
    expect(stripBarWidth({ columns: 200, gauges: 3 })).toBe(8)
  })
})

describe('the context gauge', () => {
  const threshold = { autoCompactThreshold: 367_000, isAutoCompactEnabled: true }

  test("counts the last response's tokens against the auto-compact threshold, so 100% is when it compacts", async () => {
    expect(contextGauge({ tokens: 300_000, percent: 30, breakdown: threshold })).toEqual({ percent: 82, tokensToCompact: 67_000, isAutoCompactOff: false })
    expect(kiloTokens(67_000)).toBe('67k')
  })

  test('never reads the summary estimate, which can count a fraction of the window', async () => {
    const estimated = { ...threshold, totalTokens: 77_000 }
    expect(contextGauge({ tokens: 300_000, percent: 30, breakdown: estimated })?.percent).toBe(82)
    expect(contextGauge({ percent: undefined, breakdown: estimated })).toBe(null)
  })

  test('falls back to the share of the window when auto-compact is off or its threshold is unknown', async () => {
    expect(contextGauge({ tokens: 62_000, percent: 31.2, breakdown: { ...threshold, isAutoCompactEnabled: false } })).toEqual({ percent: 31, tokensToCompact: null, isAutoCompactOff: true })
    expect(contextGauge({ tokens: 62_000, percent: 31.2 })).toEqual({ percent: 31, tokensToCompact: null, isAutoCompactOff: false })
    expect(contextGauge({})).toBe(null)
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
