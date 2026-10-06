import type { On, RenderElement } from 'claude-code'
import { describe, expect, mock, test } from 'claude-code/testing'

import { slash } from './slash'

const VIEW = JSON.stringify({
  number: 51,
  title: 'feat(mods): add the mods plugin',
  url: 'https://github.com/owner/claude-config/pull/51',
  state: 'OPEN',
  isDraft: false,
  mergeable: 'CONFLICTING',
  reviewDecision: 'CHANGES_REQUESTED',
  statusCheckRollup: [
    { __typename: 'CheckRun', name: 'tests', status: 'COMPLETED', conclusion: 'SUCCESS' },
    { __typename: 'CheckRun', name: 'lint', status: 'COMPLETED', conclusion: 'FAILURE' },
  ],
})
const THREADS = JSON.stringify({
  data: {
    repository: {
      pullRequest: {
        reviewThreads: {
          nodes: [
            {
              isResolved: false,
              path: 'install.sh',
              line: 40,
              comments: { nodes: [{ author: { login: 'reviewer' }, body: 'Drop this link.', url: 'u' }] },
            },
          ],
        },
      },
    },
  },
})

const ok = (stdout: string) => ({
  value: { exitCode: 0, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false },
})

/** A worktree `mods` of the repo `claude-config`, dirty, with an open PR. */
function fakeRepo(on: On, options: { hasPr: boolean }): void {
  mock.clock(on, { now: Date.parse('2026-10-05T09:00:00.000Z') })
  on('session.cwd', () => ({ value: '/w/claude-config/.worktrees/mods' }))
  on('session.model', () => ({ value: 'claude-opus-5-5' }))
  on('session.usage', () => ({
    value: { startedAt: 0, context: { window: 200_000, percent: 62.4 }, rateLimits: [], cost: { usd: 0 } },
  }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('process.run', ($, e) => {
    const command = e.argv.join(' ')
    if (command.startsWith('git rev-parse')) return ok('/w/claude-config/.git\n')
    if (command.startsWith('git branch')) return ok('feat/mods\n')
    if (command.startsWith('git status')) return ok(' M install.sh\n')
    if (command.startsWith('gh pr view')) {
      return options.hasPr
        ? ok(VIEW)
        : { value: { exitCode: 1, stdout: '', stderr: 'no pull requests found for branch "feat/mods"', isStdoutTruncated: false, isStderrTruncated: false } }
    }
    if (command.startsWith('gh api graphql')) return ok(THREADS)
    return { value: { exitCode: 1, stdout: '', stderr: 'unexpected', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  on('tool.call', { tool: 'Bash' }, () => ({ result: { stdout: '', stderr: '', interrupted: false } }))
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
    fakeRepo(on, { hasPr: true })
    await $.tool.call({ tool: 'Bash', command: 'git status' })
    await $.command.run(slash('pr'))

    for (const surface of ['terminal', 'desktop'] as const) {
      const band = await $.ui.mount({ plugin: 'mods', surface, component: 'AbovePrompt', props: BAND_PROPS })
      const text = (await band.findAll({ type: 'Text' })).map(element => element.text).join('|')
      expect(text).toContain('claude-config/mods')
      expect(text).toContain('feat/mods')
      expect(text).toContain('✗')
      expect(text).toContain('[claude-opus-5-5]')
      expect(text).toContain('ctx:62%')
      expect(text).toContain('#51')
      expect(text).toContain('1 open thread')
      expect(text).toContain('conflicts')
      expect(text).toContain('changes requested')
      await band.unmount()
    }
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
    expect(lines.join('|')).toContain('install.sh:40')
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
