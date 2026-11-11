import { atom, read, update } from 'claude-code'
import type { CommandSpec, EngineInterface as Engine, PluginOptions, Register, ThemeKey } from 'claude-code'

import type {
  Alert,
  AlertVerdict,
  Board,
  BoardLease,
  BoardPr,
  BoardReviewer,
  CheckState,
  ContextGauge,
  Focus,
  InboxItem,
  PendingMerge,
  Reviewer,
  ReviewerState,
  SetupFacts,
  SharedBoard,
  SlackLink,
  Tab,
  Ticket,
} from '../types'
import { addAlert, asAlerts, investigateArgs, isRelated, parseVerdict, verdictPrompt, watchedDeploys } from './alerts'
import type { Verdict } from './alerts'
import {
  age,
  asDismissed,
  BOARD_QUERY,
  boardSearches,
  countChecks,
  exhaustedQuota,
  isMergedButOpen,
  isOnBoard,
  isRateLimited,
  isReadyToMerge,
  namesTicket,
  newlyDeployed,
  nextReadAt,
  parseBoard,
  parseQuota,
  parseTickets,
  prChanges,
  quotaNote,
  teamKeysOf,
  ticketIdIn,
  ticketOf,
  workspaceTitle,
} from './prs'
import { asSetupFacts, setupSteps } from './setup'
import type { SetupStep } from './setup'
import { asLease, asSharedBoard, isLeasedToOther, isNewerBoard, LEASE_MS } from './share'
import {
  addToInbox,
  applyMarks,
  asInbox,
  asMarks,
  excerptOf,
  markHandled,
  parseSidecarLine,
  QUICK_REACTIONS,
  REVIEW_SKILL,
  scopesShown,
  slackAddress,
  slackRefusal,
  takeLines,
  waiting,
} from './slack'
import type { SlackMessage } from './slack'
import { asCounts, bar, contextGauge, kiloTokens, parsePinned, skillButtons, stripBarWidth, usageColor, usageLimits } from './usage'

// Every hook lives in this file: the engine follows `$` only into functions
// declared beside the hook that passes it. The pure logic sits in the files
// imported above, which is what the tests cover.

const tab = atom({ plugin: 'cockpit', key: 'tab' } as const, 'inbox')
const inbox = atom({ plugin: 'cockpit', key: 'inbox' } as const, [], { shape: 'inbox-2' })
const board = atom({ plugin: 'cockpit', key: 'board' } as const, null, { shape: 'board-3' })
const alerts = atom({ plugin: 'cockpit', key: 'alerts' } as const, [], { shape: 'alerts-1' })
const dismissed = atom({ plugin: 'cockpit', key: 'dismissed' } as const, [])
const expanded = atom({ plugin: 'cockpit', key: 'expanded' } as const, null)
const isShowingDismissed = atom({ plugin: 'cockpit', key: 'isShowingDismissed' } as const, false)
const slack = atom({ plugin: 'cockpit', key: 'slack' } as const, { state: 'off', detail: '' })
const usage = atom({ plugin: 'cockpit', key: 'usage' } as const, null, { shape: 'usage-3' })
const skills = atom({ plugin: 'cockpit', key: 'skills' } as const, [], { shape: 'skills-1' })
const replyingTo = atom({ plugin: 'cockpit', key: 'replyingTo' } as const, null)
const replyDraft = atom({ plugin: 'cockpit', key: 'replyDraft' } as const, '')
const focus = atom({ plugin: 'cockpit', key: 'focus' } as const, null, { shape: 'focus-1' })
const isShowingAllPrs = atom({ plugin: 'cockpit', key: 'isShowingAllPrs' } as const, false)
const openTicket = atom({ plugin: 'cockpit', key: 'openTicket' } as const, null)
const confirmingMerge = atom({ plugin: 'cockpit', key: 'confirmingMerge' } as const, null)
const askingReviewFor = atom({ plugin: 'cockpit', key: 'askingReviewFor' } as const, null)
const reviewerDraft = atom({ plugin: 'cockpit', key: 'reviewerDraft' } as const, '')
const setupFacts = atom({ plugin: 'cockpit', key: 'setupFacts' } as const, { scopes: 'unknown', lastEventAt: null }, { shape: 'setup-1' })

const PANE = 'cockpit'
const PANE_TITLE = 'Cockpit'
const COMMAND: CommandSpec = {
  name: 'cockpit',
  description: 'Open the cockpit: the Slack PR inbox, your PRs and tickets, deploy alerts, skill buttons and usage',
  argumentHint: '[inbox|prs|alerts|skills]',
}
const SETUP_TAB = 'alerts' satisfies Tab
const TABS = [
  { id: 'inbox', label: 'Inbox', hotkey: '1' },
  { id: 'prs', label: 'PRs', hotkey: '2' },
  { id: 'alerts', label: 'Alerts', hotkey: '3' },
  { id: 'skills', label: 'Skills', hotkey: '4' },
] as const satisfies readonly { id: Tab; label: string; hotkey: string }[]

// Shared by every open session through $.store, so a dismissal in one shows in all.
const INBOX_KEY = 'inbox'
const HANDLED_KEY = 'inboxHandled'
const ALERTS_KEY = 'alerts'
const DISMISSED_KEY = 'dismissedPrs'
const SKILL_COUNTS_KEY = 'skillCounts'
// One session reads the board for the machine and stores it here; the lease names which one is reading.
const BOARD_KEY = 'board'
const LEASE_KEY = 'boardLease'
const SETUP_KEY = 'setup'

const SHARED_POLL_MS = 15_000
// How often a session looks at the stored board: a store read, not a GitHub one.
const BOARD_TICK_MS = 30_000
// Slack events come in bursts (a push, its checks, a review); one read follows them all.
const EVENT_DEBOUNCE_MS = 10_000
const SIDECAR_RESTART_MS = 30_000
const NOTICE_TOAST_MS = 15_000
const LINEAR_SERVER = 'claude.ai Linear'
const SLACK_API = 'https://slack.com/api'
// An ISO 8601 duration, as Linear's completedAt filter reads it.
const DONE_SHOWN_FOR = '-P1D'
const VERDICT_MODEL = 'haiku'
const ALERT_EXCERPT_LENGTH = 400
const SKILL_HOTKEYS = 'abcdefghijkl'
const POLISH_SKILL = '/pr-workflows:pr-polish'
const ASK_REVIEW_SKILL = '/pr-workflows:ask-pr-review-slack'
const WORKSPACE_SKILL = '/cmux:ticket-workspace'
const DONE_STATE = 'Done'
const MERGE_CONFIRM_MS = 10_000
const INVESTIGATE_SKILL = 'dev-workflows:investigate-alert'
const MINUTE_MS = 60_000

const FOCUS_SOURCE = {
  workspace: 'From the workspace name.',
  branch: 'From the branch name.',
} as const satisfies Record<Focus['source'], string>

const VERDICT_LOOK = {
  likely: { label: 'LIKELY RELATED', color: 'error' },
  unclear: { label: 'UNCLEAR', color: 'warning' },
  unlikely: { label: 'unlikely related', color: 'success' },
} as const satisfies Record<AlertVerdict, { label: string; color: ThemeKey }>

const CHECK_LOOK = {
  fail: { mark: '✗', color: 'error' },
  pending: { mark: '◌', color: 'warning' },
  pass: { mark: '✓', color: 'success' },
} as const satisfies Record<CheckState, { mark: string; color: ThemeKey }>

const REVIEWER_LOOK = {
  requested: { mark: '👀 ', color: null },
  approved: { mark: '✓', color: 'success' },
  changes: { mark: '✗', color: 'error' },
  commented: { mark: '💬', color: null },
} as const satisfies Record<ReviewerState, { mark: string; color: ThemeKey | null }>

// A sidecar in standby defers to another session's connection, which delivers the events.
const EVENT_LINK_STATES: ReadonlySet<SlackLink['state']> = new Set(['connected', 'standby'])

const SLACK_LOOK = {
  off: 'subtle',
  starting: 'warning',
  standby: 'subtle',
  connected: 'success',
  error: 'error',
} as const satisfies Record<SlackLink['state'], ThemeKey>

