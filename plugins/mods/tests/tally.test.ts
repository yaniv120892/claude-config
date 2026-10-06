import { describe, expect, mock, test } from 'claude-code/testing'

import { slash } from './slash'

import { asTally, countSkill, formatTally } from '../hooks/tally'

describe('the tally', () => {
  test('counts a skill and keeps when it last loaded', () => {
    const once = countSkill({}, 'pr-workflows:creating-prs', '2026-10-01T09:00:00.000Z')
    const twice = countSkill(once, 'pr-workflows:creating-prs', '2026-10-05T09:00:00.000Z')
    expect(twice['pr-workflows:creating-prs']).toEqual({ count: 2, lastUsed: '2026-10-05T09:00:00.000Z' })
  })

  test('reads anything that is not a tally as empty', () => {
    expect(asTally(undefined)).toEqual({})
    expect(asTally([1, 2])).toEqual({})
  })

  test('reports the most used first, then the skills that never loaded', () => {
    const report = formatTally(
      {
        'dev-workflows:ship': { count: 1, lastUsed: '2026-10-01T00:00:00.000Z' },
        'pr-workflows:pr-review': { count: 5, lastUsed: '2026-10-04T00:00:00.000Z' },
      },
      ['dev-workflows:ship', 'pr-workflows:pr-review', 'cmux:topology'],
    )
    const rows = report.split('\n')
    expect(rows[2]).toBe('| `pr-workflows:pr-review` | 5 | 2026-10-04 |')
    expect(rows[3]).toBe('| `dev-workflows:ship` | 1 | 2026-10-01 |')
    expect(report).toContain('**Never loaded (1):** `cmux:topology`')
  })

  test('counts skills as they load, and /skill-tally reports them', async ($, on) => {
    mock.clock(on, { now: Date.parse('2026-10-05T09:00:00.000Z') })
    mock.store(on)
    on('skill.prompt', ($, e) => ({ text: e.text }))
    on('command.list', () => ({
      value: [
        { name: 'pr-workflows:finalize-pr', description: '', source: 'plugin', plugin: 'pr-workflows' },
        { name: 'cmux:topology', description: '', source: 'plugin', plugin: 'cmux' },
        { name: 'compact', description: '', source: 'builtin' },
      ],
    }))
    await $.skill.prompt({ skill: 'pr-workflows:finalize-pr', text: 'Finalize the PR.' })
    await $.skill.prompt({ skill: 'pr-workflows:finalize-pr', text: 'Finalize the PR.' })
    const report = await $.command.run(slash('skill-tally'))
    expect(report.text).toContain('| `pr-workflows:finalize-pr` | 2 | 2026-10-05 |')
    expect(report.text).toContain('**Never loaded (1):** `cmux:topology`')

    await $.command.run(slash('skill-tally', 'reset'))
    expect((await $.command.run(slash('skill-tally'))).text).toContain('_none yet_')
  })
})
