import { describe, expect, test } from 'claude-code/testing'

import { setupSteps } from '../hooks/setup'

const NOW = Date.parse('2026-11-01T10:40:00Z')
const DONE = {
  hasTokens: true,
  link: 'connected' as const,
  alertChannels: 'prod-alerts',
  eventChannels: 'cockpit-events',
  facts: { scopes: { 'reactions.add': 'ok' as const }, lastEventAt: NOW - 60_000 },
  now: NOW,
}

function left(state: Parameters<typeof setupSteps>[0]): string[] {
  return setupSteps(state)
    .filter(step => !step.isDone)
    .map(step => step.id)
}

describe('the setup checklist', () => {
  test('one method refused for a scope keeps the step open, however many others went through', async () => {
    expect(left(DONE)).toEqual([])
    const refusedReply = { ...DONE, facts: { ...DONE.facts, scopes: { 'reactions.add': 'ok' as const, 'chat.postMessage': 'missing' as const } } }
    expect(left(refusedReply)).toEqual(['scopes'])
    expect(setupSteps(refusedReply).find(step => step.id === 'scopes')?.todo).toContain('reinstall')
  })

  test('events count as flowing for a week after the last one', async () => {
    expect(left({ ...DONE, facts: { ...DONE.facts, lastEventAt: NOW - 8 * 86_400_000 } })).toEqual(['flowing'])
    expect(left({ ...DONE, facts: { ...DONE.facts, lastEventAt: null } })).toEqual(['flowing'])
  })
})