/** A Slack message a row can act on: `rowKey` tells rows of one message apart (one per PR it links). */
type SlackTarget = { rowKey: string; messageId: string; threadId: string; permalink: string }

type Config = {
  appToken: string
  userToken: string
  alertChannels: string
  eventChannels: string
  alertWindowMinutes: number
  alertWindowMs: number
  prodEnvironment: string
  pinned: string[]
  opensOnMessage: boolean
  nodePath: string
}

function optionText(value: PluginOptions[string] | undefined, fallback: string): string {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : fallback
}

function readConfig(options: PluginOptions): Config {
  const minutes = Math.max(1, typeof options.alertWindowMinutes === 'number' ? options.alertWindowMinutes : 60)
  return {
    appToken: optionText(options.slackAppToken, ''),
    userToken: optionText(options.slackUserToken, ''),
    alertChannels: optionText(options.alertChannels, ''),
    eventChannels: optionText(options.eventChannels, ''),
    alertWindowMinutes: Math.round(minutes),
    alertWindowMs: minutes * MINUTE_MS,
    prodEnvironment: optionText(options.prodEnvironment, 'production'),
    pinned: parsePinned(options.pinnedSkills),
    opensOnMessage: options.openOnMessage !== false,
    nodePath: optionText(options.nodePath, 'node'),
  }
}

function isSame(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b)
}

function isTab(value: string): value is Tab {
  return TABS.some(entry => entry.id === value)
}

function inBackground($: Engine, work: Promise<unknown>): void {
  work.catch(error => $.ui.log(`cockpit: ${String(error)}`, { to: 'debug' }))
}

/** A toast in this session and a native notification, for something that happened outside it. */
async function announce($: Engine, text: string): Promise<void> {
  $.ui.toast(text, { timeoutMs: NOTICE_TOAST_MS })
  await $.ui.notify(text, { title: PANE_TITLE }).catch(() => undefined)
}

/** Takes what other sessions stored: the inbox, the alerts and the dismissed PRs. */
async function syncShared($: Engine): Promise<void> {
  const [storedInbox, storedMarks, storedAlerts, storedDismissed, storedSetup] = await Promise.all([
    $.store.get(INBOX_KEY),
    $.store.get(HANDLED_KEY),
    $.store.get(ALERTS_KEY),
    $.store.get(DISMISSED_KEY),
    $.store.get(SETUP_KEY),
  ])
  const next = { inbox: applyMarks(asInbox(storedInbox), asMarks(storedMarks)), alerts: asAlerts(storedAlerts), dismissed: asDismissed(storedDismissed) }
  const [shownInbox, shownAlerts, shownDismissed] = await Promise.all([read($, inbox), read($, alerts), read($, dismissed)])
  if (!isSame(shownInbox, next.inbox)) await update($, inbox, () => next.inbox)
  if (!isSame(shownAlerts, next.alerts)) await update($, alerts, () => next.alerts)
  if (!isSame(shownDismissed, next.dismissed)) await update($, dismissed, () => next.dismissed)
  const facts = asSetupFacts(storedSetup)
  if (!isSame(await read($, setupFacts), facts)) await update($, setupFacts, () => facts)
}

/** Records what the setup checklist learns, for every session. */
async function noteSetup($: Engine, learned: Partial<SetupFacts>): Promise<void> {
  const facts = { ...asSetupFacts(await $.store.get(SETUP_KEY)), ...learned }
  await $.store.set(SETUP_KEY, facts)
  await update($, setupFacts, () => facts)
}

async function showTab($: Engine, shown: Tab): Promise<void> {
  await update($, tab, () => shown)
  await $.ui.open({ id: PANE, title: PANE_TITLE })
}

async function takePullRequestMessage($: Engine, config: Config, message: SlackMessage): Promise<void> {
  // A message can arrive before the session's first board read; my own PRs must be known to leave them out.
  const boardBefore = await read($, board)
  if (boardBefore === null) await refreshBoard($, config, { isForced: false })
  const [storedInbox, storedMarks, shownBoard] = await Promise.all([$.store.get(INBOX_KEY), $.store.get(HANDLED_KEY), read($, board)])
  const marks = asMarks(storedMarks)
  const stored = applyMarks(asInbox(storedInbox), marks)
  const ownPrUrls = new Set((shownBoard?.prs ?? []).map(pr => pr.url))
  const { inbox: next, added } = addToInbox({ inbox: stored, message, marks, ownPrUrls })
  if (isSame(stored, next)) return
  await $.store.set(INBOX_KEY, next)
  await update($, inbox, () => next)
  if (added.length === 0) return
  await Promise.all(
    added.map(item => announce($, `${item.from} sent ${item.repo}#${item.number} in ${item.channel}. Review it from /cockpit.`)),
  )
  if (config.opensOnMessage) await showTab($, 'inbox')
}

async function askVerdict($: Engine, alertText: string, deployed: readonly BoardPr[]): Promise<Verdict> {
  const answer = await $.model.complete({
    model: VERDICT_MODEL,
    prompt: verdictPrompt(alertText, deployed),
    maxTokens: 300,
    timeoutMs: 30_000,
  })
  return parseVerdict(answer.isAnswered ? answer.text : '', deployed)
}

async function takeAlert($: Engine, config: Config, message: SlackMessage): Promise<void> {
  const isKnown = asAlerts(await $.store.get(ALERTS_KEY)).some(alert => alert.id === message.id)
  if (isKnown) return
  // The deploy this alert follows may be newer than the last poll.
  await refreshBoard($, config, { isForced: true })
  const prs = (await read($, board))?.prs ?? []
  const deployed = watchedDeploys(prs, message.at, config.alertWindowMs)
  const verdict = deployed.length === 0 ? null : await askVerdict($, message.text, deployed)
  const alert: Alert = {
    id: message.id,
    channel: message.channel,
    permalink: message.permalink,
    text: message.text.slice(0, ALERT_EXCERPT_LENGTH),
    at: message.at,
    prUrl: verdict?.prUrl ?? null,
    verdict: verdict?.verdict ?? null,
    reason: verdict?.reason ?? `No PR of yours reached production in the ${config.alertWindowMinutes} minutes before it.`,
  }
  const next = addAlert(asAlerts(await $.store.get(ALERTS_KEY)), alert)
  await $.store.set(ALERTS_KEY, next)
  await update($, alerts, () => next)
  if (verdict === null || !isRelated(verdict.verdict)) return
  const pr = prs.find(candidate => candidate.url === verdict.prUrl)
  const subject = pr === undefined ? 'your deploy' : `${pr.repo}#${pr.number}`
  await announce($, `Alert in ${alert.channel} after ${subject} deployed: ${VERDICT_LOOK[verdict.verdict].label.toLowerCase()}. See /cockpit alerts.`)
}

async function takeSidecarLine($: Engine, config: Config, line: string): Promise<void> {
  const parsed = parseSidecarLine(line)
  if (parsed === null) return
  if (parsed.kind === 'status') {
    await update($, slack, () => parsed.link)
    return
  }
  if (parsed.kind === 'event') {
    scheduleEventRead($, config)
    await noteSetup($, { lastEventAt: await $.clock.now() })
    return
  }
  if (parsed.message.isAlertChannel) await takeAlert($, config, parsed.message)
  else await takePullRequestMessage($, config, parsed.message)
}

/**
 * Runs the sidecar that holds the Socket Mode connection, for as long as the module lives:
 * the loop is the child's life, and a child that exits is started again after a wait.
 */
