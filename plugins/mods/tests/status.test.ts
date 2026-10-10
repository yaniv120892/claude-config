import type { On, RenderElement } from 'claude-code'
import { describe, expect, mock, test } from 'claude-code/testing'

import { fail, ok, PR_VIEW, THREADS } from './fixtures'
import { slash } from './slash'

/** A worktree `mods` of the repo `claude-config`, dirty; the commands gh ran. */
function fakeRepo(on: On, options: { hasPr: boolean }) {
  const clock = mock.clock(on, { now: Date.parse('2026-10-05T09:00:00.000Z') })
  const ghCalls: string[] = []
  on('session.cwd', () => ({ value: '/w/claude-config/.worktrees/mods' }))
  on('session.repo', () => ({ value: { root: '/w/claude-config', remote: null, internal: false, name: null } }))
  on('session.model', () => ({ value: 'claude-opus-5-5' }))
  const usage = {
    startedAt: 0,
    context: { window: 200_000, percent: 62.4 },
    rateLimits: [
      { kind: 'five_hour', percentUsed: 23.4 },
      { kind: 'seven_day', percentUsed: 81 },
    ],
    cost: { usd: 0 },
  }
  on('session.usage', () => ({ value: usage }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('process.run', ($, e) => {
    const command = e.argv.filter(arg => arg !== '--no-optional-locks').join(' ')
    if (command.startsWith('git branch')) return ok('feat/mods\n')
    if (command.startsWith('git status')) return ok(' M install.sh\n')
    if (command.startsWith('gh ')) ghCalls.push(command.split(' ').slice(0, 3).join(' '))
    if (command.startsWith('gh pr view')) {
      return options.hasPr ? ok(JSON.stringify(PR_VIEW)) : fail('no pull requests found for branch "feat/mods"')
    }
    if (command.startsWith('gh api graphql')) return ok(THREADS)
    return fail('unexpected')
  })
  on('tool.call', { tool: 'Bash' }, () => ({ result: { stdout: '', stderr: '', interrupted: false } }))
  return { clock, ghCalls, usage }
}

const BAND_PROPS = {
  hasSurvey: false,
  isWorking: false,
  maxRows: 10,
  bodyColumns: 120,
  scroll: { offset: 0, bodyRows: 10 },
  view: {},
}
const PANE_PROPS = {
  title: 'Pull request',
  isFocused: true,
  bodyColumns: 60,
  placement: 'dock' as const,
  scroll: { offset: 0, bodyRows: 40 },
  view: {},
}

describe('the status band', () => {
  test('draws the old statusline and the PR row', async ($, on) => {
    const { clock } = fakeRepo(on, { hasPr: true })
    await $.tool.call({ tool: 'Bash', command: 'git status' })
    await clock.advance(1000)
    await $.command.run(slash('pr'))

    for (const surface of ['terminal', 'desktop'] as const) {
      const band = await $.ui.mount({ plugin: 'mods', surface, component: 'AbovePrompt', props: BAND_PROPS })
      const text = (await band.findAll({ type: 'Text' })).map(element => element.text).join('|')
      for (const shown of ['claude-config/mods', 'feat/mods', '✗', '[claude-opus-5-5]', 'ctx:62%', '5h:23%', 'wk:81%', '#51', '2 open threads', 'conflicts', 'changes requested']) {
        expect(text).toContain(shown)
      }
      await band.unmount()
    }
  })

  test('rereads the PR after a push, and not after a read', async ($, on) => {
    const { clock, ghCalls } = fakeRepo(on, { hasPr: true })
    on('tool.call', { tool: 'AskUserQuestion' }, ($, e) => ({
      result: { questions: e.questions, answers: { [e.questions[0]?.question ?? '']: 'Allow once' } },
    }))
    await $.tool.call({ tool: 'Bash', command: 'gh pr view 51 --json title' })
    await clock.advance(1000)
    expect(ghCalls).toEqual([])

    await $.tool.call({ tool: 'Bash', command: 'git push' })
    await clock.advance(1000)
    expect(ghCalls).toEqual(['gh pr view', 'gh api graphql'])
  })

  test('redraws the usage limits when a window moves between turns', async ($, on) => {
    const { clock, usage } = fakeRepo(on, { hasPr: false })
    on('session.measure', ($, e) => ({ changed: e.changed }))
    await $.tool.call({ tool: 'Bash', command: 'git status' })
    await clock.advance(1000)

    usage.rateLimits = [{ kind: 'five_hour', percentUsed: 57 }]
    await $.session.measure({ context: usage.context, rateLimits: usage.rateLimits, changed: ['rateLimits'] })
    await clock.advance(1000)

    const band = await $.ui.mount({ plugin: 'mods', surface: 'terminal', component: 'AbovePrompt', props: BAND_PROPS })
    const text = (await band.findAll({ type: 'Text' })).map(element => element.text).join('|')
    expect(text).toContain('5h:57%')
    expect(text).not.toContain('wk:')
    await band.unmount()
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
})

describe('the /pr pane', () => {
  test('lists failing checks first and the open threads', async ($, on) => {
    fakeRepo(on, { hasPr: true })
    const ran = await $.command.run(slash('pr'))
    expect(ran.text).toContain('#51')

    const pane = await $.ui.mount({ plugin: 'mods', surface: 'desktop', component: 'Pane', requestId: 'mods-pr', props: PANE_PROPS })
    const lines = (await pane.findAll({ type: 'Text' })).map(element => element.text)
    const lint = lines.findIndex(line => line.includes('lint'))
    const tests = lines.findIndex(line => line.includes('tests'))
    expect(lint).toBeGreaterThan(-1)
    expect(lint).toBeLessThan(tests)
    expect(lines.join('|')).toContain('hooks/register.tsx:12')
    expect(await pane.find({ key: 'address' })).toBeDefined()
    await pane.unmount()
  })

  test('says so when the branch has no PR', async ($, on) => {
    fakeRepo(on, { hasPr: false })
    const ran = await $.command.run(slash('pr'))
    expect(ran.text).toBe('No PR for this branch yet.')

    const pane = await $.ui.mount({ plugin: 'mods', surface: 'terminal', component: 'Pane', requestId: 'mods-pr', props: PANE_PROPS })
    expect(await pane.find({ type: 'Text', text: 'No PR for this branch.' })).toBeDefined()
    await pane.unmount()
  })
})
