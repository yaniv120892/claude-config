import { atom, read, update } from 'claude-code'
import type { CommandSpec, EngineInterface as Engine, Register, ToolCallResult, ToolResultOf } from 'claude-code'

import type { Band, GitLocation, PlanTask, UsageLimit } from '../types'
import { gitWrites, OPT_OUT } from './branch-guard'
import { credentialReason, findCredential, findTerm, parseTerms, termPattern, termReason } from './credentials'
import { LAST_ACTIVE_KEY_PREFIX, LAST_ACTIVE_TTL_MS, parseUtcOffset, promptClock, slowToolNote } from './clock'
import { isGitWrite, runsGit } from './git-write'
import { addTask, freshTasks, fromTodos, PLAN_KEY_PREFIX, planCount, planTitle, summarize, updateTask } from './plan'
import { basename } from './text'
import { asTally, countSkill, formatTally } from './tally'
import { alertText, asAlertedWindows, markAlerted, notAlertedYet, pastAlertLine, usageLimits } from './usage'

// Every hook lives in this file: the engine follows `$` only into functions
// declared beside the hook that passes it. The pure logic sits in the files
// imported above, which is what the tests cover.

const band = atom({ plugin: 'mods', key: 'band' } as const, null, { shape: 'band-5' })
const planTasks = atom({ plugin: 'mods', key: 'planTasks' } as const, [], { shape: 'plan-tasks-1' })

const DEFAULT_BRANCH_CANDIDATES = ['main', 'master']

/**
 * Refuses a git commit or push that would land on the repository's default branch.
 * A guard that cannot read the session steps aside.
 */
async function guardDefaultBranch($: Engine, command: string): Promise<{ deny: string } | null> {
  if (!isGitWrite(command)) return null
  try {
    return await refuseDefaultBranchWrite($, command)
  } catch (error) {
    $.ui.log(`mods: the default-branch guard stepped aside: ${String(error)}`, { to: 'debug' })
    return null
  }
}

async function refuseDefaultBranchWrite($: Engine, command: string): Promise<{ deny: string } | null> {
  const writes = gitWrites(command, await $.session.cwd(), (await $.env.get('HOME')) ?? null)
  for (const write of writes) {
    if (write.isOptedOut || write.directory === null) continue
    const branch = await git($, write.directory, ['symbolic-ref', '--quiet', '--short', 'HEAD'])
    if (branch?.exitCode !== 0 || !branch.stdout) continue
    const base = await defaultBranch($, write.directory)
    if (branch.stdout !== base) continue
    if (write.deletedBranches?.every(deleted => deleted !== base)) continue
    return { deny: defaultBranchRefusal(branch.stdout) }
  }
  return null
}

async function defaultBranch($: Engine, directory: string): Promise<string | null> {
  const head = await git($, directory, ['symbolic-ref', '--quiet', '--short', 'refs/remotes/origin/HEAD'])
  if (head?.exitCode === 0 && head.stdout) return head.stdout.replace(/^origin\//, '')
  for (const candidate of DEFAULT_BRANCH_CANDIDATES) {
    const found = await git($, directory, ['rev-parse', '--verify', '--quiet', `refs/remotes/origin/${candidate}`])
    if (found?.exitCode === 0) return candidate
  }
  return null
}

function defaultBranchRefusal(branch: string): string {
  return [
    `BLOCKED: you are on '${branch}', the default branch.`,
    '',
    'Commits and pushes go on a feature branch, then through a PR that is squash-merged: that keeps the',
    'base branch one commit per shipped change, and a push here cannot be undone without a force-push.',
    '',
    '  git checkout -b <type>/<slug>',
    '  git commit ...',
    '  git push -u origin HEAD',
    '',
    `If this genuinely belongs on '${branch}', say so by prefixing the git command with ${OPT_OUT}.`,
  ].join('\n')
}

// Bash calls a few hundred milliseconds apart share one refresh.
const BAND_SETTLE_MS = 300

function isSame(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b)
}

/** git, without the optional index lock, so it never contends with the model's own git. */
async function git($: Engine, cwd: string, args: string[]): Promise<{ exitCode: number; stdout: string } | null> {
  try {
    const ran = await $.process.run(['git', '--no-optional-locks', ...args], { cwd, timeoutMs: 5000 })
    return { exitCode: ran.exitCode, stdout: ran.stdout.trim() }
  } catch {
    return null
  }
}

