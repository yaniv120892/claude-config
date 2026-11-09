import { describe, expect, test } from 'claude-code/testing'

import { addToInbox, markHandled, parseSidecarLine, pullRequestsIn, takeLines, waiting } from '../hooks/slack'
import type { SlackMessage } from '../hooks/slack'

function message(overrides: Partial<SlackMessage>): SlackMessage {
  return {
    id: 'C1:1.0',
    channel: '#reviews',
    from: 'Dana',
    text: 'please review https://github.com/acme/app/pull/12',
    permalink: 'https://acme.slack.com/archives/C1/p10',
    at: 1000,
    isAlertChannel: false,
    ...overrides,
  }
}

describe('reading Slack messages', () => {
  test('finds each distinct PR link once', async () => {
    const found = pullRequestsIn(
      'https://github.com/acme/app/pull/12/files and https://github.com/acme/app/pull/12 then https://github.com/acme/web.site/pull/3',
    )
    expect(found).toEqual([
      { url: 'https://github.com/acme/app/pull/12', repo: 'acme/app', number: 12 },
      { url: 'https://github.com/acme/web.site/pull/3', repo: 'acme/web.site', number: 3 },
    ])
    expect(pullRequestsIn('https://github.com/acme/app/issues/12')).toEqual([])
  })

  test('keeps a half line until the rest of it arrives', async () => {
    const first = takeLines('{"a":1}\n{"b"')
    expect(first).toEqual({ lines: ['{"a":1}'], rest: '{"b"' })
    expect(takeLines(`${first.rest}:2}\n`)).toEqual({ lines: ['{"b":2}'], rest: '' })
  })

  test('reads a status and a message, and nothing else', async () => {
    expect(parseSidecarLine('{"kind":"status","state":"connected","detail":""}')).toEqual({
      kind: 'status',
      link: { state: 'connected', detail: '' },
    })
    expect(parseSidecarLine(JSON.stringify({ kind: 'message', ...message({}) }))?.kind).toBe('message')
    expect(parseSidecarLine('{"kind":"status","state":"weird"}')).toBe(null)
    expect(parseSidecarLine('not json')).toBe(null)
  })
})

describe('the inbox', () => {
  test('adds a PR once, and brings a handled one back only when posted again later', async () => {
    const first = addToInbox([], message({}))
    expect(first.added.length).toBe(1)
    expect(waiting(first.inbox).map(item => item.prUrl)).toEqual(['https://github.com/acme/app/pull/12'])

    const repeated = addToInbox(first.inbox, message({ id: 'C2:2.0', at: 2000 }))
    expect(repeated.added).toEqual([])
    expect(repeated.inbox.length).toBe(1)

    const handled = markHandled(repeated.inbox, 'https://github.com/acme/app/pull/12', 'dismissed')
    expect(waiting(handled)).toEqual([])
    expect(addToInbox(handled, message({ at: 1500 })).added).toEqual([])
    expect(addToInbox(handled, message({ at: 3000 })).added.length).toBe(1)
  })
})
