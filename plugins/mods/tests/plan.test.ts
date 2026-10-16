import type { On } from 'claude-code'
import { describe, expect, mock, test } from 'claude-code/testing'
import type { Engine, MockClock } from 'claude-code/testing'

import { freshTasks, PLAN_TTL_MS, planTitle, summarize, updateTask } from '../hooks/plan'

const NOW = Date.parse('2026-10-16T09:00:00.000Z')
const BAND_PROPS = {
  hasSurvey: false,
  isWorking: false,
  maxRows: 10,
  bodyColumns: 120,
  scroll: { offset: 0, bodyRows: 10 },
  view: {},
}

/**
 * A session outside a repository, so the band reads no git. TaskCreate hands out ids 1, 2, 3…;
 * a call fails as `failing` says, keyed by the task id, the new task's subject, or `TodoWrite`.
 */
function fakeSession(on: On, stored: Record<string, unknown> = {}) {
  const clock = mock.clock(on, { now: NOW })
  const store = new Map(Object.entries(stored))
  on('store.get', ($, e) => ({ value: store.get(e.key) }))
  on('store.set', ($, e) => (store.set(e.key, e.value), { value: undefined }))
  on('store.delete', ($, e) => (store.delete(e.key), { value: undefined }))
  on('store.keys', () => ({ value: [...store.keys()] }))
  const failing = new Map<string, 'unsuccessful' | 'error' | 'refused'>()
  const session = { id: 'session-a' }
  on('session.id', () => ({ value: session.id }))
  on('session.cwd', () => ({ value: '/w/scratch' }))
  on('session.repo', () => ({ value: null }))
  on('session.model', () => ({ value: 'claude-opus-5-5' }))
  on('session.usage', () => ({ value: { startedAt: 0, context: { window: 200_000, percent: 10 }, rateLimits: [], cost: { usd: 0 } } }))
  on('tool.call', { tool: 'Bash' }, () => ({ result: { stdout: '', stderr: '', interrupted: false } }))
  let nextId = 0
  const failed = (key: string) => {
    const failure = failing.get(key)
    if (failure === 'refused') return { deny: 'Refused by a permission rule' }
    if (failure === 'error') return { isError: true as const, result: 'Task list is locked', text: 'Task list is locked' }
    return null
  }
  on('tool.call', { tool: 'TaskCreate' }, ($, e) => failed(e.subject) ?? { result: { task: { id: String(++nextId), subject: e.subject } } })
  on('tool.call', { tool: 'TaskUpdate' }, ($, e) => {
    if (failing.get(e.taskId) === 'unsuccessful') return { result: { success: false, taskId: e.taskId, updatedFields: [], error: 'Task not found' } }
    return failed(e.taskId) ?? { result: { success: true, taskId: e.taskId, updatedFields: ['status'] } }
  })
  on('tool.call', { tool: 'TodoWrite' }, ($, e) => failed('TodoWrite') ?? { result: { oldTodos: [], newTodos: e.todos } })
  return { clock, session, store, failing }
}

/** Lets the band read the session, so it draws rather than leave the site to the engine. */
async function readBand($: Engine, clock: MockClock): Promise<void> {
  await $.tool.call({ tool: 'Bash', command: 'git status' })
  await clock.advance(1000)
}

/** Draws the band at that width: all its text, and its plan line or null when it has none. */
async function drawBand($: Engine, bodyColumns = 120): Promise<{ text: string; plan: string | null }> {
  const band = await $.ui.mount({ plugin: 'mods', surface: 'terminal', component: 'AbovePrompt', props: { ...BAND_PROPS, bodyColumns } })
  const texts = (await band.findAll({ type: 'Text' })).map(element => element.text)
  await band.unmount()
  return { text: texts.join('|'), plan: texts.find(text => /^(planned|building|done) · /.test(text)) ?? null }
}

async function planLine($: Engine, bodyColumns = 120): Promise<string | null> {
  return (await drawBand($, bodyColumns)).plan
}

async function createTasks($: Engine, subjects: readonly string[]): Promise<void> {
  for (const subject of subjects) await $.tool.call({ tool: 'TaskCreate', subject, description: subject })
}