async function runSidecar($: Engine, config: Config): Promise<void> {
  await update($, slack, () => ({ state: 'starting', detail: '' }))
  const home = (await $.env.get('HOME')) ?? '/tmp'
  let ending = 'The Slack sidecar stopped; it restarts shortly.'
  try {
    const child = $.process.spawn({
      argv: [config.nodePath, `${$.plugin.root}/sidecar/slack-socket.mjs`],
      env: {
        SLACK_APP_TOKEN: config.appToken,
        SLACK_USER_TOKEN: config.userToken,
        COCKPIT_ALERT_CHANNELS: config.alertChannels,
        COCKPIT_EVENT_CHANNELS: config.eventChannels,
        COCKPIT_LOCK: `${home}/.claude/cockpit-slack.lock`,
      },
    })
    let buffered = ''
    for await (const piece of child) {
      if (piece.stream !== 'stdout') {
        $.ui.log(`cockpit: the Slack sidecar wrote: ${piece.text.trim()}`, { to: 'debug' })
        continue
      }
      const { lines, rest } = takeLines(buffered + piece.text)
      buffered = rest
      for (const line of lines) {
        try {
          await takeSidecarLine($, config, line)
        } catch (error) {
          $.ui.log(`cockpit: a Slack message was not handled: ${String(error)}`, { to: 'debug' })
        }
      }
    }
  } catch (error) {
    ending = `The Slack sidecar did not start with '${config.nodePath}': ${String(error)}`
  }
  const last = await read($, slack)
  if (last.state !== 'error') await update($, slack, () => ({ state: 'error', detail: ending }))
  $.clock.after(SIDECAR_RESTART_MS, () => inBackground($, runSidecar($, config)))
}

type PrsRead = { prs: BoardPr[] | null; error: string | null; quota: Board['quota']; isRateLimited: boolean }

async function readPrs($: Engine, config: Config, now: number): Promise<PrsRead> {
  const searches = boardSearches(now)
  let stdout: string
  try {
    const ran = await $.process.run(
      ['gh', 'api', 'graphql', '-f', `query=${BOARD_QUERY}`, '-f', `open=${searches.open}`, '-f', `merged=${searches.merged}`],
      { timeoutMs: 30_000 },
    )
    if (ran.exitCode !== 0) {
      const error = ran.stderr.trim().split('\n')[0] || 'gh could not read your PRs'
      return { prs: null, error, quota: null, isRateLimited: isRateLimited(ran) }
    }
    stdout = ran.stdout
  } catch (error) {
    return { prs: null, error: `gh did not run: ${String(error)}`, quota: null, isRateLimited: false }
  }
  try {
    return { prs: parseBoard(stdout, config.prodEnvironment), error: null, quota: parseQuota(stdout), isRateLimited: false }
  } catch (error) {
    return { prs: null, error: `GitHub's answer could not be read: ${String(error)}`, quota: null, isRateLimited: false }
  }
}

/** My tickets in progress, then the ones done in the last day: a day on, a done ticket leaves the board. A read that fails keeps the other's tickets. */
async function readTickets($: Engine): Promise<{ tickets: Board['tickets'] | null; error: string | null }> {
  const [started, done] = await Promise.all([
    readIssues($, { filter: { state: 'started' }, isDone: false }),
    readIssues($, { filter: { state: 'completed', completedAt: DONE_SHOWN_FOR }, isDone: true }),
  ])
  const loaded = [...(started.tickets ?? []), ...(done.tickets ?? [])]
  const isNoneLoaded = started.tickets === null && done.tickets === null
  return { tickets: isNoneLoaded ? null : loaded, error: started.error ?? done.error }
}

async function readIssues(
  $: Engine,
  { filter, isDone }: { filter: Record<string, string>; isDone: boolean },
): Promise<{ tickets: Board['tickets'] | null; error: string | null }> {
  let text: string
  try {
    const answer = await $.mcp.call(LINEAR_SERVER, 'list_issues', {
      assignee: 'me',
      ...filter,
      limit: 20,
      fields: ['title', 'url', 'status'],
    })
    text = answer.content.find(block => block.type === 'text')?.text ?? ''
    if (answer.isError) return { tickets: null, error: text.split('\n')[0] || 'Linear refused the read' }
  } catch (error) {
    return { tickets: null, error: `Linear did not answer: ${String(error)}` }
  }
  try {
    return { tickets: parseTickets({ answer: text, isDone }), error: null }
  } catch (error) {
    return { tickets: null, error: `Linear's answer could not be read: ${String(error)}` }
  }
}

let boardInFlight: Promise<void> | null = null

/** One board sync at a time in this session; a call during one waits for it. */
function refreshBoard($: Engine, config: Config, { isForced }: { isForced: boolean }): Promise<void> {
  boardInFlight ??= syncBoard($, config, { isForced }).finally(() => {
    boardInFlight = null
  })
  return boardInFlight
}

/**
 * Shows the board the machine's sessions share, and reads it from GitHub and Linear only when it is due, or forced,
 * and no other session holds the read: however many sessions poll, one of them reads. A forced read still yields to
 * another session's lease, whose board arrives on the next tick.
 */
async function syncBoard($: Engine, config: Config, { isForced }: { isForced: boolean }): Promise<void> {
  const [stored, now] = await Promise.all([$.store.get(BOARD_KEY), $.clock.now()])
  const shared = asSharedBoard(stored)
  if (shared !== null) await adoptBoard($, config, shared.board)
  const isDue = isForced || shared === null || now >= shared.nextReadAt
  if (!isDue) return
  const owner = await $.session.id()
  const isLeased = await takeLease($, { owner, now })
  if (!isLeased) return
  try {
    await readBoard($, config, { now, last: shared?.board ?? null })
  } finally {
    await releaseLease($, owner)
  }
}

/** Claims the read: writes the lease and reads it back, going on only if this session's claim is the one that stuck. */
async function takeLease($: Engine, { owner, now }: { owner: string; now: number }): Promise<boolean> {
  const held = asLease(await $.store.get(LEASE_KEY))
  if (isLeasedToOther({ lease: held, owner, now })) return false
  await $.store.set(LEASE_KEY, { owner, until: now + LEASE_MS } satisfies BoardLease)
  const claimed = asLease(await $.store.get(LEASE_KEY))
  return claimed?.owner === owner
}

async function releaseLease($: Engine, owner: string): Promise<void> {
  const held = asLease(await $.store.get(LEASE_KEY))
  if (held?.owner === owner) await $.store.delete(LEASE_KEY)
}

async function readBoard($: Engine, config: Config, { now, last }: { now: number; last: Board | null }): Promise<void> {
  const shown = last ?? (await read($, board))
  const [prs, tickets, link] = await Promise.all([readPrs($, config, now), readTickets($), read($, slack)])
  const quota = prs.isRateLimited ? exhaustedQuota(shown?.quota ?? null) : prs.quota
  const next: Board = {
    prs: prs.prs ?? shown?.prs ?? [],
    tickets: tickets.tickets ?? shown?.tickets ?? [],
    error: prs.error,
    ticketsError: tickets.error,
    readAt: now,
    quota,
  }
  const hasEvents = config.eventChannels !== '' && EVENT_LINK_STATES.has(link.state)
  await $.store.set(BOARD_KEY, { board: next, nextReadAt: nextReadAt({ quota, now, hasEvents }) } satisfies SharedBoard)
  await adoptBoard($, config, next)
}

/**
 * Shows a board newer than this session's, toasting what changed since the one it showed. Each session toasts
 * in its own terminal, as it did when each read its own board.
 */
async function adoptBoard($: Engine, config: Config, next: Board): Promise<void> {
  const shown = await read($, board)
  if (!isNewerBoard({ shown, shared: next })) return
  await update($, board, () => next)
  await refreshFocus($, next.tickets)
  for (const change of prChanges({ last: shown?.prs ?? null, next: next.prs })) {
    $.ui.toast(change, { timeoutMs: NOTICE_TOAST_MS })
  }
  for (const pr of newlyDeployed(shown?.prs ?? null, next.prs)) {
    $.ui.toast(`${pr.repo}#${pr.number} reached production. Alerts are compared to it for ${config.alertWindowMinutes}m.`, {
      timeoutMs: NOTICE_TOAST_MS,
    })
  }
}

let isEventReadScheduled = false

/** A Slack event in an event channel: one forced read once the burst it belongs to has passed. */
function scheduleEventRead($: Engine, config: Config): void {
  if (isEventReadScheduled) return
  isEventReadScheduled = true
  $.clock.after(EVENT_DEBOUNCE_MS, () => readAfterEvents($, config))
}

function readAfterEvents($: Engine, config: Config): void {
  isEventReadScheduled = false
  inBackground($, refreshBoard($, config, { isForced: true }))
}