/** Null on a detached HEAD, or where git cannot say. */
async function currentBranch($: Engine, cwd: string): Promise<string | null> {
  const branch = await git($, cwd, ['branch', '--show-current'])
  return branch?.exitCode === 0 && branch.stdout ? branch.stdout : null
}

async function readLocation($: Engine): Promise<GitLocation> {
  const [cwd, repo] = await Promise.all([$.session.cwd(), $.session.repo()])
  if (repo === null) return { repo: null, dir: basename(cwd), branch: null, isDirty: false }
  const [branch, status] = await Promise.all([currentBranch($, cwd), git($, cwd, ['status', '--porcelain'])])
  return { repo: basename(repo.root), dir: basename(cwd), branch, isDirty: Boolean(status?.stdout) }
}

/** One toast per limit per window, kept across sessions so a new session does not repeat it. */
async function alertLimits($: Engine, limits: readonly UsageLimit[]): Promise<void> {
  const nearCap = pastAlertLine(limits)
  if (nearCap.length === 0) return
  const alerted = asAlertedWindows(await $.store.get(ALERTED_KEY))
  const due = notAlertedYet(nearCap, alerted)
  if (due.length === 0) return
  await $.store.set(ALERTED_KEY, markAlerted(alerted, due))
  const now = await $.clock.now()
  for (const limit of due) $.ui.toast(alertText(limit, now), { timeoutMs: ALERT_TOAST_MS })
}

/** Restores the plan a resumed session left, and drops every session's plan past its day. */
async function loadPlans($: Engine): Promise<void> {
  const [id, now, keys] = await Promise.all([$.session.id(), $.clock.now(), $.store.keys()])
  planSession = id
  for (const key of keys.filter(key => key.startsWith(PLAN_KEY_PREFIX))) {
    const tasks = freshTasks(await $.store.get(key), now)
    if (tasks === null) await $.store.delete(key)
    else if (key === `${PLAN_KEY_PREFIX}${id}`) await update($, planTasks, () => tasks)
  }
}

/** The plan's session id; after a /clear or /resume the atom is reloaded from that session's stored plan. */
async function syncPlanSession($: Engine): Promise<string> {
  const id = await $.session.id()
  if (id === planSession) return id
  planSession = id
  const tasks = freshTasks(await $.store.get(`${PLAN_KEY_PREFIX}${id}`), await $.clock.now())
  await update($, planTasks, () => tasks ?? [])
  return id
}

/** Applies one main-loop task call to the plan, in call order, and stores it under the session's id. */
function changePlan($: Engine, change: (tasks: readonly PlanTask[]) => PlanTask[]): Promise<void> {
  planWrites = planWrites
    .then(async () => {
      const id = await syncPlanSession($)
      const last = await read($, planTasks)
      const tasks = change(last)
      if (isSame(last, tasks)) return
      await update($, planTasks, () => tasks)
      await $.store.set(`${PLAN_KEY_PREFIX}${id}`, { tasks, updatedAt: await $.clock.now() })
    })
    .catch(error => $.ui.log(`mods: ${String(error)}`, { to: 'debug' }))
  return planWrites
}

/** The tool's record, or null when it was refused or reported an error: such a call leaves the plan as it was. */
function answerOf<Name extends string>(ran: ToolCallResult<Name>): ToolResultOf<Name> | null {
  return ran.deny === undefined && ran.isError === undefined ? ran.result : null
}

const ALERTED_KEY = 'alertedWindows'
const ALERT_TOAST_MS = 10_000

// The module's own, so a reload starts them over; that only drops a queued refresh.
let isBandQueued = false
// Set by register, which a /config change reruns.
let isAlerting = true
// Task calls in one turn can run in parallel; each change lands after the one before.
let planWrites: Promise<void> = Promise.resolve()
// The session the plan atom was loaded for; null until the first load.
let planSession: string | null = null

function inBackground($: Engine, work: Promise<void>): void {
  work.catch(error => $.ui.log(`mods: ${String(error)}`, { to: 'debug' }))
}

async function refreshBand($: Engine): Promise<void> {
  const [location, modelName] = await Promise.all([readLocation($), $.session.model()])
  const next: Band = { location, model: modelName }
  const last = await read($, band)
  if (isSame(last, next)) return
  await update($, band, () => next)
}

