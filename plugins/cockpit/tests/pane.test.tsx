import type { On } from 'claude-code'
import { describe, expect, mock, test } from 'claude-code/testing'
import type { Engine, MockClock } from 'claude-code/testing'

import { boardAnswer, ok, row, thread } from './fixtures'

const NOW = Date.parse('2026-11-01T10:40:00Z')
const PANE = {
  plugin: 'cockpit',
  component: 'Pane',
  requestId: 'cockpit',
  props: { title: 'Cockpit', isFocused: true, bodyColumns: 80, placement: 'dock', scroll: { offset: 0, bodyRows: 40 }, view: {} },
} as const
const SLACK = { options: { slackAppToken: 'xapp-test', slackUserToken: 'xoxp-test', alertChannels: 'prod-alerts' } }
const DEPLOYED = [{ environment: 'production', statuses: [{ state: 'SUCCESS', createdAt: '2026-11-01T10:30:00Z' }] }]

function slash(command: string, args = '') {
  return { command, args, origin: { kind: 'composer' as const }, presentation: { isFullscreen: true, columns: 120 } }
}

/** The /context breakdown, as a summary estimate with auto-compact on. */
function contextBreakdown({ totalTokens, autoCompactThreshold }: { totalTokens: number; autoCompactThreshold: number }) {
  return {
    categories: [],
    totalTokens,
    maxTokens: 400_000,
    rawMaxTokens: 400_000,
    autocompactSource: 'settings' as const,
    percentage: Math.round((totalTokens / 400_000) * 100),
    gridRows: [],
    model: 'claude-opus-5-5',
    memoryFiles: [],
    mcpTools: [],
    agents: [],
    autoCompactThreshold,
    isAutoCompactEnabled: true,
    apiUsage: null,
  }
}

type WorldOptions = { lines?: object[]; slackAnswer?: string; workspace?: string }

