import type { On } from 'claude-code'
import { describe, expect, test } from 'claude-code/testing'

const COMPOSE = {
  model: 'claude-opus-5-5',
  promptModel: 'claude-opus-5-5',
  surfaces: ['terminal'] as const,
  tools: ['Bash'],
  outputStyle: null,
  traits: [],
}

function fakeEngine(on: On): string[] {
  const read: string[] = []
  on('fs.read', ($, e) => {
    read.push(e.path)
    return { value: '# Reply Style\n\nShort sentences.\n' }
  })
  on('prompt.compose', () => ({ sections: [{ id: 'intro', text: 'You are Claude Code.', scope: 'shared' }] }))
  return read
}

describe('the reply-style section', () => {
  test('is added last, from prompts/reply-style.md', async ($, on) => {
    const read = fakeEngine(on)
    const { sections } = await $.prompt.compose(COMPOSE)
    expect(sections.map(section => section.id)).toEqual(['intro', 'mods:reply-style'])
    expect(sections[1]).toEqual({ id: 'mods:reply-style', text: '# Reply Style\n\nShort sentences.', scope: 'session' })
    expect(read[0]?.endsWith('/prompts/reply-style.md')).toBe(true)
  })

  test('stays out of side calls that write no reply', async ($, on) => {
    fakeEngine(on)
    const { sections } = await $.prompt.compose({ ...COMPOSE, traits: ['analysis'] })
    expect(sections.map(section => section.id)).toEqual(['intro'])
  })
})