async function refreshFocus($: Engine, tickets: readonly Ticket[]): Promise<void> {
  const found = await readFocus($, tickets)
  await update($, focus, () => found)
}

/** The ticket this session works on: the one the cmux workspace title names, else the one its branch names. */
async function readFocus($: Engine, tickets: readonly Ticket[]): Promise<Focus | null> {
  const teamKeys = teamKeysOf(tickets)
  const title = await readWorkspaceTitle($)
  const fromWorkspace = title === null ? null : ticketIdIn({ text: title, teamKeys })
  if (fromWorkspace !== null) return { ticketId: fromWorkspace, source: 'workspace' }
  const branch = await readBranch($)
  const fromBranch = branch === null ? null : ticketIdIn({ text: branch, teamKeys })
  return fromBranch === null ? null : { ticketId: fromBranch, source: 'branch' }
}

async function readWorkspaceTitle($: Engine): Promise<string | null> {
  const workspaceId = await $.env.get('CMUX_WORKSPACE_ID')
  const isOutsideCmux = workspaceId === undefined || workspaceId === ''
  if (isOutsideCmux) return null
  try {
    const ran = await $.process.run(['cmux', 'workspace', 'list', '--id-format', 'both', '--json'], {
      timeoutMs: 5_000,
      env: { CMUX_QUIET: '1' },
    })
    if (ran.exitCode !== 0) return null
    return workspaceTitle({ listing: ran.stdout, workspaceId })
  } catch (error) {
    $.ui.log(`cockpit: the cmux workspace title could not be read: ${String(error)}`, { to: 'debug' })
    return null
  }
}

async function readBranch($: Engine): Promise<string | null> {
  try {
    const ran = await $.process.run(['git', 'branch', '--show-current'], { timeoutMs: 5_000 })
    const branch = ran.stdout.trim()
    const isOnBranch = ran.exitCode === 0 && branch !== ''
    return isOnBranch ? branch : null
  } catch (error) {
    $.ui.log(`cockpit: the branch could not be read: ${String(error)}`, { to: 'debug' })
    return null
  }
}

/**
 * Squash-merges the PR through the API, so no local checkout is touched, then deletes its branch.
 * It names the head the board showed: a push since then makes GitHub refuse the merge.
 */
async function mergePr($: Engine, { config, pr }: { config: Config; pr: BoardPr }): Promise<void> {
  await update($, confirmingMerge, () => null)
  const label = `${pr.repo}#${pr.number}`
  try {
    const merged = await $.process.run([
      'gh', 'api', '-X', 'PUT', `repos/${pr.repo}/pulls/${pr.number}/merge`, '-f', 'merge_method=squash', '-f', `sha=${pr.headSha}`,
    ])
    if (merged.exitCode !== 0) {
      $.ui.toast(`${label} did not merge: ${merged.stderr.trim().split('\n')[0] || 'gh refused'}`, { timeoutMs: NOTICE_TOAST_MS })
      return
    }
  } catch (error) {
    $.ui.toast(`${label} did not merge: ${String(error)}`, { timeoutMs: NOTICE_TOAST_MS })
    return
  }
  $.ui.toast(`${label} merged.`, { timeoutMs: NOTICE_TOAST_MS })
  if (!pr.isFromFork) await deleteBranch($, pr)
  await refreshBoard($, config, { isForced: true })
}

async function deleteBranch($: Engine, pr: BoardPr): Promise<void> {
  try {
    const deleted = await $.process.run(['gh', 'api', '-X', 'DELETE', `repos/${pr.repo}/git/refs/heads/${pr.branch}`])
    if (deleted.exitCode !== 0) $.ui.log(`cockpit: the branch of ${pr.repo}#${pr.number} was not deleted: ${deleted.stderr.trim()}`, { to: 'debug' })
  } catch (error) {
    $.ui.log(`cockpit: the branch of ${pr.repo}#${pr.number} was not deleted: ${String(error)}`, { to: 'debug' })
  }
}

/** The first press arms Merge; a second press within the confirm window merges. */
async function pressMerge($: Engine, { config, pr }: { config: Config; pr: BoardPr }): Promise<void> {
  const [confirming, now] = await Promise.all([read($, confirmingMerge), $.clock.now()])
  if (isConfirming({ confirming, url: pr.url, now })) return mergePr($, { config, pr })
  await update($, confirmingMerge, () => ({ url: pr.url, at: now }))
}

function isConfirming({ confirming, url, now }: { confirming: PendingMerge | null; url: string; now: number }): boolean {
  return confirming !== null && confirming.url === url && now - confirming.at <= MERGE_CONFIRM_MS
}

async function moveToDone($: Engine, { config, ticket }: { config: Config; ticket: Ticket }): Promise<void> {
  try {
    const answer = await $.mcp.call(LINEAR_SERVER, 'save_issue', { id: ticket.id, state: DONE_STATE })
    if (answer.isError) {
      const reason = answer.content.find(block => block.type === 'text')?.text ?? 'Linear refused it'
      $.ui.toast(`${ticket.id} did not move to Done: ${reason.split('\n')[0]}`, { timeoutMs: NOTICE_TOAST_MS })
      return
    }
  } catch (error) {
    $.ui.toast(`${ticket.id} did not move to Done: ${String(error)}`, { timeoutMs: NOTICE_TOAST_MS })
    return
  }
  $.ui.toast(`${ticket.id} moved to Done.`, { timeoutMs: NOTICE_TOAST_MS })
  await refreshBoard($, config, { isForced: true })
}

let usageInFlight: Promise<void> | null = null
let isUsageStale = false

/** One usage read at a time, so an older reading never lands last; a call during a read runs one more after it. */
function refreshUsage($: Engine): Promise<void> {
  if (usageInFlight !== null) {
    isUsageStale = true
    return usageInFlight
  }
  usageInFlight = readUsage($).finally(() => {
    usageInFlight = null
    if (!isUsageStale) return
    isUsageStale = false
    inBackground($, refreshUsage($))
  })
  return usageInFlight
}

async function readUsage($: Engine): Promise<void> {
  // A summary breakdown is estimated locally, with no request, and is what knows the auto-compact threshold.
  const measured = await $.session.usage({ breakdown: 'summary' })
  await update($, usage, () => ({
    context: contextGauge(measured.context),
    limits: usageLimits(measured.rateLimits),
    costUsd: measured.cost?.usd ?? null,
  }))
}

async function loadSkills($: Engine, config: Config): Promise<void> {
  const next = skillButtons(config.pinned, asCounts(await $.store.get(SKILL_COUNTS_KEY)))
  const shown = await read($, skills)
  if (!isSame(shown, next)) await update($, skills, () => next)
}

async function countSkill($: Engine, config: Config, skill: string): Promise<void> {
  const stored = asCounts(await $.store.get(SKILL_COUNTS_KEY))
  const counts = { ...stored, [skill]: (stored[skill] ?? 0) + 1 }
  await $.store.set(SKILL_COUNTS_KEY, counts)
  const next = skillButtons(config.pinned, counts)
  const shown = await read($, skills)
  if (!isSame(shown, next)) await update($, skills, () => next)
}

/**
 * Runs a slash command as if the person typed it, once the session is idle.
 * Not awaited: a skill's command resolves only when its whole turn has run.
 */
function runSlash($: Engine, line: string): void {
  const [command = '', ...args] = line.replace(/^\//, '').split(' ')
  inBackground($, $.command.run({ command, args: args.join(' ') }))
}

async function compact($: Engine): Promise<void> {
  try {
    const result = await $.session.compact()
    if ('skip' in result) $.ui.toast(`The compaction was stopped: ${result.skip}`)
  } catch (error) {
    $.ui.toast(`Compact did not run: ${String(error)}`)
  }
  await refreshUsage($)
}

/** Calls one Slack Web API method as the person, through their user token, and toasts what went wrong. */
async function callSlack($: Engine, { config, method, body }: { config: Config; method: string; body: Record<string, string> }): Promise<boolean> {
  try {
    const answer = await $.http.fetch(`${SLACK_API}/${method}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${config.userToken}`, 'Content-Type': 'application/json; charset=utf-8' },
      body: JSON.stringify(body),
    })
    const refusal = slackRefusal({ status: answer.status, text: answer.text })
    const scopes = scopesShown(answer.text)
    if (scopes !== null) await noteSetup($, { scopes })
    if (refusal !== null) $.ui.toast(`Slack ${method} failed: ${refusal}.`, { timeoutMs: NOTICE_TOAST_MS })
    return refusal === null
  } catch (error) {
    $.ui.toast(`Slack ${method} failed: ${String(error)}`, { timeoutMs: NOTICE_TOAST_MS })
    return false
  }
}

