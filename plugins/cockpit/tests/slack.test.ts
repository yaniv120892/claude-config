import { describe, expect, test } from 'claude-code/testing'

import { addToInbox, applyMarks, markHandled, parseSidecarLine, pullRequestsIn, takeLines, waiting } from '../hooks/slack'
import type { SlackMessage } from '../hooks/slack'

function message(overrides: Partial<SlackMessage>): SlackMessage {
  return {
    id: 'C1:1.0',
    threadId: 'C1:1.0',
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

  test('reads a status, a message and an event, and nothing else', async () => {
    expect(parseSidecarLine('{"kind":"event","channel":"C0EVENTS01"}')).toEqual({ kind: 'event' })
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
  const PR = 'https://github.com/acme/app/pull/12'
  const NONE: ReadonlySet<string> = new Set()

  test('adds a PR once, and leaves out a PR of my own', async () => {
    const first = addToInbox({ inbox: [], message: message({}), marks: {}, ownPrUrls: NONE })
    expect(first.added.length).toBe(1)
    expect(waiting(first.inbox).map(item => item.prUrl)).toEqual([PR])

    const repeated = addToInbox({ inbox: first.inbox, message: message({ id: 'C2:2.0', at: 2000 }), marks: {}, ownPrUrls: NONE })
    expect(repeated.added).toEqual([])
    expect(repeated.inbox.length).toBe(1)

    expect(addToInbox({ inbox: [], message: message({}), marks: {}, ownPrUrls: new Set([PR]) })).toEqual({ inbox: [], added: [] })
  })

  test('a dismissal stands against the stored inbox, until the PR is posted again after it', async () => {
    const { inbox } = addToInbox({ inbox: [], message: message({ at: 1000 }), marks: {}, ownPrUrls: NONE })
    const marks = markHandled({}, { prUrl: PR, by: 'dismissed', at: 1500 })
    // The stored list still says "waiting": another session wrote it before the mark.
    expect(waiting(applyMarks(inbox, marks))).toEqual([])
    const before = addToInbox({ inbox, message: message({ at: 1200 }), marks, ownPrUrls: NONE })
    expect(before.added).toEqual([])
    expect(waiting(before.inbox)).toEqual([])

    const reposted = addToInbox({ inbox, message: message({ at: 3000 }), marks, ownPrUrls: NONE })
    expect(reposted.added.length).toBe(1)
    expect(waiting(reposted.inbox).length).toBe(1)
  })
})
