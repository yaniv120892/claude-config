import assert from 'node:assert/strict'
import { test } from 'node:test'

import { backoffMs, flattenMessage, parseChannels, permalinkOf, relevantMessage } from './lib.mjs'

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