async function reactTo($: Engine, { config, target, name }: { config: Config; target: SlackTarget; name: string }): Promise<void> {
  const address = slackAddress(target.messageId)
  if (address === null) return
  const isSent = await callSlack($, { config, method: 'reactions.add', body: { channel: address.channel, timestamp: address.ts, name } })
  if (isSent) $.ui.toast(`Reacted :${name}: in Slack.`)
}

async function replyTo($: Engine, { config, target, text }: { config: Config; target: SlackTarget; text: string }): Promise<void> {
  const thread = slackAddress(target.threadId)
  if (thread === null) return
  if (text.trim() === '') return
  const isSent = await callSlack($, { config, method: 'chat.postMessage', body: { channel: thread.channel, thread_ts: thread.ts, text } })
  if (!isSent) return
  await update($, replyingTo, () => null)
  await update($, replyDraft, () => '')
  $.ui.toast('Replied in the Slack thread.')
}

async function toggleReply($: Engine, rowKey: string): Promise<void> {
  const open = await read($, replyingTo)
  await update($, replyDraft, () => '')
  await update($, replyingTo, () => (open === rowKey ? null : rowKey))
}

async function handleInboxItem($: Engine, item: InboxItem, handledBy: Reviewer | 'dismissed'): Promise<void> {
  // Stamped with the message's own Slack time, not this machine's clock: a later post reopens it, whatever the skew.
  const marks = markHandled(asMarks(await $.store.get(HANDLED_KEY)), { prUrl: item.prUrl, by: handledBy, at: item.at })
  await $.store.set(HANDLED_KEY, marks)
  await update($, inbox, shown => applyMarks(shown, marks))
  if (handledBy !== 'dismissed') runSlash($, `${REVIEW_SKILL[handledBy]} ${item.prUrl}`)
}

async function toggleAskReview($: Engine, rowKey: string): Promise<void> {
  const open = await read($, askingReviewFor)
  await update($, reviewerDraft, () => '')
  await update($, askingReviewFor, () => (open === rowKey ? null : rowKey))
}

/** Asks the named teammate on Slack to review the PR, through the skill that checks it is ready first. */
async function askForReview($: Engine, { pr, name }: { pr: BoardPr; name: string }): Promise<void> {
  const reviewer = name.trim()
  if (reviewer === '') return
  runSlash($, `${ASK_REVIEW_SKILL} ${pr.url} ${reviewer}`)
  await update($, askingReviewFor, () => null)
  await update($, reviewerDraft, () => '')
}

async function setDismissed($: Engine, url: string, isDismissed: boolean): Promise<void> {
  const known = asDismissed(await $.store.get(DISMISSED_KEY)).filter(other => other !== url)
  const next = isDismissed ? [url, ...known].slice(0, 200) : known
  await $.store.set(DISMISSED_KEY, next)
  await update($, dismissed, () => next)
}

function prLabel(pr: BoardPr): string {
  return `${pr.repo.split('/')[1] ?? pr.repo}#${pr.number}`
}

function stateWord(pr: BoardPr): string {
  if (pr.state === 'OPEN') return pr.isDraft ? 'draft' : 'open'
  return pr.deployedAt === null ? 'merged' : 'in prod'
}

async function investigate($: Engine, alert: Alert): Promise<void> {
  try {
    await $.command.run({ command: INVESTIGATE_SKILL, args: investigateArgs(alert) })
  } catch (error) {
    $.ui.toast(`/${INVESTIGATE_SKILL} did not start (${String(error)}). It ships in the dev-workflows plugin.`)
  }
}

function resetNote({ resetsAt, now }: { resetsAt: number | null; now: number }): string | null {
  return resetsAt === null || resetsAt <= now ? null : `↻${age(now, resetsAt)}`
}

/** Tokens left before auto-compact, so its coming is plain; or that it is off. */
function compactNote(context: ContextGauge): string | null {
  if (context.tokensToCompact !== null) return `⇣${kiloTokens(context.tokensToCompact)} to compact`
  return context.isAutoCompactOff ? 'no auto-compact' : null
}