function queueBandRefresh($: Engine): void {
  if (isBandQueued) return
  isBandQueued = true
  $.clock.after(BAND_SETTLE_MS, () => {
    isBandQueued = false
    inBackground($, refreshBand($))
  })
}

/**
 * Where the path really lands, symlinks resolved (`~/.claude/rules` links
 * into this repo, and git sees the link's spelling as outside it): the closest
 * part of it that exists, resolved, plus the rest, so a file in folders not
 * made yet is placed too. Undefined when not even its root resolves.
 */
async function placed($: Engine, path: string): Promise<string | undefined> {
  const absolute = path.startsWith('/') ? path : `${await $.session.cwd()}/${path}`
  let existing = absolute
  let rest = ''
  for (;;) {
    const found = await $.fs.stat(existing, { resolve: true }).catch(() => undefined)
    if (found?.realPath !== undefined) return `${found.realPath.replace(/\/$/, '')}${rest}`
    const cut = existing.lastIndexOf('/')
    if (cut <= 0) return undefined
    rest = `${existing.slice(cut)}${rest}`
    existing = existing.slice(0, cut)
  }
}

async function existingFolder($: Engine, file: string): Promise<string> {
  let folder = file.slice(0, file.lastIndexOf('/')) || '/'
  while (folder !== '/' && !(await $.fs.exists(folder).catch(() => false))) {
    folder = folder.slice(0, folder.lastIndexOf('/')) || '/'
  }
  return folder
}

/**
 * Whether git would track the file: inside a work tree and not ignored. A file
 * the guard cannot place, or a git that cannot run, counts as tracked, so the
 * guard fails closed.
 */
async function isTracked($: Engine, file: string | undefined): Promise<boolean> {
  if (file === undefined) return true
  const folder = await existingFolder($, file)
  const ran = await git($, folder, ['check-ignore', '-q', '--', file])
  // 0: ignored. 1: not ignored. 128: outside a work tree.
  return ran === null || ran.exitCode === 1
}

async function isMarketplaceRepo($: Engine, file: string): Promise<boolean> {
  const folder = await existingFolder($, file)
  const root = await git($, folder, ['rev-parse', '--show-toplevel'])
  if (root?.exitCode !== 0) return false
  return $.fs.exists(`${root.stdout}/.claude-plugin/marketplace.json`).catch(() => false)
}

async function guardEdit($: Engine, path: string, text: string, terms: RegExp | null): Promise<{ deny: string } | null> {
  const credential = findCredential(text)
  const term = findTerm(text, terms)
  if (credential === null && term === null) return null

  const file = await placed($, path)
  if (credential !== null && (await isTracked($, file))) return { deny: credentialReason(path, credential) }
  // A file the guard cannot place may still land in a marketplace repo.
  if (term !== null && (file === undefined || (await isMarketplaceRepo($, file)))) return { deny: termReason(path, term) }
  return null
}

/** When the guard broke before the edit ran: a credential still refuses it. */
function guardFailed(isCalled: boolean, path: string, text: string): { deny: string } | null {
  const credential = isCalled ? null : findCredential(text)
  return credential === null ? null : { deny: credentialReason(path, credential) }
}

const REPLY_STYLE_SECTION = 'mods:reply-style'
// `bare` is the stripped prompt of `--bare`, which writes no styled replies.
const NO_REPLY_TRAITS = new Set(['bare'])
const TALLY_KEY = 'skillTally'
const TALLY_COMMAND: CommandSpec = {
  name: 'skill-tally',
  description: 'Show how often each skill has loaded, across sessions',
  argumentHint: '[reset]',
}

/** Minutes east of UTC from the host's `date`, which follows its DST; the module's own Date may not know the zone. */
async function utcOffset($: Engine, now: number): Promise<number> {
  try {
    const offset = parseUtcOffset((await $.process.run(['date', '+%z'], { timeoutMs: 2000 })).stdout)
    if (offset !== null) return offset
  } catch {}
  return -new Date(now).getTimezoneOffset()
}

async function markActive($: Engine): Promise<void> {
  const [id, now] = await Promise.all([$.session.id(), $.clock.now()])
  await $.store.set(`${LAST_ACTIVE_KEY_PREFIX}${id}`, now)
}

async function dropStaleActivity($: Engine): Promise<void> {
  const [now, keys] = await Promise.all([$.clock.now(), $.store.keys()])
  for (const key of keys.filter(key => key.startsWith(LAST_ACTIVE_KEY_PREFIX))) {
    const at = await $.store.get(key)
    if (typeof at !== 'number' || now - at > LAST_ACTIVE_TTL_MS) await $.store.delete(key)
  }
}

