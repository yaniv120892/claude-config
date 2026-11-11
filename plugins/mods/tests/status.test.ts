import type { On, RenderElement } from 'claude-code'
import { describe, expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

import { fail, ok } from './fixtures'

const NEAR_CAP_RESET = '2026-10-05T10:12:00.000Z'

/** A dirty worktree `mods` of the repo `claude-config`, on a subscription well into its limits. */
function fakeRepo(on: On) {
  const clock = mock.clock(on, { now: Date.parse('2026-10-05T09:00:00.000Z') })
  on('session.cwd', () => ({ value: '/w/claude-config/.worktrees/mods' }))
  on('session.repo', () => ({ value: { root: '/w/claude-config', remote: 'git@github.com:owner/claude-config.git', internal: false, name: null } }))
  on('session.model', () => ({ value: 'claude-opus-5-5' }))
  const context = { window: 1_000_000, tokens: 300_000, percent: 30 }
  const usageReads: unknown[] = []
  on('session.usage', ($, e) => {
    usageReads.push(e)
    return {
      value: {
        startedAt: 0,
        context,
        rateLimits: [
          { kind: 'five_hour', percentUsed: 23.4, resetsAt: '2026-10-05T11:00:00.000Z' },
          { kind: 'seven_day', percentUsed: 81, resetsAt: '2026-10-08T13:30:00.000Z' },
        ],
        cost: { usd: 1.237 },
      },
    }
  })
  const toasts: string[] = []
  on('ui.toast', ($, e) => {
    toasts.push(e.text)
    return { value: undefined }
  })
  on('process.run', ($, e) => {
    const command = e.argv.filter(arg => arg !== '--no-optional-locks').join(' ')
    if (command.startsWith('git branch')) return ok('feat/mods\n')
    if (command.startsWith('git status')) return ok(' M install.sh\n')
    return fail('unexpected')
  })
  on('tool.call', { tool: 'Bash' }, () => ({ result: { stdout: '', stderr: '', interrupted: false } }))
  on('session.measure', ($, e) => ({ changed: e.changed }))
  return { clock, context, usageReads, toasts }
}

const BAND_PROPS = {
  hasSurvey: false,
  isWorking: false,
  maxRows: 10,
  bodyColumns: 120,
  scroll: { offset: 0, bodyRows: 10 },
  view: {},
}

async function bandText($: Engine, surface: 'terminal' | 'desktop' = 'terminal'): Promise<string> {
  const band = await $.ui.mount({ plugin: 'mods', surface, component: 'AbovePrompt', props: BAND_PROPS })
  const text = (await band.findAll({ type: 'Text' })).map(element => element.text).join('|')
  await band.unmount()
  return text
}

describe('the status band', () => {
  test('draws the location, branch and model', async ($, on) => {
    const { clock } = fakeRepo(on)
    await $.tool.call({ tool: 'Bash', command: 'git status' })
    await clock.advance(1000)

    for (const surface of ['terminal', 'desktop'] as const) {
      const text = await bandText($, surface)
      for (const shown of ['claude-config/mods', 'feat/mods', '✗', '[claude-opus-5-5]']) {
        expect(text).toContain(shown)
      }
    }
  })

  test('shows no usage figures and never reads usage, which lives in the cockpit', async ($, on) => {
    const { clock, context, usageReads } = fakeRepo(on)
    await $.tool.call({ tool: 'Bash', command: 'git status' })
    await clock.advance(1000)
    await $.session.measure({ context, rateLimits: [{ kind: 'five_hour', percentUsed: 57 }], changed: ['rateLimits'] })
    await clock.advance(1000)

    const text = await bandText($)
    expect(text).toContain('[claude-opus-5-5]')
    for (const usage of ['ctx', '%', '5h', 'wk', '↻', '⇣', '$']) {
      expect(text).not.toContain(usage)
    }
    expect(usageReads).toEqual([])
  })

  test('leaves the band to the engine before it has read the repository', async ($, on) => {
    on('ui.render', { component: 'AbovePrompt' }, ($, e) => {
      const { Text } = $.ui.resolve(e)
      return h(Text, {}, 'engine band') as RenderElement
    })
    const band = await $.ui.mount({ plugin: 'mods', surface: 'terminal', component: 'AbovePrompt', props: BAND_PROPS })
    expect(await band.find({ type: 'Text', text: /➜/ })).toBeUndefined()
    expect(await band.find({ type: 'Text', text: 'engine band' })).toBeDefined()
    await band.unmount()
  })

  test('registers no /pr command: the cockpit has the PRs', async ($, on) => {
    const registered: string[] = []
    on('command.register', ($, e) => {
      registered.push(e.name)
      return { value: { command: e.name } }
    })
    on('session.start', ($, e) => ({ cwd: e.cwd }))
    fakeRepo(on)
    await $.session.start({ cwd: '/w/claude-config/.worktrees/mods', surface: 'terminal', isInteractive: true })
    expect(registered).toEqual(['skill-tally'])
  })
})

describe('the alerts', () => {
  const nearCap = (resetsAt: string) => [{ kind: 'five_hour', percentUsed: 92, resetsAt }]

  test('toast a limit past 90% once per window', async ($, on) => {
    const { context, toasts } = fakeRepo(on)
    mock.store(on)

    await $.session.measure({ context, rateLimits: nearCap(NEAR_CAP_RESET), changed: ['rateLimits'] })
    await $.session.measure({ context, rateLimits: nearCap(NEAR_CAP_RESET), changed: ['rateLimits'] })
    expect(toasts).toEqual(['5-hour usage at 92%, resets in 1h12m'])

    await $.session.measure({ context, rateLimits: nearCap('2026-10-05T15:00:00.000Z'), changed: ['rateLimits'] })
    expect(toasts).toHaveLength(2)
  })

  test('toast with the band switched off', { options: { statusBand: false } }, async ($, on) => {
    const { context, toasts } = fakeRepo(on)
    mock.store(on)
    await $.session.measure({ context, rateLimits: nearCap(NEAR_CAP_RESET), changed: ['rateLimits'] })
    expect(toasts).toEqual(['5-hour usage at 92%, resets in 1h12m'])
  })

  test('ignore a measurement where only the context moved', async ($, on) => {
    const { context, toasts } = fakeRepo(on)
    mock.store(on)
    await $.session.measure({ context, rateLimits: nearCap(NEAR_CAP_RESET), changed: ['context'] })
    expect(toasts).toEqual([])
  })

  test('stay off when switched off', { options: { alerts: false } }, async ($, on) => {
    const { context, toasts } = fakeRepo(on)
    mock.store(on)
    await $.session.measure({ context, rateLimits: nearCap(NEAR_CAP_RESET), changed: ['rateLimits'] })
    expect(toasts).toEqual([])
  })
})