// A /config change reloads this module, which ends the sidecar and starts it with the new options.
export const register: Register = (on, options) => {
  const config = readConfig(options)
  const hasSlack = config.appToken !== '' && config.userToken !== ''

  on('session.start', async ($, e, next) => {
    await $.command.register(COMMAND)
    const started = await next(e)
    // On timers, not in this dispatch, so the first prompt does not wait on gh, Linear or the store.
    $.clock.after(0, () => {
      inBackground($, syncShared($))
      inBackground($, refreshBoard($, config, { isForced: false }))
      inBackground($, refreshUsage($))
      inBackground($, loadSkills($, config))
    })
    $.clock.every(SHARED_POLL_MS, () => inBackground($, syncShared($)))
    $.clock.every(BOARD_TICK_MS, () => inBackground($, refreshBoard($, config, { isForced: false })))
    if (hasSlack) inBackground($, runSidecar($, config))
    return started
  })

  on('command.run', { command: 'cockpit' }, async ($, e) => {
    const asked = e.args.trim().toLowerCase()
    if (isTab(asked)) await update($, tab, () => asked)
    await $.ui.open({ id: PANE, title: PANE_TITLE, focus: true })
    inBackground($, refreshBoard($, config, { isForced: true }))
    const shown = await read($, board)
    inBackground($, refreshFocus($, shown?.tickets ?? []))
    return { text: 'The cockpit is in the pane.' }
  })

  on('turn.complete', async ($, e, next) => {
    const completed = await next(e)
    if (e.agentId === undefined) inBackground($, refreshUsage($))
    return completed
  })

  on('session.measure', async ($, e, next) => {
    const measured = await next(e)
    if (e.changed.includes('rateLimits')) {
      const limits = usageLimits(e.rateLimits)
      await update($, usage, last => (last === null ? null : { ...last, limits }))
    }
    return measured
  })

  on('skill.prompt', async ($, e, next) => {
    const prompted = await next(e)
    inBackground($, countSkill($, config, e.skill))
    return prompted
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text, Button, Link, Input } = $.ui.resolve(e)
    const [storedTab, items, shownBoard, shownAlerts, hidden, openReply, draft, confirming, askingFor, reviewerName, facts, link, now] = await Promise.all([
      read($, tab),
      read($, inbox),
      read($, board),
      read($, alerts),
      read($, dismissed),
      read($, replyingTo),
      read($, replyDraft),
      read($, confirmingMerge),
      read($, askingReviewFor),
      read($, reviewerDraft),
      read($, setupFacts),
      read($, slack),
      $.clock.now(),
    ])
    // A tab an earlier version stored may no longer exist.
    const shownTab: Tab = isTab(storedTab) ? storedTab : 'inbox'
    const unhandled = waiting(items)
    const stepsLeft = setupSteps({
      hasTokens: hasSlack,
      link: link.state,
      alertChannels: config.alertChannels,
      eventChannels: config.eventChannels,
      facts,
      now,
    }).filter(step => !step.isDone)
    const openPrs = (shownBoard?.prs ?? []).filter(pr => isOnBoard({ pr, now }) && !hidden.includes(pr.url))
    const failing = openPrs.filter(pr => pr.state === 'OPEN' && pr.checks.some(check => check.state === 'fail')).length
    const related = shownAlerts.filter(alert => alert.verdict !== null && isRelated(alert.verdict)).length
    const badges: Record<Tab, { text: string; color: ThemeKey | null }> = {
      inbox: { text: unhandled.length > 0 ? ` ${unhandled.length}` : '', color: 'claude' },
      prs: failing > 0 ? { text: ` ${openPrs.length} ✗${failing}`, color: 'error' } : { text: ` ${openPrs.length}`, color: null },
      alerts: { text: related > 0 ? ` ${related}` : '', color: 'error' },
      skills: { text: '', color: null },
    }

    function heading(label: string) {
      return (
        <Text key={`heading-${label}`}>
          <Text color="claude">▍</Text>
          <Text bold>{label}</Text>
        </Text>
      )
    }

    /** React, reply in the thread, or open the message: one row under any Slack message. */
    function slackActions(target: SlackTarget) {
      const { rowKey, permalink } = target
      const openLink = <Link href={permalink} label="↗ Open in Slack" />
      const canAct = hasSlack && slackAddress(target.messageId) !== null
      if (!canAct) return <Box key={`slack-${rowKey}`}>{openLink}</Box>
      return (
        <Box key={`slack-${rowKey}`} flexDirection="column">
          <Box flexDirection="row" gap={1}>
            {QUICK_REACTIONS.map(reaction => (
              <Button
                key={`react-${reaction.name}-${rowKey}`}
                plain
                label={reaction.glyph}
                onPress={() => reactTo($, { config, target, name: reaction.name })}
              />
            ))}
            <Button
              key={`reply-${rowKey}`}
              plain
              dimColor={openReply !== rowKey}
              label="↩ Reply"
              onPress={() => toggleReply($, rowKey)}
            />
            {openLink}
          </Box>
          {openReply === rowKey && (
            <Input
              key={`reply-text-${rowKey}`}
              placeholder="Reply in the thread"
              submitLabel="Send"
              autoFocus
              value={draft}
              onInput={text => update($, replyDraft, () => text)}
              onSubmit={text => replyTo($, { config, target, text })}
            />
          )}
        </Box>
      )
    }

    function drawInbox() {
      const handled = items.filter(item => item.handledBy !== null).slice(0, 5)
      return (
        <Box flexDirection="column">
          {!hasSlack && (
            <Text dimColor wrap="wrap">
              Slack is off. Save the app-level token and the user token with claude plugin configure
              cockpit@yaniv-claude-config --values-stdin; the README has the steps and the app manifest.
            </Text>
          )}
          {hasSlack && unhandled.length === 0 && <Text dimColor>No PR is waiting.</Text>}
          {unhandled.map((item, index) => (
            <Box key={item.prUrl} flexDirection="column">
              <Text wrap="truncate-end">
                <Link href={item.prUrl} label={`${item.repo}#${item.number}`} />
                <Text dimColor> · </Text>
                <Link href={item.permalink} label={`${item.from} in ${item.channel}`} />
                <Text dimColor> · {age(item.at, now)} ago</Text>
              </Text>
              <Text dimColor wrap="truncate-end">
                {item.excerpt}
              </Text>
              <Box flexDirection="row" gap={1}>
                <Button
                  key={`claude-${item.prUrl}`}
                  hotkey={index === 0 ? 'c' : undefined}
                  variant="primary"
                  label="Claude"
                  onPress={() => handleInboxItem($, item, 'claude')}
                />
                <Button
                  key={`codex-${item.prUrl}`}
                  hotkey={index === 0 ? 'o' : undefined}
                  label="Codex"
                  onPress={() => handleInboxItem($, item, 'codex')}
                />
                <Button
                  key={`dismiss-${item.prUrl}`}
                  hotkey={index === 0 ? 'd' : undefined}
                  label="Dismiss"
                  onPress={() => handleInboxItem($, item, 'dismissed')}
                />
              </Box>
              {slackActions({ rowKey: item.prUrl, messageId: item.messageId, threadId: item.threadId, permalink: item.permalink })}
              <Text> </Text>
            </Box>
          ))}
          {handled.length > 0 && heading('Handled')}
          {handled.map(item => (
            <Text key={`handled-${item.prUrl}`} dimColor wrap="truncate-end">
              <Link href={item.prUrl} label={`${item.repo}#${item.number}`} />{' '}
              {item.handledBy === 'dismissed' ? 'dismissed' : `sent to ${item.handledBy}`} · {item.from}
            </Text>
          ))}
          {hasSlack && (
            <Text wrap="wrap">
              {'\n'}
              <Text color={SLACK_LOOK[link.state]}>●</Text>
              <Text dimColor>
                {' '}
                Slack {link.state}
                {link.detail === '' ? '' : ` · ${link.detail}`}
              </Text>
            </Text>
          )}
        </Box>
      )
    }

    function drawAskReview({ key, rowKey }: { key: string; rowKey: string }) {
      return <Button key={key} plain dimColor={askingFor !== rowKey} label="📣 Ask review" onPress={() => toggleAskReview($, rowKey)} />
    }

    /** The field a reviewer's name is typed in, under the row whose Ask review was pressed. */
    function drawReviewerField({ rowKey, pr }: { rowKey: string; pr: BoardPr }) {
      if (askingFor !== rowKey) return null
      return (
        <Input
          key={`ask-review-name-${rowKey}`}
          placeholder="Who should review it? (a name)"
          submitLabel="Ask"
          autoFocus
          value={reviewerName}
          onInput={text => update($, reviewerDraft, () => text)}
          onSubmit={name => askForReview($, { pr, name })}
        />
      )
    }

    function drawReviewer(reviewer: BoardReviewer) {
      const look = REVIEWER_LOOK[reviewer.state]
      const label = ` ${look.mark}${reviewer.name}`
      if (look.color === null) return <Text key={`reviewer-${reviewer.name}`} dimColor>{label}</Text>
      return <Text key={`reviewer-${reviewer.name}`} color={look.color}>{label}</Text>
    }

    function drawPolish({ key, pr }: { key: string; pr: BoardPr }) {
      return <Button key={key} plain label="✦ Polish" onPress={() => runSlash($, `${POLISH_SKILL} ${pr.url}`)} />
    }

    function toggleExpanded(url: string) {
      return update($, expanded, last => (last === url ? null : url))
    }

    function drawPr(pr: BoardPr, isOpen: boolean) {
      const counts = countChecks(pr.checks)
      const ticket = ticketOf(pr, shownBoard?.tickets ?? [])
      const isHidden = hidden.includes(pr.url)
      const waitingThreads = pr.threads.filter(thread => !thread.isReplied).length
      const repliedThreads = pr.threads.length - waitingThreads
      return (
        <Box key={pr.url} flexDirection="column">
          <Box flexDirection="row" gap={1}>
            <Button
              key={`expand-${pr.url}`}
              plain
              label={isOpen ? '▾' : '▸'}
              onPress={() => toggleExpanded(pr.url)}
            />
            <Button
              key={`hide-${pr.url}`}
              plain
              label={isHidden ? '↺' : '✕'}
              onPress={() => setDismissed($, pr.url, !isHidden)}
            />
            {pr.state === 'OPEN' && drawPolish({ key: `polish-${pr.url}`, pr })}
            {pr.state === 'OPEN' && drawAskReview({ key: `ask-review-${pr.url}`, rowKey: pr.url })}
            {isReadyToMerge(pr) && (
              <Button
                key={`merge-${pr.url}`}
                plain
                label={isConfirming({ confirming, url: pr.url, now }) ? '⏎ Confirm merge' : '⇪ Merge'}
                onPress={() => pressMerge($, { config, pr })}
              />
            )}
            <Text wrap="truncate-end">
              <Link href={pr.url} label={prLabel(pr)} />
              {pr.state === 'MERGED' && pr.deployedAt !== null && (
                <Text color="success" bold>
                  {' '}
                  in prod {age(pr.deployedAt, now)}
                </Text>
              )}
              {pr.state === 'MERGED' && pr.deployedAt === null && (
                <Text color="merged">
                  {' '}
                  merged{pr.mergedAt === null ? '' : ` ${age(pr.mergedAt, now)}`}
                  {pr.hasDeploys ? ', not in prod' : ''}
                </Text>
              )}
              {pr.state === 'OPEN' && pr.isDraft && <Text dimColor> draft</Text>}
              {pr.state === 'OPEN' && pr.reviewDecision === 'APPROVED' && <Text color="success"> approved</Text>}
              {pr.state === 'OPEN' && pr.reviewDecision === 'CHANGES_REQUESTED' && <Text color="error"> changes requested</Text>}
              {pr.state === 'OPEN' && pr.hasConflicts && <Text color="error"> conflicts</Text>}
              {pr.state === 'OPEN' &&
                (['fail', 'pending', 'pass'] as const).map(
                  state =>
                    counts[state] > 0 && (
                      <Text key={state} color={CHECK_LOOK[state].color}>
                        {' '}
                        {CHECK_LOOK[state].mark}
                        {counts[state]}
                      </Text>
                    ),
                )}
              {pr.state === 'OPEN' && pr.reviewers.length > 0 && <Text dimColor> ·</Text>}
              {pr.state === 'OPEN' && pr.reviewers.map(drawReviewer)}
              {waitingThreads > 0 && <Text color="warning"> · {waitingThreads} open</Text>}
              {repliedThreads > 0 && <Text dimColor> · {repliedThreads} replied</Text>}
              {ticket !== null && (
                <Text>
                  {' · '}
                  <Link href={ticket.url} label={ticket.id} />
                </Text>
              )}
              <Text dimColor> · {pr.title}</Text>
            </Text>
          </Box>
          {drawReviewerField({ rowKey: pr.url, pr })}
          {isOpen && (
            <Box flexDirection="column" paddingLeft={4}>
              {pr.checks
                .filter(check => check.state !== 'pass')
                .map(check => (
                  <Text key={`check-${check.name}`} wrap="truncate-end">
                    <Text color={CHECK_LOOK[check.state].color}>{CHECK_LOOK[check.state].mark}</Text>{' '}
                    {check.url === null ? check.name : <Link href={check.url} label={check.name} />}
                  </Text>
                ))}
              {pr.threads.length === 0 && <Text dimColor>No open review threads.</Text>}
              {pr.threads.map((thread, index) => {
                const where = `${thread.path}${thread.line === null ? '' : `:${thread.line}`}`
                return (
                  <Text key={`thread-${index}`} wrap="wrap">
                    {thread.url === null ? <Text color="suggestion">{where}</Text> : <Link href={thread.url} label={where} />}{' '}
                    <Text dimColor>{thread.author}:</Text> {thread.excerpt}
                    {thread.isReplied && <Text dimColor> (replied)</Text>}
                  </Text>
                )
              })}
              {pr.state === 'OPEN' && (
                <Box flexDirection="row" gap={1}>
                  {pr.threads.length > 0 && (
                    <Button
                      key={`address-${pr.url}`}
                      label="Address feedback"
                      onPress={() => runSlash($, `/pr-workflows:address-pr-feedback ${pr.url}`)}
                    />
                  )}
                  {counts.fail > 0 && (
                    <Button
                      key={`ci-${pr.url}`}
                      label="Fix CI"
                      onPress={() => runSlash($, `/pr-workflows:verify-pr-state ${pr.url}`)}
                    />
                  )}
                </Box>
              )}
            </Box>
          )}
        </Box>
      )
    }

    function toggleTicket(ticketId: string) {
      return update($, openTicket, last => (last === ticketId ? null : ticketId))
    }

    function drawTicketPr({ ticketId, pr }: { ticketId: string; pr: BoardPr }) {
      const rowKey = `${ticketId} ${pr.url}`
      return (
        <Box key={`ticket-pr-${ticketId}-${pr.url}`} flexDirection="column">
          <Box flexDirection="row" gap={1}>
            {pr.state === 'OPEN' && drawPolish({ key: `ticket-polish-${ticketId}-${pr.url}`, pr })}
            {pr.state === 'OPEN' && drawAskReview({ key: `ticket-ask-review-${ticketId}-${pr.url}`, rowKey })}
            <Text wrap="truncate-end">
              <Link href={pr.url} label={prLabel(pr)} />
              <Text color={pr.state === 'OPEN' ? 'warning' : 'merged'}> {stateWord(pr)}</Text>
              <Text dimColor> · {pr.title}</Text>
            </Text>
          </Box>
          {drawReviewerField({ rowKey, pr })}
        </Box>
      )
    }

    function drawTicket({ ticket, isOpen, focusId }: { ticket: Ticket; isOpen: boolean; focusId: string | null }) {
      const ticketPrs = openPrs.filter(pr => namesTicket({ pr, ticketId: ticket.id }))
      const isLeftOpen = isMergedButOpen({ ticket, prs: shownBoard?.prs ?? [] })
      const canOpenWorkspace = !ticket.isDone && ticket.id !== focusId
      return (
        <Box key={ticket.id} flexDirection="column">
          <Box flexDirection="row" gap={1}>
            <Button key={`ticket-${ticket.id}`} plain label={isOpen ? '▾' : '▸'} onPress={() => toggleTicket(ticket.id)} />
            {isLeftOpen && (
              <Button key={`done-${ticket.id}`} plain label="✓ Move to Done" onPress={() => moveToDone($, { config, ticket })} />
            )}
            <Text wrap="truncate-end">
              {ticket.isDone ? <Text color="success">✓ </Text> : <Text color="warning">● </Text>}
              <Link href={ticket.url} label={ticket.id} /> <Text dimColor>{ticket.status}</Text>
              {isLeftOpen && <Text color="warning"> ⚑ PR merged</Text>}
              {ticket.id === focusId && <Text color="claude"> ◆ here</Text>}
              {ticketPrs.length > 0 && <Text color="suggestion"> · {ticketPrs.length} PR{ticketPrs.length === 1 ? '' : 's'}</Text>}{' '}
              {ticket.isDone ? <Text dimColor>{ticket.title}</Text> : ticket.title}
            </Text>
          </Box>
          {isOpen && (
            <Box flexDirection="column" paddingLeft={4}>
              {canOpenWorkspace && (
                <Box flexDirection="row">
                  <Button
                    key={`workspace-${ticket.id}`}
                    plain
                    label="⧉ Open a workspace for it"
                    onPress={() => runSlash($, `${WORKSPACE_SKILL} ${ticket.id}`)}
                  />
                </Box>
              )}
              {ticketPrs.length === 0 && <Text dimColor>No open PRs, none merged in the last day.</Text>}
              {ticketPrs.map(pr => drawTicketPr({ ticketId: ticket.id, pr }))}
            </Box>
          )}
        </Box>
      )
    }

    function drawFocusLine({ focused, showsAll }: { focused: Focus; showsAll: boolean }) {
      return (
        <Box key="focus-line" flexDirection="row" gap={1}>
          <Text dimColor>{FOCUS_SOURCE[focused.source]}</Text>
          <Button
            key="all-prs"
            plain
            label={showsAll ? `Only ${focused.ticketId}` : `All PRs (${openPrs.length})`}
            onPress={() => update($, isShowingAllPrs, last => !last)}
          />
        </Box>
      )
    }

    async function drawPrs() {
      const [openUrl, showsHidden, focused, showsAll, expandedTicket] = await Promise.all([
        read($, expanded),
        read($, isShowingDismissed),
        read($, focus),
        read($, isShowingAllPrs),
        read($, openTicket),
      ])
      if (shownBoard === null) return <Text dimColor>Reading your PRs…</Text>
      const hiddenPrs = shownBoard.prs.filter(pr => isOnBoard({ pr, now }) && hidden.includes(pr.url))
      const focusId = focused?.ticketId ?? null
      const isFiltered = focusId !== null && !showsAll
      const listed = isFiltered ? openPrs.filter(pr => namesTicket({ pr, ticketId: focusId })) : openPrs
      const slowedNote = quotaNote(shownBoard.quota)
      return (
        <Box flexDirection="column">
          {heading('Tickets')}
          {shownBoard.ticketsError !== null && <Text dimColor>{shownBoard.ticketsError}</Text>}
          {shownBoard.ticketsError === null && shownBoard.tickets.length === 0 && <Text dimColor>None.</Text>}
          {shownBoard.tickets.map(ticket => drawTicket({ ticket, isOpen: ticket.id === expandedTicket, focusId }))}
          <Text> </Text>
          {heading(isFiltered ? `Pull requests · ${focusId}` : 'Pull requests')}
          {focused !== null && drawFocusLine({ focused, showsAll })}
          {shownBoard.error !== null && <Text color="error">{shownBoard.error}</Text>}
          {shownBoard.error === null && listed.length === 0 && (
            <Text dimColor>{isFiltered ? `No PRs for ${focusId} yet.` : 'None open, none merged in the last day.'}</Text>
          )}
          {listed.map(pr => drawPr(pr, pr.url === openUrl))}
          {showsHidden && hiddenPrs.length > 0 && heading('Dismissed')}
          {showsHidden && hiddenPrs.map(pr => drawPr(pr, false))}
          <Text> </Text>
          <Box flexDirection="row" gap={1}>
            <Button key="refresh" hotkey="r" label="Refresh" onPress={() => inBackground($, refreshBoard($, config, { isForced: true }))} />
            {hiddenPrs.length > 0 && (
              <Button
                key="dismissed"
                label={showsHidden ? 'Hide dismissed' : `Show dismissed (${hiddenPrs.length})`}
                onPress={() => update($, isShowingDismissed, last => !last)}
              />
            )}
            <Text dimColor>read {age(shownBoard.readAt, now)} ago</Text>
            {slowedNote !== null && <Text color="warning">· {slowedNote}</Text>}
          </Box>
        </Box>
      )
    }

    /** What the cockpit still needs set up, each with what to do; nothing once all is done. */
    function drawSetup(steps: readonly SetupStep[]) {
      if (steps.length === 0) return null
      return (
        <Box key="setup" flexDirection="column">
          {heading('Setup')}
          {steps.map(step => (
            <Text key={`setup-${step.id}`} wrap="wrap">
              <Text color="warning">○ {step.label}</Text>
              <Text dimColor> · {step.todo}</Text>
            </Text>
          ))}
          <Text> </Text>
        </Box>
      )
    }

    function drawSetupHint(steps: readonly SetupStep[]) {
      const isHidden = steps.length === 0 || shownTab === SETUP_TAB
      if (isHidden) return null
      const hotkey = TABS.find(entry => entry.id === SETUP_TAB)?.hotkey ?? ''
      return (
        <Text key="setup-hint" color="warning" wrap="truncate-end">
          ⚠ Setup: {steps.length} step{steps.length === 1 ? '' : 's'} left · press {hotkey}
        </Text>
      )
    }

    function drawAlerts() {
      const watched = (shownBoard?.prs ?? []).filter(
        pr => pr.deployedAt !== null && now - pr.deployedAt <= config.alertWindowMs,
      )
      return (
        <Box flexDirection="column">
          {drawSetup(stepsLeft)}
          {watched.map(pr => (
            <Text key={`watch-${pr.url}`} color="warning" wrap="truncate-end">
              Watching {pr.repo}#{pr.number} for {age(now, (pr.deployedAt ?? now) + config.alertWindowMs)} more
            </Text>
          ))}
          {config.alertChannels !== '' && shownAlerts.length === 0 && <Text dimColor>No alert yet.</Text>}
          {shownAlerts.map(alert => (
            <Box key={alert.id} flexDirection="column">
              <Text wrap="truncate-end">
                {alert.verdict === null ? (
                  <Text dimColor>no deploy</Text>
                ) : (
                  <Text color={VERDICT_LOOK[alert.verdict].color} bold>
                    {VERDICT_LOOK[alert.verdict].label}
                  </Text>
                )}{' '}
                <Link href={alert.permalink} label={alert.channel} />
                <Text dimColor> {age(alert.at, now)} ago</Text>
                {alert.prUrl !== null && (
                  <Text>
                    {' · '}
                    <Link href={alert.prUrl} label={alert.prUrl.replace('https://github.com/', '').replace('/pull/', '#')} />
                  </Text>
                )}
              </Text>
              <Text wrap="truncate-end">{excerptOf(alert.text)}</Text>
              <Text dimColor wrap="wrap">
                {alert.reason}
              </Text>
              {slackActions({ rowKey: alert.id, messageId: alert.id, threadId: alert.id, permalink: alert.permalink })}
              <Box flexDirection="row">
                <Button key={`investigate-${alert.id}`} label="🔎 Investigate" onPress={() => void investigate($, alert)} />
              </Box>
              <Text> </Text>
            </Box>
          ))}
        </Box>
      )
    }

    async function drawSkills() {
      const buttons = await read($, skills)
      return (
        <Box flexDirection="column">
          {buttons.length === 0 && (
            <Text dimColor wrap="wrap">
              No skill has loaded yet. Pin your own under cockpit in /config, as pr-workflows:pr-polish, simplify.
            </Text>
          )}
          {buttons.map((button, index) => (
            <Box key={button.prompt} flexDirection="row" gap={1}>
              <Button
                key={`skill-${button.prompt}`}
                hotkey={SKILL_HOTKEYS[index]}
                label={`/${button.prompt}`}
                onPress={() => runSlash($, `/${button.prompt}`)}
              />
              <Text dimColor>{button.isPinned ? 'pinned' : `${button.count}×`}</Text>
            </Box>
          ))}
        </Box>
      )
    }

    /** One quiet line on every tab: each limit with its reset, the context window and the session's cost. */
    async function drawUsageStrip() {
      const shown = await read($, usage)
      if (shown === null) return <Text dimColor>Reading the usage…</Text>
      const gauges = [
        ...shown.limits.map(limit => ({ label: limit.label, percent: limit.percent, note: resetNote({ resetsAt: limit.resetsAt, now }) })),
        ...(shown.context === null ? [] : [{ label: 'Ctx', percent: shown.context.percent, note: compactNote(shown.context) }]),
      ]
      const isEmpty = gauges.length === 0 && shown.costUsd === null
      if (isEmpty) return null
      const width = stripBarWidth({ columns: e.props.bodyColumns, gauges: gauges.length })
      return (
        <Box borderStyle="round" borderColor="subtle" paddingX={1}>
          <Text wrap="truncate-end">
            {gauges.map((gauge, index) => (
              <Text key={gauge.label}>
                {index > 0 && <Text dimColor> · </Text>}
                <Text dimColor>{gauge.label} </Text>
                {width > 0 && <Text color={usageColor(gauge.percent)}>{bar(gauge.percent, width)} </Text>}
                <Text color={usageColor(gauge.percent)}>{gauge.percent}%</Text>
                {gauge.note !== null && <Text dimColor> {gauge.note}</Text>}
              </Text>
            ))}
            {shown.costUsd !== null && <Text dimColor> · ${shown.costUsd.toFixed(2)}</Text>}
          </Text>
        </Box>
      )
    }

    function drawTabChip(entry: (typeof TABS)[number]) {
      const badge = badges[entry.id]
      const isShown = entry.id === shownTab
      return (
        <Button key={`tab-${entry.id}`} plain hotkey={entry.hotkey} label={`${entry.label}${badge.text}`} onPress={() => update($, tab, () => entry.id)}>
          {isShown ? (
            <Text inverse bold color="claude">
              {` ${entry.label}${badge.text} `}
            </Text>
          ) : (
            <Text>
              <Text dimColor>{` ${entry.label}`}</Text>
              {badge.color === null ? <Text dimColor>{badge.text}</Text> : <Text bold color={badge.color}>{badge.text}</Text>}{' '}
            </Text>
          )}
        </Button>
      )
    }

    async function drawTab() {
      switch (shownTab) {
        case 'inbox':
          return drawInbox()
        case 'prs':
          return drawPrs()
        case 'alerts':
          return drawAlerts()
        case 'skills':
          return drawSkills()
        default:
          return drawInbox()
      }
    }

    return (
      <Box flexDirection="column">
        <Box flexDirection="row" gap={2} flexWrap="wrap">
          {TABS.map(entry => drawTabChip(entry))}
          <Button key="compact" plain dimColor label="⇣ Compact" onPress={() => compact($)} />
        </Box>
        {await drawUsageStrip()}
        {drawSetupHint(stepsLeft)}
        {await drawTab()}
      </Box>
    )
  })
}
