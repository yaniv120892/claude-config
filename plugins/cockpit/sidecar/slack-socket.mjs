#!/usr/bin/env node
// Holds the Slack Socket Mode WebSocket for the cockpit mod, which cannot hold
// one itself, and prints what the mod needs as one JSON object per line.
//
// Every session starts one. Slack hands each event to a single connection of
// an app, so only the sidecar that holds the lock file connects; the others
// stand by and take over when it exits.

import { readFileSync, rmSync, writeFileSync } from 'node:fs'

import { backoffMs, parseChannels, permalinkOf, relevantMessage } from './lib.mjs'

const APP_TOKEN = process.env.SLACK_APP_TOKEN ?? ''
const USER_TOKEN = process.env.SLACK_USER_TOKEN ?? ''
const LOCK_FILE = process.env.COCKPIT_LOCK ?? ''
const STANDBY_RETRY_MS = 5000
const PARENT_CHECK_MS = 10_000

const channelNames = new Map()
const userNames = new Map()
let isLeader = false

function emit(line) {
  process.stdout.write(`${JSON.stringify(line)}\n`)
}

function status(state, detail = '') {
  emit({ kind: 'status', state, detail })
}

function releaseLock() {
  if (isLeader) rmSync(LOCK_FILE, { force: true })
  isLeader = false
}

function exit(code) {
  releaseLock()
  process.exit(code)
}

function isAlive(pid) {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

function tryLock() {
  try {
    writeFileSync(LOCK_FILE, String(process.pid), { flag: 'wx' })
    return true
  } catch {
    const holder = Number(readFileSync(LOCK_FILE, 'utf8'))
    if (Number.isInteger(holder) && isAlive(holder)) return false
    rmSync(LOCK_FILE, { force: true })
    return false
  }
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

async function slack({ method, token, params = {} }) {
  const response = await fetch(`https://slack.com/api/${method}`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(params),
  })
  const answer = await response.json()
  if (!answer.ok) throw new Error(`Slack ${method} failed: ${answer.error ?? response.status}`)
  return answer
}

async function resolveAlertChannels() {
  const { ids, names } = parseChannels(process.env.COCKPIT_ALERT_CHANNELS)
  const found = new Set(ids)
  let cursor = ''
  while (names.length > 0 && cursor !== null) {
    const page = await slack({
      method: 'conversations.list',
      token: USER_TOKEN,
      params: { types: 'public_channel,private_channel', exclude_archived: 'true', limit: '1000', cursor },
    })
    for (const channel of page.channels) {
      channelNames.set(channel.id, channel.name)
      if (names.includes(channel.name.toLowerCase())) found.add(channel.id)
    }
    cursor = page.response_metadata?.next_cursor || null
  }
  return found
}

async function channelName(id) {
  if (!channelNames.has(id)) {
    try {
      const { channel } = await slack({ method: 'conversations.info', token: USER_TOKEN, params: { channel: id } })
      channelNames.set(id, channel.is_im ? 'DM' : `#${channel.name ?? id}`)
    } catch {
      channelNames.set(id, id)
    }
  }
  const name = channelNames.get(id)
  return name.startsWith('#') || name === 'DM' ? name : `#${name}`
}

async function userName(id) {
  if (id === null) return 'a bot'
  if (!userNames.has(id)) {
    try {
      const { user } = await slack({ method: 'users.info', token: USER_TOKEN, params: { user: id } })
      userNames.set(id, user.real_name || user.name || id)
    } catch {
      userNames.set(id, id)
    }
  }
  return userNames.get(id)
}

async function forward({ message, workspaceUrl }) {
  emit({
    kind: 'message',
    id: `${message.channel}:${message.ts}`,
    channel: await channelName(message.channel),
    from: message.botName ?? (await userName(message.user)),
    text: message.text,
    permalink: permalinkOf(workspaceUrl, message.channel, message.ts),
    at: Math.round(Number(message.ts) * 1000),
    isAlertChannel: message.isAlertChannel,
  })
}

/** One connection's life: resolves when it closes, however it closed. */
function listen({ url, onEvent }) {
  return new Promise(resolve => {
    const socket = new WebSocket(url)
    socket.addEventListener('close', () => resolve())
    socket.addEventListener('error', () => resolve())
    socket.addEventListener('message', ({ data }) => {
      const envelope = JSON.parse(String(data))
      if (envelope.envelope_id !== undefined) socket.send(JSON.stringify({ envelope_id: envelope.envelope_id }))
      switch (envelope.type) {
        case 'hello':
          status('connected')
          break
        case 'disconnect':
          socket.close()
          break
        case 'events_api':
          onEvent(envelope.payload?.event)
          break
        default:
          break
      }
    })
  })
}

async function lead() {
  const identity = await slack({ method: 'auth.test', token: USER_TOKEN })
  const alertChannelIds = await resolveAlertChannels()

  function onEvent(event) {
    const message = relevantMessage({ event, selfUserId: identity.user_id, alertChannelIds })
    if (message === null) return
    forward({ message, workspaceUrl: identity.url }).catch(error => status('error', String(error.message)))
  }

  for (let attempt = 0; ; attempt += 1) {
    try {
      const { url } = await slack({ method: 'apps.connections.open', token: APP_TOKEN })
      await listen({ url, onEvent })
      attempt = 0
      status('starting', 'Reconnecting to Slack.')
    } catch (error) {
      status('error', String(error.message))
    }
    await sleep(backoffMs(attempt))
  }
}

async function main() {
  if (APP_TOKEN === '' || USER_TOKEN === '' || LOCK_FILE === '') {
    status('error', 'SLACK_APP_TOKEN, SLACK_USER_TOKEN and COCKPIT_LOCK must all be set.')
    exit(2)
  }
  // The mod kills this process when its session ends; a session that died
  // without doing so leaves it to a new parent, and the lock must not outlive it.
  const parent = process.ppid
  setInterval(() => {
    if (process.ppid !== parent) exit(0)
  }, PARENT_CHECK_MS).unref()
  process.stdout.on('error', () => exit(0))
  for (const signal of ['SIGTERM', 'SIGINT', 'SIGHUP']) process.on(signal, () => exit(0))

  status('starting')
  let isStandingBy = false
  while (!tryLock()) {
    if (!isStandingBy) status('standby', 'Another session holds the Slack connection.')
    isStandingBy = true
    await sleep(STANDBY_RETRY_MS)
  }
  isLeader = true
  await lead()
}

main().catch(error => {
  status('error', String(error.message))
  exit(1)
})
