import type { On, RenderElement } from 'claude-code'
import { describe, expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

import { fail, ok, PR_VIEW, THREADS } from './fixtures'
import { slash } from './slash'

/** A worktree `mods` of the repo `claude-config`, dirty; the commands gh ran. */
function fakeRepo(on: On, options: { hasPr: boolean }) {
  const clock = mock.clock(on, { now: Date.parse('2026-10-05T09:00:00.000Z') })
  const ghCalls: string[] = []
  const gitCalls: string[] = []
  on('session.cwd', () => ({ value: '/w/claude-config/.worktrees/mods' }))
  on('session.repo', () => ({ value: { root: '/w/claude-config', remote: 'git@github.com:owner/claude-config.git', internal: false, name: null } }))
  on('session.model', () => ({ value: 'claude-opus-5-5' }))
  const usage = {
    startedAt: 0,
    context: { window: 200_000, percent: 62.4 },
    rateLimits: [
      { kind: 'five_hour', percentUsed: 23.4 },
      { kind: 'seven_day', percentUsed: 81, resetsAt: '2026-10-08T13:30:00.000Z' },
    ],
    cost: { usd: 0 },
  }
  on('session.usage', () => ({ value: usage }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  const pr: { byUrl: Record<string, object>; list: string[] } = { byUrl: {}, list: [] }
  const bash = { stdout: '' }
  const toasts: string[] = []
  on('ui.toast', ($, e) => {
    toasts.push(e.text)
    return { value: undefined }
  })
  on('process.run', ($, e) => {
    const command = e.argv.filter(arg => arg !== '--no-optional-locks').join(' ')
    if (command.startsWith('git ')) gitCalls.push(command)
    if (command.startsWith('git branch')) return ok('feat/mods\n')
    if (command.startsWith('git status')) return ok(' M install.sh\n')
    if (command.startsWith('gh ')) ghCalls.push(command.split(' ').slice(0, 3).join(' '))
    const viewed = /^gh pr view (\S+)/.exec(command)?.[1]
    if (viewed !== undefined && viewed !== '--json') {
      const view = pr.byUrl[viewed]
      return view === undefined ? fail('not found') : ok(JSON.stringify(view))
    }
    if (command.startsWith('gh pr list')) return ok(JSON.stringify(pr.list.map(url => ({ url }))))
    if (command.startsWith('gh pr view')) {
      return options.hasPr ? ok(JSON.stringify(PR_VIEW)) : fail('no pull requests found for branch "feat/mods"')
    }
    if (command.startsWith('gh api graphql')) return ok(THREADS)
    return fail('unexpected')
  })
  on('tool.call', { tool: 'Bash' }, () => ({ result: { stdout: bash.stdout, stderr: '', interrupted: false } }))
  return { clock, ghCalls, gitCalls, usage, pr, toasts, bash }
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

/** The band's PR rows, each as one line. */
async function prRows($: Engine): Promise<string[]> {
  const band = await $.ui.mount({ plugin: 'mods', surface: 'terminal', component: 'AbovePrompt', props: BAND_PROPS })
  const rows = (await band.findAll({ type: 'Text' })).map(element => element.text).filter(text => text.startsWith('PR #'))
  await band.unmount()
  return rows
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
      for (const shown of ['claude-config/mods', 'feat/mods', '✗', '[claude-opus-5-5]', 'ctx:62%', '5h:23%', 'wk:81%', '↻3d4h', '#51', 'changes requested', '2 open', '1 replied', '1 resolved', 'conflicts']) {
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
    expect([...ghCalls].sort()).toEqual(['gh api graphql', 'gh pr list', 'gh pr view'])
  })

  test('patches the usage limits when a window moves mid-turn, without rereading git', async ($, on) => {
    const { clock, gitCalls, usage } = fakeRepo(on, { hasPr: false })
    on('session.measure', ($, e) => ({ changed: e.changed }))
    await $.tool.call({ tool: 'Bash', command: 'git status' })
    await clock.advance(1000)
    gitCalls.length = 0

    const moved = [{ kind: 'five_hour', percentUsed: 57 }]
    await $.session.measure({ context: usage.context, rateLimits: [{ kind: 'five_hour', percentUsed: 90 }], changed: ['context'] })
    await $.session.measure({ context: usage.context, rateLimits: moved, changed: ['rateLimits'] })
    await clock.advance(1000)

    const band = await $.ui.mount({ plugin: 'mods', surface: 'terminal', component: 'AbovePrompt', props: BAND_PROPS })
    const text = (await band.findAll({ type: 'Text' })).map(element => element.text).join('|')
    expect(text).toContain('5h:57%')
    expect(text).not.toContain('wk:')
    expect(gitCalls).toEqual([])
    await band.unmount()
  })

  test('ignores a measurement where only the context moved', async ($, on) => {
    const { clock, usage } = fakeRepo(on, { hasPr: false })
    on('session.measure', ($, e) => ({ changed: e.changed }))
    await $.tool.call({ tool: 'Bash', command: 'git status' })
    await clock.advance(1000)

    await $.session.measure({ context: usage.context, rateLimits: [{ kind: 'five_hour', percentUsed: 90 }], changed: ['context'] })
    await clock.advance(1000)

    const band = await $.ui.mount({ plugin: 'mods', surface: 'terminal', component: 'AbovePrompt', props: BAND_PROPS })
    const text = (await band.findAll({ type: 'Text' })).map(element => element.text).join('|')
    expect(text).toContain('5h:23%')
    await band.unmount()
  })

  test('draws the session cost in place of the limits off a subscription', async ($, on) => {
    const { clock, usage } = fakeRepo(on, { hasPr: false })
    usage.rateLimits = []
    usage.cost = { usd: 1.237 }
    await $.tool.call({ tool: 'Bash', command: 'git status' })
    await clock.advance(1000)

    const band = await $.ui.mount({ plugin: 'mods', surface: 'terminal', component: 'AbovePrompt', props: BAND_PROPS })
    const text = (await band.findAll({ type: 'Text' })).map(element => element.text).join('|')
    expect(text).toContain('$1.24')
    expect(text).not.toContain('5h:')
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

describe('the alerts', () => {
  const nearCap = (resetsAt: string) => [{ kind: 'five_hour', percentUsed: 92, resetsAt }]

  test('toast a limit past 90% once per window', async ($, on) => {
    const { usage, toasts } = fakeRepo(on, { hasPr: false })
    mock.store(on)
    on('session.measure', ($, e) => ({ changed: e.changed }))

    await $.session.measure({ context: usage.context, rateLimits: nearCap('2026-10-05T10:12:00.000Z'), changed: ['rateLimits'] })
    await $.session.measure({ context: usage.context, rateLimits: nearCap('2026-10-05T10:12:00.000Z'), changed: ['rateLimits'] })
    expect(toasts).toEqual(['5-hour usage at 92%, resets in 1h12m'])

    await $.session.measure({ context: usage.context, rateLimits: nearCap('2026-10-05T15:00:00.000Z'), changed: ['rateLimits'] })
    expect(toasts).toHaveLength(2)
  })

  test('stay off when switched off', { options: { alerts: false } }, async ($, on) => {
    const { usage, toasts } = fakeRepo(on, { hasPr: false })
    mock.store(on)
    on('session.measure', ($, e) => ({ changed: e.changed }))
    await $.session.measure({ context: usage.context, rateLimits: nearCap('2026-10-05T10:12:00.000Z'), changed: ['rateLimits'] })
    expect(toasts).toEqual([])
  })
})

describe('the session PRs', () => {
  const NO_GATE = { options: { gitGate: false } }
  const URL_57 = 'https://github.com/owner/claude-config/pull/57'
  const URL_58 = 'https://github.com/owner/claude-config/pull/58'
  const view = (number: number, url: string, fields: object) => ({
    ...PR_VIEW,
    number,
    url,
    title: `PR ${number}`,
    mergeable: 'MERGEABLE',
    statusCheckRollup: [{ __typename: 'CheckRun', name: 'tests', status: 'COMPLETED', conclusion: 'SUCCESS' }],
    ...fields,
  })

  test('adds the PR a gh pr create printed, even on a branch with no PR', NO_GATE, async ($, on) => {
    const { clock, pr, bash } = fakeRepo(on, { hasPr: false })
    pr.byUrl[URL_57] = view(57, URL_57, { reviewDecision: 'REVIEW_REQUIRED', mergeStateStatus: 'BLOCKED' })
    bash.stdout = `${URL_57}\n`
    await $.tool.call({ tool: 'Bash', command: 'gh pr create --fill' })
    await clock.advance(1000)

    const rows = await prRows($)
    expect(rows.find(row => row.startsWith('PR #57'))).toMatch(/^PR #57 awaiting review ✓1 · .* · PR 57$/)

    const band = await $.ui.mount({ plugin: 'mods', surface: 'terminal', component: 'AbovePrompt', props: BAND_PROPS })
    const links = (await band.findAll({ type: 'Link' })).map(element => element.props.href)
    expect(links).toEqual([URL_57])
    await band.unmount()
  })

  test('finds PRs opened elsewhere this session, and says which is ready to merge', NO_GATE, async ($, on) => {
    const { clock, pr } = fakeRepo(on, { hasPr: true })
    pr.list = [URL_58, URL_57]
    pr.byUrl[URL_57] = view(57, URL_57, { reviewDecision: 'APPROVED', mergeStateStatus: 'CLEAN' })
    pr.byUrl[URL_58] = view(58, URL_58, { isDraft: true, mergeStateStatus: 'DRAFT' })
    await $.tool.call({ tool: 'Bash', command: 'git status' })
    await clock.advance(1000)
    await $.command.run(slash('pr'))

    const rows = await prRows($)
    expect(rows.map(row => row.split(' · ')[0])).toEqual(['PR #51 changes requested ✗1 …2 ✓1', 'PR #58 draft ✓1', 'PR #57 approved ✓1'])
    expect(rows[2]).toContain('ready to merge')
    expect(rows[1]).not.toContain('ready to merge')
  })

  test('stops rereading a session PR once it is merged', NO_GATE, async ($, on) => {
    const { clock, pr, ghCalls } = fakeRepo(on, { hasPr: false })
    pr.list = [URL_57]
    pr.byUrl[URL_57] = view(57, URL_57, { state: 'MERGED' })
    await $.tool.call({ tool: 'Bash', command: 'git status' })
    await clock.advance(1000)
    await $.command.run(slash('pr'))
    expect((await prRows($)).some(row => row.startsWith('PR #57 merged'))).toBe(true)

    ghCalls.length = 0
    await $.command.run(slash('pr'))
    expect(ghCalls).toEqual(['gh pr view', 'gh pr list'])
  })

  test('reads the branch PR once when it was also opened this session', NO_GATE, async ($, on) => {
    const { clock, pr, ghCalls } = fakeRepo(on, { hasPr: true })
    pr.list = [PR_VIEW.url]
    pr.byUrl[PR_VIEW.url] = PR_VIEW
    await $.tool.call({ tool: 'Bash', command: 'git status' })
    await clock.advance(1000)
    await $.command.run(slash('pr'))

    ghCalls.length = 0
    await $.command.run(slash('pr'))
    expect([...ghCalls].sort()).toEqual(['gh api graphql', 'gh pr list', 'gh pr view'])
    expect((await prRows($)).filter(row => row.startsWith('PR #51'))).toHaveLength(1)
  })
})

describe('the PR skill checklist', () => {
  /** On the branch of PR #51, the store empty unless `stored` fills it. */
  const setup = async ($: Engine, on: On, stored?: Record<string, unknown>) => {
    const repo = fakeRepo(on, { hasPr: true })
    mock.store(on, stored)
    on('skill.prompt', ($, e) => ({ text: e.text }))
    on('tool.call', { tool: 'Skill' }, ($, e) => ({ result: { success: true, commandName: e.skill } }))
    on('command.run', () => ({ text: '' }))
    repo.pr.byUrl['51'] = { url: PR_VIEW.url }
    await $.tool.call({ tool: 'Bash', command: 'git status' })
    return repo
  }
  const row51 = async ($: Engine) => (await prRows($)).find(row => row.startsWith('PR #51'))

  test('ticks a skill run on the PR branch on its row and in /pr', async ($, on) => {
    const { clock } = await setup($, on)
    await $.skill.prompt({ skill: 'simplify', text: 'Simplify.' })
    await $.skill.prompt({ skill: 'pr-workflows:pr-second-review', text: 'Recheck.' })
    await clock.advance(1000)
    await $.command.run(slash('pr'))
    expect(await row51($)).toContain('✓simplify ○code-review ○pr-review ○prune')

    const pane = await $.ui.mount({ plugin: 'mods', surface: 'terminal', component: 'Pane', requestId: 'mods-pr', props: PANE_PROPS })
    const lines = (await pane.findAll({ type: 'Text' })).map(element => element.text).join('|')
    expect(lines).toContain('✓ simplify ran 2026-10-05')
    expect(lines).toContain('○ pr-review not run')
    await pane.unmount()
  })

  test('counts a run for the PR its arguments name, not the branch it ran on', async ($, on) => {
    const { clock } = await setup($, on)
    await $.skill.prompt({ skill: 'pr-workflows:pr-review', text: 'Review.\n\nARGUMENTS: 51' })
    await $.skill.prompt({ skill: 'simplify', text: 'Simplify.\n\nARGUMENTS: owner/claude-config#57' })
    await clock.advance(1000)
    await $.command.run(slash('pr'))
    expect(await row51($)).toContain('○simplify ○code-review ✓pr-review ○prune')
  })

  test('reads the arguments from the Skill call or the slash command, where the skill text has none', async ($, on) => {
    const { clock, pr } = await setup($, on)
    pr.byUrl['57'] = { url: 'https://github.com/owner/claude-config/pull/57' }
    await $.tool.call({ tool: 'Skill', skill: 'code-review', args: 'high 57 --comment' })
    await $.skill.prompt({ skill: 'code-review', text: 'Review target: `high 57 --comment`' })
    await $.command.run(slash('prune-comments', '57'))
    await $.skill.prompt({ skill: 'dev-workflows:prune-comments', text: 'Prune.' })
    await $.skill.prompt({ skill: 'simplify', text: 'Simplify.' })
    await clock.advance(1000)
    await $.command.run(slash('pr'))
    // Both named #57, so the branch's own #51 gets only the run that named nothing.
    expect(await row51($)).toContain('✓simplify ○code-review ○pr-review ○prune')
  })

  test('shows the runs an earlier session stored', async ($, on) => {
    on('command.register', ($, e) => ({ value: { command: e.name } }))
    on('session.start', ($, e) => ({ cwd: e.cwd }))
    const { clock } = await setup($, on, { prSkillRuns: { '/w/claude-config@feat/mods': { 'prune-comments': '2026-10-04T09:00:00.000Z' } } })
    await $.session.start({ cwd: '/w/claude-config/.worktrees/mods', surface: 'terminal', isInteractive: true })
    await clock.advance(1000)
    expect(await row51($)).toContain('○simplify ○code-review ○pr-review ✓prune')
  })

  test('stays off the band when switched off', { options: { prSkills: false } }, async ($, on) => {
    const { clock } = await setup($, on)
    await $.skill.prompt({ skill: 'simplify', text: 'Simplify.' })
    await clock.advance(1000)
    await $.command.run(slash('pr'))
    expect(await row51($)).not.toContain('simplify')
  })
})
