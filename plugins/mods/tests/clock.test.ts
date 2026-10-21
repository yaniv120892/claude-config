import type { On } from 'claude-code'
import { describe, expect, mock, test } from 'claude-code/testing'

import { formatDuration, formatLocalTime, parseUtcOffset, promptClock, slowToolNote } from '../hooks/clock'

const NOW = Date.parse('2026-10-21T11:03:00.000Z')
const HOUR = 3_600_000
const TYPED = { wait: false, origin: { kind: 'plugin', name: 'test', asUser: true } } as const

describe('the clock text', () => {
  test('gives the two largest units of a duration', () => {
    expect(formatDuration(47_400)).toBe('47s')
    expect(formatDuration(192_000)).toBe('3m 12s')
    expect(formatDuration(2 * HOUR + 5 * 60_000)).toBe('2h 5m')
    expect(formatDuration(28 * HOUR)).toBe('1d 4h')
    expect(formatDuration(2 * HOUR)).toBe('2h')
  })

  test('shows the local time with its zone', () => {
    expect(formatLocalTime(NOW, 180)).toBe('Wed 2026-10-21 14:03 UTC+3')
    expect(formatLocalTime(NOW, -270)).toBe('Wed 2026-10-21 06:33 UTC-4:30')
  })

  test('reads the offset `date +%z` prints', () => {
    expect(parseUtcOffset('+0300\n')).toBe(180)
    expect(parseUtcOffset('-0430')).toBe(-270)
    expect(parseUtcOffset('IDT')).toBeNull()
  })

  test('names time away only past half an hour', () => {
    expect(promptClock(NOW, 0, NOW - 10 * 60_000)).toBe('Current local time: Wed 2026-10-21 11:03 UTC+0.')
    expect(promptClock(NOW, 0, null)).not.toContain('idle')
    expect(promptClock(NOW, 0, NOW - 26 * HOUR)).toContain('This session was idle for 1d 2h before this prompt')
  })

  test('notes only a slow tool call', () => {
    expect(slowToolNote('Bash', 9_999)).toBeNull()
    expect(slowToolNote('Bash', undefined)).toBeNull()
    expect(slowToolNote('Bash', 47_000)).toBe('Bash took 47s to run.')
  })
})

function fakeSession(on: On, stored: Record<string, unknown> = {}) {
  const clock = mock.clock(on, { now: NOW })
  const store = new Map(Object.entries(stored))
  on('store.get', ($, e) => ({ value: store.get(e.key) }))
  on('store.set', ($, e) => (store.set(e.key, e.value), { value: undefined }))
  on('store.delete', ($, e) => (store.delete(e.key), { value: undefined }))
  on('store.keys', () => ({ value: [...store.keys()] }))
  on('session.id', () => ({ value: 'session-a' }))
  on('process.run', () => ({ value: { exitCode: 0, stdout: '+0300\n', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }))
  on('prompt.submit', ($, e) => ({ text: e.text, context: e.context }))
  return { clock, store }
}

describe('time awareness', () => {
  test('tells the model the time with each prompt, and how long a resumed session was away', async ($, on) => {
    const { clock, store } = fakeSession(on, { 'lastActive:session-a': NOW - 2 * 24 * HOUR })
    const first = await $.prompt.submit({ ...TYPED, text: 'where were we?' })
    expect(first.context?.at(-1)).toContain('Current local time: Wed 2026-10-21 14:03 UTC+3.')
    expect(first.context?.at(-1)).toContain('idle for 2d before this prompt')
    expect(store.get('lastActive:session-a')).toBe(NOW)

    await clock.advance(60_000)
    const next = await $.prompt.submit({ ...TYPED, text: 'go on' })
    expect(next.context?.at(-1)).toBe('Current local time: Wed 2026-10-21 14:04 UTC+3.')
  })

  test('follows a slow tool call with its run time, and leaves a quick one alone', async ($, on) => {
    on('classic.PostToolUse', () => ({}))
    on('classic.PostToolUseFailure', () => ({}))
    const slow = await $.classic.PostToolUse({ tool_name: 'Bash', tool_input: {}, tool_response: {}, tool_use_id: 't1', duration_ms: 95_000 })
    expect(slow.additionalContext).toEqual(['Bash took 1m 35s to run.'])
    const quick = await $.classic.PostToolUse({ tool_name: 'Read', tool_input: {}, tool_response: {}, tool_use_id: 't2', duration_ms: 40 })
    expect(quick.additionalContext ?? []).toEqual([])
    const failed = await $.classic.PostToolUseFailure({ tool_name: 'Bash', tool_input: {}, tool_use_id: 't3', error: 'timeout', duration_ms: 120_000 })
    expect(failed.additionalContext).toEqual(['Bash took 2m to run.'])
  })
})
