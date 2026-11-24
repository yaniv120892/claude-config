#!/usr/bin/env node
import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { promisify } from 'node:util'
import { PR_URL, sessionName } from './name.mjs'

const GROUP = 'pr-reviews'
const exec = promisify(execFile)
const sh = async (cmd, args) =>
  (await exec(cmd, args, { env: { ...process.env, CMUX_QUIET: '1' } })).stdout.trim()
const log = (e) => console.error(new Date().toISOString(), e?.message ?? e)

async function slack(method, token, body = {}) {
  const res = await fetch(`https://slack.com/api/${method}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: new URLSearchParams(body),
  })
  const json = await res.json()
  if (!json.ok) throw new Error(`${method}: ${json.error}`)
  return json
}

async function ensureGroup() {
  const { groups } = JSON.parse(await sh('cmux', ['workspace-group', 'list', '--json']))
  const found = groups.find((g) => g.name === GROUP)
  if (found) return found.ref
  const out = await sh('cmux', ['workspace-group', 'create', '--name', GROUP, '--idempotency-key', GROUP])
  return out.match(/workspace_group:\d+/)[0]
}

// The text reaches osascript as argv, never spliced into the script, so Slack content cannot inject AppleScript
async function confirm(text) {
  try {
    const out = await sh('osascript', [
      '-e', 'on run argv',
      '-e', 'display dialog (item 1 of argv) with title "PR review request" buttons {"Dismiss", "Review"} default button "Review" giving up after 300',
      '-e', 'end run',
      text,
    ])
    return out.includes('button returned:Review')
  } catch {
    return false // Esc raises -128
  }
}

async function openReview({ name, url, repo }) {
  const dir = `${homedir()}/bazak/${repo}`
  const out = await sh('cmux', [
    'workspace', 'create', '--name', name,
    '--cwd', existsSync(dir) ? dir : `${homedir()}/bazak`,
    '--group', await ensureGroup(),
    '--command', `claude -n ${name} "/pr-workflows:pr-review ${url}"`,
  ])
  const workspace = out.match(/workspace:\d+/)[0]
  await sh('cmux', ['new-surface', '--type', 'browser', '--url', url, '--workspace', workspace, '--focus', 'false'])
}

const seen = new Set()

async function onEvent({ event_id, event, authorizations }, userToken) {
  if (event?.type !== 'message' || event.channel_type !== 'im' || event.subtype) return
  if (event.user === authorizations?.[0]?.user_id || seen.has(event_id)) return
  const match = event.text?.match(PR_URL)
  if (!match) return
  seen.add(event_id)

  const [url, slug, repo, number] = match
  const [pr, { user }] = await Promise.all([
    sh('gh', ['pr', 'view', number, '--repo', slug, '--json', 'title,author,headRefName']).then(JSON.parse),
    slack('users.info', userToken, { user: event.user }),
  ])
  const developer = user.profile.first_name || user.real_name || pr.author.login
  const name = sessionName({ developer, title: pr.title, branch: pr.headRefName, repo, number })
  if (await confirm(`${user.real_name} sent ${slug}#${number}\n${pr.title}\n\nRun /pr-review?`)) {
    await openReview({ name, url, repo })
  }
}

async function listen(appToken, userToken) {
  for (;;) {
    try {
      const { url } = await slack('apps.connections.open', appToken)
      await new Promise((resolve) => {
        const ws = new WebSocket(url)
        ws.onmessage = ({ data }) => {
          const msg = JSON.parse(data)
          if (msg.envelope_id) ws.send(JSON.stringify({ envelope_id: msg.envelope_id }))
          if (msg.type === 'events_api') onEvent(msg.payload, userToken).catch(log)
          if (msg.type === 'disconnect') ws.close()
        }
        ws.onclose = resolve
        ws.onerror = () => ws.close()
      })
    } catch (e) {
      log(e)
    }
    await new Promise((r) => setTimeout(r, 5000))
  }
}

const secret = (service) => sh('security', ['find-generic-password', '-s', service, '-w'])
listen(await secret('pr-dm-listener-app'), await secret('pr-dm-listener-user'))