// A /config change reloads this module, so a mod switched off registers nothing.
export const register: Register = (on, options) => {
  const isOn = (name: string): boolean => options[name] !== false
  const hasBranchGuard = isOn('branchGuard')
  const hasStatusBand = isOn('statusBand')
  isAlerting = isOn('alerts')
  const hasPlanProgress = isOn('planProgress') && hasStatusBand
  const hasTimeAwareness = isOn('timeAwareness')
  const blockedTerms = termPattern(parseTerms(options.blockedTerms))
  const hasSkillTally = isOn('skillTally')

  on('session.start', async ($, e, next) => {
    if (hasSkillTally) await $.command.register(TALLY_COMMAND)
    const started = await next(e)
    // On a timer, not in this dispatch, so the first prompt does not wait on git.
    if (hasStatusBand) $.clock.after(0, () => inBackground($, refreshBand($)))
    if (hasPlanProgress) $.clock.after(0, () => inBackground($, loadPlans($)))
    if (hasTimeAwareness) $.clock.after(0, () => inBackground($, dropStaleActivity($)))
    return started
  })

  on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
    const refusal = hasBranchGuard ? await guardDefaultBranch($, e.command) : null
    if (refusal !== null) return refusal
    const ran = await next(e)
    // Other commands that move the branch are caught when the turn ends.
    if (hasStatusBand && runsGit(e.command)) queueBandRefresh($)
    return ran
  }).catch(($, e, next) =>
    // A refresh that broke after the call hands its result on (`next` is replay-safe).
    next(e),
  )

  if (isAlerting) {
    // A window can cross the line mid-turn, while the model runs tools.
    on('session.measure', async ($, e, next) => {
      const measured = await next(e)
      if (e.changed.includes('rateLimits')) await alertLimits($, usageLimits(e.rateLimits))
      return measured
    })
  }

  if (hasStatusBand || hasTimeAwareness) {
    on('turn.complete', async ($, e, next) => {
      const completed = await next(e)
      if (e.agentId === undefined && hasStatusBand) queueBandRefresh($)
      if (e.agentId === undefined && hasTimeAwareness) inBackground($, markActive($))
      return completed
    })
  }

  if (hasStatusBand) {
    on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
      const shown = await read($, band)
      if (e.props.hasSurvey || shown === null) return next(e)

      const { Box, Text } = $.ui.resolve(e)
      const { location: here, model: modelName } = shown
      const place = here.repo !== null && here.repo !== here.dir ? `${here.repo}/${here.dir}` : here.dir
      const plan = hasPlanProgress ? summarize(await read($, planTasks)) : null
      const activeTitle = plan === null ? null : planTitle(plan, e.props.bodyColumns)

      return (
        <Box flexDirection="column">
          <Text wrap="truncate-end">
            <Text color="green" bold>
              ➜{'  '}
            </Text>
            <Text color="cyan">{place}</Text>
            {here.branch !== null && (
              <Text>
                {' '}
                <Text color="blue" bold>
                  git:(
                </Text>
                <Text color="red">{here.branch}</Text>
                <Text color="blue" bold>
                  )
                </Text>
                {here.isDirty && <Text color="yellow"> ✗</Text>}
              </Text>
            )}
            <Text color="magenta"> [{modelName}]</Text>
          </Text>
          {plan !== null && (
            <Text wrap="truncate-end">
              <Text color={plan.phase === 'building' ? 'yellow' : undefined} dimColor={plan.phase !== 'building'}>
                {planCount(plan)}
              </Text>
              {activeTitle !== null && <Text> · {activeTitle}</Text>}
            </Text>
          )}
        </Box>
      )
    })
  }

  if (hasPlanProgress) {
    // A subagent's task calls are its own plan: counting them would inflate the main one.
    on('tool.call', { tool: 'TodoWrite' }, async ($, e, next) => {
      const ran = await next(e)
      if (e.agentId === undefined && answerOf(ran) !== null) await changePlan($, () => fromTodos(e.todos))
      return ran
    }).catch(($, e, next) => next(e))

    on('tool.call', { tool: 'TaskCreate' }, async ($, e, next) => {
      const ran = await next(e)
      const id = answerOf(ran)?.task.id
      if (e.agentId === undefined && id !== undefined) await changePlan($, tasks => addTask(tasks, id, e.subject))
      return ran
    }).catch(($, e, next) => next(e))

    on('tool.call', { tool: 'TaskUpdate' }, async ($, e, next) => {
      const ran = await next(e)
      if (e.agentId === undefined && answerOf(ran)?.success === true) {
        await changePlan($, tasks => updateTask(tasks, e))
      }
      return ran
    }).catch(($, e, next) => next(e))

    on('session.end', async ($, e, next) => {
      // The process goes on under another session after /clear or /resume; its next task call loads that plan.
      if (e.reason === 'clear' || e.reason === 'resume') {
        planSession = null
        await update($, planTasks, () => [])
      }
      return next(e)
    })
  }

  if (isOn('ruleGuard')) {
    on('tool.call', { tool: 'Write' }, async ($, e, next) => (await guardEdit($, e.file_path, e.content, blockedTerms)) ?? next(e))
      .catch(($, e, next) => guardFailed(next.called, e.file_path, e.content) ?? next(e))
    on('tool.call', { tool: 'Edit' }, async ($, e, next) => (await guardEdit($, e.file_path, e.new_string, blockedTerms)) ?? next(e))
      .catch(($, e, next) => guardFailed(next.called, e.file_path, e.new_string) ?? next(e))
    on('tool.call', { tool: 'NotebookEdit' }, async ($, e, next) => (await guardEdit($, e.notebook_path, e.new_source, blockedTerms)) ?? next(e))
      .catch(($, e, next) => guardFailed(next.called, e.notebook_path, e.new_source) ?? next(e))
  }

  // A section of every request, not one early message, so compaction cannot
  // drop it. Codex reads the same file through scripts/agents_md.py.
  if (isOn('replyStyle')) {
    let replyStyle: string | null = null
    on('prompt.compose', async ($, e, next) => {
      const composed = await next(e)
      if (e.traits.some(trait => NO_REPLY_TRAITS.has(trait))) return composed
      try {
        replyStyle ??= String(await $.fs.read(`${$.plugin.root}/prompts/reply-style.md`)).trim()
      } catch {
        return composed
      }
      return { sections: [...composed.sections, { id: REPLY_STYLE_SECTION, text: replyStyle, scope: 'session' }] }
    })
  }

  if (hasSkillTally) {
    on('skill.prompt', async ($, e, next) => {
      const prompted = await next(e)
      const now = new Date(await $.clock.now()).toISOString()
      await $.store.set(TALLY_KEY, countSkill(asTally(await $.store.get(TALLY_KEY)), e.skill, now))
      return prompted
    })

    on('command.run', { command: 'skill-tally' }, async ($, e) => {
      if (e.args.trim() === 'reset') {
        await $.store.delete(TALLY_KEY)
        return { text: 'Skill tally cleared.' }
      }
      const known = (await $.command.list())
        .filter(command => command.source === 'plugin' && command.name.includes(':'))
        .map(command => command.name)
      return { text: formatTally(asTally(await $.store.get(TALLY_KEY)), known) }
    })
  }

  // Stored by session id, not in $.state, so a `claude --resume` days later still knows when the session last ran.
  if (hasTimeAwareness) {
    on('prompt.submit', async ($, e, next) => {
      const [id, now] = await Promise.all([$.session.id(), $.clock.now()])
      const stored = await $.store.get(`${LAST_ACTIVE_KEY_PREFIX}${id}`)
      const clock = promptClock(now, await utcOffset($, now), typeof stored === 'number' ? stored : null)
      await $.store.set(`${LAST_ACTIVE_KEY_PREFIX}${id}`, now)
      return next({ ...e, context: [...(e.context ?? []), clock] })
    })
    // duration_ms is the tool's own run time, without the permission prompt or other hooks.
    on('classic.PostToolUse', async ($, e, next) => {
      const ran = await next(e)
      const note = slowToolNote(e.tool_name, e.duration_ms)
      return note === null ? ran : { ...ran, additionalContext: [...(ran.additionalContext ?? []), note] }
    })
    on('classic.PostToolUseFailure', async ($, e, next) => {
      const ran = await next(e)
      const note = slowToolNote(e.tool_name, e.duration_ms)
      return note === null ? ran : { ...ran, additionalContext: [...(ran.additionalContext ?? []), note] }
    })
  }
}