describe('the plan line', () => {
  test('is absent when there is no plan', async ($, on) => {
    const { clock } = fakeSession(on)
    await readBand($, clock)
    const drawn = await drawBand($)
    expect(drawn.text).toContain('[claude-opus-5-5]')
    expect(drawn.plan).toBe(null)
  })

  test('shows the declared progress and the task in progress', async ($, on) => {
    const { clock } = fakeSession(on)
    await createTasks($, ['Read the hooks', 'Write plan.ts', 'Add retry tests', 'Bump version', 'Update README'])
    await $.tool.call({ tool: 'TaskUpdate', taskId: '1', status: 'completed' })
    await $.tool.call({ tool: 'TaskUpdate', taskId: '2', status: 'completed' })
    await $.tool.call({ tool: 'TaskUpdate', taskId: '3', status: 'in_progress' })
    await readBand($, clock)
    expect(await planLine($)).toBe('building · 2/5 tasks · Add retry tests')
  })

  test('drops a deleted task from the count', async ($, on) => {
    const { clock } = fakeSession(on)
    await createTasks($, ['One', 'Two', 'Three'])
    await $.tool.call({ tool: 'TaskUpdate', taskId: '1', status: 'completed' })
    await $.tool.call({ tool: 'TaskUpdate', taskId: '3', status: 'deleted' })
    await readBand($, clock)
    expect(await planLine($)).toBe('planned · 1/2 tasks')
  })

  test('leaves the plan as it was after a failed or refused task call', async ($, on) => {
    const { clock, failing } = fakeSession(on)
    await createTasks($, ['One', 'Two', 'Three'])
    failing.set('1', 'unsuccessful')
    failing.set('2', 'error')
    failing.set('3', 'refused')
    await $.tool.call({ tool: 'TaskUpdate', taskId: '1', status: 'completed' })
    await $.tool.call({ tool: 'TaskUpdate', taskId: '2', status: 'deleted' })
    await $.tool.call({ tool: 'TaskUpdate', taskId: '3', status: 'completed' })
    failing.set('Four', 'error')
    await createTasks($, ['Four'])
    failing.set('TodoWrite', 'refused')
    await $.tool.call({ tool: 'TodoWrite', todos: [{ content: 'Replaced', status: 'completed', activeForm: 'Replacing' }] })
    await readBand($, clock)
    expect(await planLine($)).toBe('planned · 0/3 tasks')
  })

  test("never counts a subagent's tasks", async ($, on) => {
    const { clock } = fakeSession(on)
    await createTasks($, ['Main one', 'Main two'])
    const inSubagent = { agentId: 'agent-1' }
    await $.tool.call({ tool: 'TaskCreate', subject: 'Sub one', description: '', ...inSubagent })
    await $.tool.call({ tool: 'TaskUpdate', taskId: '1', status: 'completed', ...inSubagent })
    await $.tool.call({ tool: 'TodoWrite', todos: [{ content: 'Sub todo', status: 'completed', activeForm: 'Doing it' }], ...inSubagent })
    await readBand($, clock)
    expect(await planLine($)).toBe('planned · 0/2 tasks')
  })

  test('follows TodoWrite, which replaces the whole list', async ($, on) => {
    const { clock } = fakeSession(on)
    const todo = (content: string, status: 'pending' | 'in_progress' | 'completed') => ({ content, status, activeForm: content })
    await $.tool.call({ tool: 'TodoWrite', todos: [todo('A', 'completed'), todo('B', 'in_progress'), todo('C', 'pending')] })
    await $.tool.call({ tool: 'TodoWrite', todos: [todo('A', 'completed'), todo('B', 'completed')] })
    await readBand($, clock)
    expect(await planLine($)).toBe('done · 2/2 tasks')
  })

  test('cuts the title to the band width, and drops it where too narrow', async ($, on) => {
    const { clock } = fakeSession(on)
    await createTasks($, ['Teach the retry loop to back off exponentially'])
    await $.tool.call({ tool: 'TaskUpdate', taskId: '1', status: 'in_progress' })
    await readBand($, clock)
    expect(await planLine($, 48)).toBe('building · 0/1 task · Teach the retry loop to b…')
    expect(await planLine($, 30)).toBe('building · 0/1 task')
  })

  test('stays off the band when switched off', { options: { planProgress: false } }, async ($, on) => {
    const { clock } = fakeSession(on)
    await createTasks($, ['One'])
    await readBand($, clock)
    expect(await planLine($)).toBe(null)
  })
})

describe('the stored plans', () => {
  const task = { id: '1', subject: 'Resume me', status: 'in_progress' as const }

  test("restores a resumed session's plan and drops every plan past its day", async ($, on) => {
    on('command.register', ($, e) => ({ value: { command: e.name } }))
    on('session.start', ($, e) => ({ cwd: e.cwd }))
    const { clock, store } = fakeSession(on, {
      'planProgress:session-a': { tasks: [task], updatedAt: NOW - 1000 },
      'planProgress:session-old': { tasks: [task], updatedAt: NOW - PLAN_TTL_MS - 1 },
    })
    await $.session.start({ cwd: '/w/scratch', surface: 'terminal', isInteractive: true })
    await readBand($, clock)
    expect(await planLine($)).toBe('building · 0/1 task · Resume me')
    expect([...store.keys()]).toEqual(['planProgress:session-a'])
  })

  test('keeps each session under its own key and starts a cleared one empty', async ($, on) => {
    on('session.end', ($, e) => ({ sessionId: e.sessionId }))
    const { clock, session, store } = fakeSession(on)
    await createTasks($, ['First session'])
    session.id = 'session-b'
    await $.session.end({ reason: 'clear', sessionId: 'session-a', resume: { id: 'session-a' } })
    await readBand($, clock)
    expect(await planLine($)).toBe(null)

    await createTasks($, ['Second session'])
    expect(store.get('planProgress:session-a')).toEqual({ tasks: [{ id: '1', subject: 'First session', status: 'pending' }], updatedAt: NOW })
    expect(store.get('planProgress:session-b')).toEqual({ tasks: [{ id: '2', subject: 'Second session', status: 'pending' }], updatedAt: NOW + 1000 })
  })
})

describe('plan helpers', () => {
  test('summarize is null for no tasks, and done once every task is marked completed', () => {
    expect(summarize([])).toBe(null)
    expect(summarize([{ id: '1', subject: 'A', status: 'completed' }])).toEqual({ phase: 'done', completed: 1, total: 1, active: null })
  })

  test('updateTask ignores an id the plan does not have', () => {
    const tasks = [{ id: '1', subject: 'A', status: 'pending' as const }]
    expect(updateTask(tasks, { taskId: '9', status: 'completed' })).toEqual(tasks)
  })

  test('planTitle is null with nothing in progress', () => {
    expect(planTitle({ phase: 'planned', completed: 0, total: 2, active: null }, 120)).toBe(null)
  })

  test('freshTasks rejects a malformed or expired entry', () => {
    expect(freshTasks('nope', NOW)).toBe(null)
    expect(freshTasks({ tasks: [], updatedAt: NOW - PLAN_TTL_MS - 1 }, NOW)).toBe(null)
    expect(freshTasks({ tasks: [], updatedAt: NOW }, NOW)).toEqual([])
  })
})