/** A session with two open PRs and one deployed ten minutes ago, a sidecar that prints `lines`, in the cmux workspace titled `workspace`. */
function fakeWorld(on: On, { lines = [], slackAnswer = '{"ok":true}', workspace = 'billing' }: WorldOptions = {}) {
  const clock = mock.clock(on, { now: NOW })
  mock.store(on)
  mock.env(on, { HOME: '/home/me', CMUX_WORKSPACE_ID: 'ws-mine' })
  const prompts: string[] = []
  const toasts: string[] = []
  const verdicts: string[] = []
  const spawned: { argv: readonly string[]; env?: Record<string, string> }[] = []
  const slackCalls: { method: string; body: Record<string, unknown>; authorization: string | undefined }[] = []
  on('http.fetch', ($, e) => {
    slackCalls.push({
      method: e.url.replace('https://slack.com/api/', ''),
      body: JSON.parse(String(e.init?.body ?? '{}')),
      authorization: e.init?.headers?.Authorization,
    })
    return { value: { status: 200, ok: true, headers: {}, text: slackAnswer } }
  })
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('command.register', () => ({ value: { command: 'cockpit' } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.toast', ($, e) => {
    toasts.push(e.text)
    return { value: undefined }
  })
  on('ui.notify', () => ({ value: { isSent: false, reason: 'no-surface' as const } }))
  on('command.run', ($, e) => {
    prompts.push(`/${e.command} ${e.args}`.trim())
    return { text: '' }
  })
  on('session.id', () => ({ value: 'session-a' }))
  on('session.usage', () => ({
    value: {
      startedAt: 0,
      context: { window: 200_000, percent: 31.2, breakdown: contextBreakdown({ totalTokens: 62_000, autoCompactThreshold: 160_000 }) },
      rateLimits: [{ kind: 'five_hour', percentUsed: 42, resetsAt: '2026-11-01T12:00:00Z' }],
      cost: { usd: 1.5 },
    },
  }))
  on('mcp.call', ($, e) => {
    const issues =
      e.args.state === 'completed' && e.args.completedAt === '-P1D'
        ? [{ id: 'YAN-2', title: 'Refund flow', url: 'https://linear.app/x/issue/YAN-2', status: 'Done' }]
        : e.args.state === 'started'
          ? [{ id: 'YAN-1', title: 'Charge twice', url: 'https://linear.app/x/issue/YAN-1', status: 'In Progress' }]
          : [{ id: 'YAN-9', title: 'Done a month ago', url: 'https://linear.app/x/issue/YAN-9', status: 'Done' }]
    return { value: { content: [{ type: 'text', text: JSON.stringify({ issues }) }], isError: false } }
  })
  on('process.run', ($, e) => {
    if (e.argv[0] === 'cmux') return ok(workspaceListing(workspace))
    if (e.argv[0] === 'git') return ok('main\n')
    return ok(
      boardAnswer(
        [
          row({ number: 1, threads: [thread({ author: 'reviewer' })], checks: [{ __typename: 'CheckRun', name: 'lint', status: 'COMPLETED', conclusion: 'FAILURE', detailsUrl: 'https://ci/2' }] }),
          row({ number: 4 }),
        ],
        [
          row({ number: 3, state: 'MERGED', mergedAt: '2026-11-01T10:20:00Z', deployments: DEPLOYED }),
          row({ number: 6, state: 'MERGED', mergedAt: '2026-10-29T09:00:00Z', deployments: DEPLOYED }),
        ],
      ),
    )
  })
  on('model.complete', ($, e) => {
    verdicts.push(String(e.prompt))
    return {
    value: {
      isAnswered: true as const,
      text: '{"prUrl": "https://github.com/acme/app/pull/3", "verdict": "likely", "reason": "It changed charge.ts."}',
      usage: { input_tokens: 1, output_tokens: 1, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
    },
  }})
  on('process.spawn', async function* ($, e) {
    spawned.push({ argv: e.argv, env: e.env })
    // Cut mid-line, as a pipe may deliver it.
    const output = lines.map(line => `${JSON.stringify(line)}\n`).join('')
    yield { stream: 'stdout' as const, text: output.slice(0, 25) }
    yield { stream: 'stdout' as const, text: output.slice(25) }
    return { value: { code: 0, signal: null } }
  })
  return { clock, prompts, toasts, spawned, verdicts, slackCalls }
}

const PR_MESSAGE = {
  kind: 'message',
  id: 'C1:1.0',
  threadId: 'C1:0.5',
  channel: '#reviews',
  from: 'Dana',
  text: 'please review https://github.com/acme/web/pull/77',
  permalink: 'https://acme.slack.com/archives/C1/p10',
  at: NOW - 60_000,
  isAlertChannel: false,
}
const ALERT_MESSAGE = {
  kind: 'message',
  id: 'C9:2.0',
  channel: '#prod-alerts',
  from: 'Monitor',
  text: '5xx spike on billing-api',
  permalink: 'https://acme.slack.com/archives/C9/p20',
  at: NOW,
  isAlertChannel: true,
}

function workspaceListing(mine: string): string {
  return JSON.stringify({
    workspaces: [
      { id: 'ws-other', title: 'YAN-4 other work' },
      { id: 'ws-mine', title: mine },
    ],
  })
}

async function start($: Engine, clock: MockClock) {
  await $.session.start({ cwd: '/w', surface: 'terminal', isInteractive: true })
  await clock.advance(1000)
}

describe('the inbox', () => {
  test('a Slack PR message is announced once and offers Claude, Codex and Dismiss', SLACK, async ($, on) => {
    const { clock, prompts, toasts, spawned } = fakeWorld(on, { lines: [{ kind: 'status', state: 'connected', detail: '' }, PR_MESSAGE] })
    await start($, clock)

    expect(spawned[0]?.env?.SLACK_APP_TOKEN).toBe('xapp-test')
    expect(spawned[0]?.env?.COCKPIT_LOCK).toBe('/home/me/.claude/cockpit-slack.lock')
    expect(toasts.filter(text => text.includes('acme/web#77')).length).toBe(1)

    for (const surface of ['terminal', 'desktop'] as const) {
      const pane = await $.ui.mount({ ...PANE, surface })
      const shown = (await pane.findAll({ type: 'Text' })).map(element => element.text).join('|')
      expect(shown).toContain('Dana in #reviews')
      expect(shown).toContain('The Slack sidecar stopped')
      await pane.unmount()
    }

    const pane = await $.ui.mount({ ...PANE, surface: 'terminal' })
    await pane.press({ key: 'codex-https://github.com/acme/web/pull/77' })
    expect(prompts).toEqual(['/pr-workflows:codex-pr-review https://github.com/acme/web/pull/77'])
    expect(await pane.find({ key: 'claude-https://github.com/acme/web/pull/77' })).toBeUndefined()
    await pane.unmount()

    // The poll rebuilds the inbox from the store, as another session's does: the mark must be there.
    await clock.advance(15_000)
    const later = await $.ui.mount({ ...PANE, surface: 'terminal' })
    expect(await later.find({ key: 'claude-https://github.com/acme/web/pull/77' })).toBeUndefined()
    expect(await later.find({ type: 'Text', text: /sent to codex/ })).toBeDefined()
    await later.unmount()

    await clock.advance(30_000)
    expect(spawned.length).toBe(2)
  })

  test('without the tokens no sidecar starts and the pane says how to turn Slack on', async ($, on) => {
    const { clock, spawned } = fakeWorld(on)
    await start($, clock)
    expect(spawned).toEqual([])
    const pane = await $.ui.mount({ ...PANE, surface: 'terminal' })
    expect(await pane.find({ type: 'Text', text: /Slack is off/ })).toBeDefined()
    await pane.unmount()
  })
})

describe('what the inbox leaves out', () => {
  test('a PR of my own that someone links is not offered for review', SLACK, async ($, on) => {
    const mine = { ...PR_MESSAGE, text: 'thoughts on https://github.com/acme/app/pull/4 ?' }
    const { clock, toasts } = fakeWorld(on, { lines: [mine] })
    await start($, clock)
    expect(toasts.filter(text => text.includes('sent'))).toEqual([])
  })

  test('an alert Slack delivers twice is judged once', SLACK, async ($, on) => {
    const { clock, verdicts } = fakeWorld(on, { lines: [ALERT_MESSAGE, ALERT_MESSAGE] })
    await start($, clock)
    expect(verdicts.length).toBe(1)
  })
})

describe('Slack actions', () => {
  test('a message can be reacted to, replied to in the thread it sits in, and opened in Slack', SLACK, async ($, on) => {
    const { clock, slackCalls } = fakeWorld(on, { lines: [{ kind: 'status', state: 'connected', detail: '' }, PR_MESSAGE] })
    await start($, clock)
    const pane = await $.ui.mount({ ...PANE, surface: 'terminal' })
    expect(await pane.find({ type: 'Link', text: /Open in Slack/ })).toBeDefined()

    await pane.press({ key: 'react-eyes-https://github.com/acme/web/pull/77' })
    expect(slackCalls[0]).toEqual({ method: 'reactions.add', body: { channel: 'C1', timestamp: '1.0', name: 'eyes' }, authorization: 'Bearer xoxp-test' })

    await pane.press({ key: 'reply-https://github.com/acme/web/pull/77' })
    await pane.input({ key: 'reply-text-https://github.com/acme/web/pull/77', text: 'On it' })
    expect(slackCalls[1]).toEqual({ method: 'chat.postMessage', body: { channel: 'C1', thread_ts: '0.5', text: 'On it' }, authorization: 'Bearer xoxp-test' })
    expect(await pane.find({ key: 'reply-text-https://github.com/acme/web/pull/77' })).toBeUndefined()
    await pane.unmount()
  })

  test('a missing scope says how to fix the app', SLACK, async ($, on) => {
    const refusal = '{"ok":false,"error":"missing_scope","needed":"reactions:write"}'
    const { clock, toasts } = fakeWorld(on, { lines: [{ kind: 'status', state: 'connected', detail: '' }, PR_MESSAGE], slackAnswer: refusal })
    await start($, clock)
    const pane = await $.ui.mount({ ...PANE, surface: 'terminal' })
    await pane.press({ key: 'react-eyes-https://github.com/acme/web/pull/77' })
    expect(toasts.some(text => text.includes('reactions:write') && text.includes('reinstall'))).toBe(true)
    await pane.unmount()
  })
})

describe('the PR board', () => {
  test('shows my PRs with CI, threads, the ticket and the deploy, and hides a dismissed one', async ($, on) => {
    const { clock, prompts } = fakeWorld(on)
    await start($, clock)
    await $.command.run(slash('cockpit', 'prs'))

    const pane = await $.ui.mount({ ...PANE, surface: 'terminal' })
    const shown = (await pane.findAll({ type: 'Text' })).map(element => element.text).join('|')
    for (const expected of ['YAN-1', 'Charge twice', 'YAN-2', 'Refund flow', '✗1', '1 open', 'in prod 10m']) expect(shown).toContain(expected)
    expect(shown).not.toContain('YAN-9')
    expect(await pane.find({ key: 'expand-https://github.com/acme/app/pull/6' })).toBeUndefined()

    await pane.press({ key: 'expand-https://github.com/acme/app/pull/1' })
    expect(await pane.find({ type: 'Text', text: /reviewer:/ })).toBeDefined()
    await pane.press({ key: 'address-https://github.com/acme/app/pull/1' })
    expect(prompts).toEqual(['/pr-workflows:address-pr-feedback https://github.com/acme/app/pull/1'])

    await pane.press({ key: 'hide-https://github.com/acme/app/pull/4' })
    expect(await pane.find({ key: 'expand-https://github.com/acme/app/pull/4' })).toBeUndefined()
    await pane.press({ key: 'dismissed' })
    expect(await pane.find({ key: 'expand-https://github.com/acme/app/pull/4' })).toBeDefined()
    await pane.unmount()
  })
})

describe('the ticket this workspace works on', () => {
  test('a ticket in the workspace name narrows the PRs to it, and one press shows them all', async ($, on) => {
    const { clock } = fakeWorld(on, { workspace: 'YAN-1 billing' })
    await start($, clock)
    await $.command.run(slash('cockpit', 'prs'))

    const pane = await $.ui.mount({ ...PANE, surface: 'terminal' })
    expect(await pane.find({ type: 'Text', text: /Pull requests · YAN-1/ })).toBeDefined()
    expect(await pane.find({ type: 'Text', text: /From the workspace name/ })).toBeDefined()
    expect(await pane.find({ key: 'expand-https://github.com/acme/app/pull/1' })).toBeDefined()
    expect(await pane.find({ key: 'expand-https://github.com/acme/app/pull/4' })).toBeUndefined()

    await pane.press({ key: 'all-prs' })
    expect(await pane.find({ key: 'expand-https://github.com/acme/app/pull/4' })).toBeDefined()
    await pane.press({ key: 'all-prs' })
    expect(await pane.find({ key: 'expand-https://github.com/acme/app/pull/4' })).toBeUndefined()
    await pane.unmount()
  })

  test('a workspace name with no ticket in it shows every PR', async ($, on) => {
    const { clock } = fakeWorld(on, { workspace: 'cockpit-2' })
    await start($, clock)
    await $.command.run(slash('cockpit', 'prs'))

    const pane = await $.ui.mount({ ...PANE, surface: 'terminal' })
    expect(await pane.find({ key: 'all-prs' })).toBeUndefined()
    expect(await pane.find({ key: 'expand-https://github.com/acme/app/pull/4' })).toBeDefined()
    await pane.unmount()
  })

  test('a ticket expands to its PRs, and an open PR is polished in one press from either list', async ($, on) => {
    const { clock, prompts } = fakeWorld(on)
    await start($, clock)
    await $.command.run(slash('cockpit', 'prs'))

    const pane = await $.ui.mount({ ...PANE, surface: 'terminal' })
    expect(await pane.find({ key: 'ticket-pr-YAN-1-https://github.com/acme/app/pull/1' })).toBeUndefined()
    await pane.press({ key: 'ticket-YAN-1' })
    expect(await pane.find({ key: 'ticket-pr-YAN-1-https://github.com/acme/app/pull/1' })).toBeDefined()
    expect(await pane.find({ key: 'ticket-pr-YAN-1-https://github.com/acme/app/pull/4' })).toBeUndefined()

    await pane.press({ key: 'ticket-polish-YAN-1-https://github.com/acme/app/pull/1' })
    await pane.press({ key: 'polish-https://github.com/acme/app/pull/4' })
    expect(await pane.find({ key: 'polish-https://github.com/acme/app/pull/3' })).toBeUndefined()
    expect(prompts).toEqual([
      '/pr-workflows:pr-polish https://github.com/acme/app/pull/1',
      '/pr-workflows:pr-polish https://github.com/acme/app/pull/4',
    ])
    await pane.unmount()
  })
})

describe('alerts', () => {
  test('an alert that follows my deploy is compared to that PR and announced', SLACK, async ($, on) => {
    const { clock, toasts } = fakeWorld(on, { lines: [ALERT_MESSAGE] })
    await start($, clock)
    await $.command.run(slash('cockpit', 'alerts'))

    expect(toasts.some(text => text.includes('acme/app#3') && text.includes('likely related'))).toBe(true)
    const pane = await $.ui.mount({ ...PANE, surface: 'terminal' })
    const shown = (await pane.findAll({ type: 'Text' })).map(element => element.text).join('|')
    for (const expected of ['LIKELY RELATED', '5xx spike on billing-api', 'It changed charge.ts.', 'Watching acme/app#3']) {
      expect(shown).toContain(expected)
    }
    await pane.unmount()
  })

  test('Investigate runs the investigate-alert skill on the alert, with where it fired and the PR it was compared to', SLACK, async ($, on) => {
    const { clock, prompts } = fakeWorld(on, { lines: [ALERT_MESSAGE] })
    await start($, clock)
    await $.command.run(slash('cockpit', 'alerts'))

    const pane = await $.ui.mount({ ...PANE, surface: 'terminal' })
    await pane.press({ key: 'investigate-C9:2.0' })
    const [investigation = ''] = prompts
    expect(investigation.startsWith('/dev-workflows:investigate-alert channel: #prod-alerts')).toBe(true)
    for (const expected of ['slack: https://acme.slack.com/archives/C9/p20', 'compared PR: https://github.com/acme/app/pull/3', '<slack_alert>\n5xx spike on billing-api\n</slack_alert>']) {
      expect(investigation).toContain(expected)
    }
    await pane.unmount()
  })
})

describe('an alert with no deploy to compare', () => {
  test('still offers Investigate', { options: { ...SLACK.options, alertWindowMinutes: 1 } }, async ($, on) => {
    const { clock, prompts } = fakeWorld(on, { lines: [ALERT_MESSAGE] })
    await start($, clock)
    await $.command.run(slash('cockpit', 'alerts'))

    const pane = await $.ui.mount({ ...PANE, surface: 'terminal' })
    expect(await pane.find({ type: 'Text', text: /no deploy/ })).toBeDefined()
    await pane.press({ key: 'investigate-C9:2.0' })
    expect(prompts[0]).toContain('cockpit verdict: no deploy in its window')
    await pane.unmount()
  })
})

describe('skills, usage and compact', () => {
  test('a pinned skill is one press away', { options: { pinnedSkills: 'simplify' } }, async ($, on) => {
    const { clock, prompts } = fakeWorld(on)
    await start($, clock)
    await $.command.run(slash('cockpit', 'skills'))
    const pane = await $.ui.mount({ ...PANE, surface: 'terminal' })
    await pane.press({ key: 'skill-simplify' })
    expect(prompts).toEqual(['/simplify'])
    await pane.unmount()
  })

  test('every tab shows the usage strip: the limits, the context and the cost', async ($, on) => {
    const { clock } = fakeWorld(on)
    await start($, clock)
    for (const shownTab of ['inbox', 'prs', 'alerts', 'skills']) {
      await $.command.run(slash('cockpit', shownTab))
      const pane = await $.ui.mount({ ...PANE, surface: 'terminal' })
      const shown = (await pane.findAll({ type: 'Text' })).map(element => element.text).join('|')
      for (const expected of ['5h', '42%', '↻1h', 'Ctx', '39%', '⇣98k to compact', '$1.50']) expect(shown).toContain(expected)
      await pane.unmount()
    }
  })

  test('Compact compacts the conversation, and says why when a hook stops it', async ($, on) => {
    const { clock, toasts } = fakeWorld(on)
    let compactions = 0
    on('session.compact', () => {
      compactions += 1
      return { skip: 'a hook kept the history' }
    })
    await start($, clock)
    const pane = await $.ui.mount({ ...PANE, surface: 'terminal' })
    await pane.press({ key: 'compact' })
    expect(compactions).toBe(1)
    expect(toasts).toContain('The compaction was stopped: a hook kept the history')
    await pane.unmount()
  })
})
