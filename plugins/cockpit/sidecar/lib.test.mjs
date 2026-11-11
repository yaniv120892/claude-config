import assert from 'node:assert/strict'
import { test } from 'node:test'

import { backoffMs, flattenMessage, isBoardEvent, isLockStale, parseChannels, permalinkOf, relevantMessage } from './lib.mjs'

const ALERTS = new Set(['C0ALERTS01'])

test('splits channel ids from names', () => {
  assert.deepEqual(parseChannels('#Prod-Alerts, C0ALERTS01 ,'), { ids: ['C0ALERTS01'], names: ['prod-alerts'] })
  assert.deepEqual(parseChannels(undefined), { ids: [], names: [] })
})

test('flattens a bot message whose text sits in attachments and blocks', () => {
  const text = flattenMessage({
    text: '',
    attachments: [{ title: 'High error rate', text: 'billing-api 5xx > 5%', fields: [{ title: 'env', value: 'prod' }] }],
    blocks: [{ type: 'section', text: { type: 'mrkdwn', text: 'See <https://grafana.example/d/1|the dashboard>' } }],
  })
  assert.equal(text, 'High error rate\nbilling-api 5xx > 5%\nenv: prod\nSee https://grafana.example/d/1')
})

test("forwards another person's PR link, and never my own", () => {
  const event = { type: 'message', channel: 'C0REVIEWS1', ts: '1700000000.000200', user: 'U2', text: 'review <https://github.com/acme/app/pull/12|this>' }
  const forwarded = relevantMessage({ event, selfUserId: 'U1', alertChannelIds: ALERTS })
  assert.equal(forwarded?.text, 'review https://github.com/acme/app/pull/12')
  assert.equal(forwarded?.isAlertChannel, false)
  assert.equal(relevantMessage({ event, selfUserId: 'U2', alertChannelIds: ALERTS }), null)
})

test('a PR link posted inside a thread names the thread it sits in, so a reply joins it', () => {
  const event = { type: 'message', channel: 'C0REVIEWS1', ts: '1.5', thread_ts: '1.2', user: 'U2', text: 'https://github.com/acme/app/pull/12' }
  assert.equal(relevantMessage({ event, selfUserId: 'U1', alertChannelIds: ALERTS })?.threadTs, '1.2')
  const topLevel = { ...event, thread_ts: undefined }
  assert.equal(relevantMessage({ event: topLevel, selfUserId: 'U1', alertChannelIds: ALERTS })?.threadTs, '1.5')
})

test('forwards every message of an alert channel, and no other chatter or edit', () => {
  const alert = { type: 'message', channel: 'C0ALERTS01', ts: '1.2', subtype: 'bot_message', username: 'Monitor', text: 'down' }
  assert.equal(relevantMessage({ event: alert, selfUserId: 'U1', alertChannelIds: ALERTS })?.botName, 'Monitor')
  const chatter = { type: 'message', channel: 'C0REVIEWS1', ts: '1.3', user: 'U2', text: 'lunch?' }
  assert.equal(relevantMessage({ event: chatter, selfUserId: 'U1', alertChannelIds: ALERTS }), null)
  assert.equal(relevantMessage({ event: { ...alert, subtype: 'message_changed' }, selfUserId: 'U1', alertChannelIds: ALERTS }), null)
})

test('builds the permalink and caps the reconnect wait', () => {
  assert.equal(permalinkOf('https://acme.slack.com/', 'C1', '1700000000.000200'), 'https://acme.slack.com/archives/C1/p1700000000000200')
  assert.deepEqual([0, 1, 9].map(backoffMs), [1000, 2000, 30000])
})

test("reads a person's message once, though Slack repeats its text in blocks", () => {
  const text = flattenMessage({
    text: 'please review <https://github.com/o/r/pull/3> thanks',
    blocks: [{ type: 'rich_text', elements: [{ type: 'rich_text_section', elements: [{ type: 'text', text: 'please review ' }, { type: 'link', url: 'https://github.com/o/r/pull/3' }] }] }],
  })
  assert.equal(text, 'please review https://github.com/o/r/pull/3 thanks')
})

test("keeps a bot's blocks beside its one-line text", () => {
  const text = flattenMessage({
    text: '[Triggered] High error rate',
    blocks: [{ type: 'section', text: { type: 'mrkdwn', text: 'service: billing-api' } }],
  })
  assert.equal(text, '[Triggered] High error rate\nservice: billing-api')
})

test("leaves out a bot's PR notice and a reply in an alert's thread", () => {
  const notice = { type: 'message', channel: 'C0REVIEWS1', ts: '1.4', subtype: 'bot_message', bot_id: 'B1', text: 'PR opened https://github.com/acme/app/pull/9' }
  assert.equal(relevantMessage({ event: notice, selfUserId: 'U1', alertChannelIds: ALERTS }), null)
  const reply = { type: 'message', channel: 'C0ALERTS01', ts: '1.5', thread_ts: '1.2', user: 'U2', text: 'looking' }
  assert.equal(relevantMessage({ event: reply, selfUserId: 'U1', alertChannelIds: ALERTS }), null)
  const mine = { type: 'message', channel: 'C0ALERTS01', ts: '1.6', user: 'U1', text: 'testing the alert' }
  assert.equal(relevantMessage({ event: mine, selfUserId: 'U1', alertChannelIds: ALERTS }), null)
})

test('a lock is stale when its pid is gone or belongs to another program', () => {
  assert.equal(isLockStale({ holder: 41, commandOf: () => 'node /x/sidecar/slack-socket.mjs' }), false)
  assert.equal(isLockStale({ holder: 41, commandOf: () => '/usr/sbin/cupsd' }), true)
  assert.equal(isLockStale({ holder: 41, commandOf: () => null }), true)
  assert.equal(isLockStale({ holder: Number.NaN, commandOf: () => 'slack-socket' }), true)
})

test("an event channel's messages are board events, a bot's and a thread reply's as much as a person's; other channels' are not", () => {
  const eventChannelIds = new Set(['C0EVENTS01'])
  const githubNotice = { type: 'message', channel: 'C0EVENTS01', ts: '1.7', subtype: 'bot_message', bot_id: 'B9', text: 'Review requested on acme/app#12' }
  assert.equal(isBoardEvent({ event: githubNotice, eventChannelIds }), true)
  assert.equal(isBoardEvent({ event: { ...githubNotice, thread_ts: '1.2' }, eventChannelIds }), true)
  assert.equal(isBoardEvent({ event: { ...githubNotice, channel: 'C0REVIEWS1' }, eventChannelIds }), false)
  assert.equal(isBoardEvent({ event: { ...githubNotice, subtype: 'message_deleted' }, eventChannelIds }), false)
})
