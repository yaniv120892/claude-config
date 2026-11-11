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
  test('measures against the auto-compact threshold, so 100% is when it compacts', async () => {
    expect(contextGauge({ percent: 30, tokens: 300_000, compactAt: 400_000 })).toEqual({ percent: 75, tokensToCompact: 100_000 })
    expect(kiloTokens(100_000)).toBe('100k')
  })

  test('falls back to the window when auto-compact is off', async () => {
    expect(contextGauge({ percent: 31.2, tokens: 62_000, compactAt: undefined })).toEqual({ percent: 31, tokensToCompact: null })
    expect(contextGauge({ percent: undefined, tokens: undefined, compactAt: undefined })).toBe(null)
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
