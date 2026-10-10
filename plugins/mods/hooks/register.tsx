import { atom, read, update } from 'claude-code'
import type { CommandSpec, EngineInterface as Engine, Register } from 'claude-code'

import type { Band, GitLocation, PrRead, PrThread } from '../types'
import { credentialReason, findCredential, findTerm, parseTerms, termPattern, termReason } from './credentials'
import { changesPr, GATED_COMMANDS, isGitWrite, runsGit } from './git-write'
import {
  basename,
  CHECK,
  CHECK_STATES,
  countChecks,
  parsePrView,
  parseThreads,
  PR_FIELDS,
  prViewError,
  THREADS_QUERY,
} from './pr-data'
import { asTally, countSkill, formatTally } from './tally'
import { truncate } from './text'
import { usageColor, usageLimits } from './usage'

// Every hook lives in this file: the engine follows `$` only into functions
// declared beside the hook that passes it. The pure logic sits in the files
// imported above, which is what the tests cover.

const gitGrant = atom({ plugin: 'mods', key: 'gitGrant' } as const, false)
const band = atom({ plugin: 'mods', key: 'band' } as const, null, { shape: 'band-2' })
const prRead = atom({ plugin: 'mods', key: 'prRead' } as const, null)

const GIT_GATE_COMMAND: CommandSpec = {
  name: 'git-gate',
  description: 'Show the git write gate, or reset its session approval',
  argumentHint: '[reset]',
}
const ONCE = 'Allow once'
const SESSION = 'Allow for this session'
const DENY = 'Deny'
const SHOWN_COMMAND_LENGTH = 200

// The dialog is the person's to answer, never the model's. "Allow for this
// session" holds until `/git-gate reset` or the session ends.
async function gateGitWrite($: Engine, command: string): Promise<{ deny: string } | null> {
  if (!isGitWrite(command) || (await read($, gitGrant))) return null

  let answer: string
  try {
    answer = await $.ui.ask(
      `Claude wants to run a git/gh write:\n\n${truncate(command, SHOWN_COMMAND_LENGTH)}\n\nRun it?`,
      { header: 'Git write', options: [ONCE, SESSION, DENY] },
    )
  } catch {
    return {
      deny:
        'BLOCKED: git/gh writes need the user to approve them in a dialog, and none could be shown ' +
        '(a headless run, or the dialog was dismissed). Tell the user what you want to run and stop.',
    }
  }

  if (answer === SESSION) {
    await update($, gitGrant, () => true)
    return null
  }
  if (answer === ONCE) return null
  const note = answer === DENY ? '' : ` They said: ${answer}`
  return { deny: `BLOCKED: the user declined this git/gh write.${note} Do not retry it unless they ask.` }
}

const PR_POLL_MS = 90_000
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

async function readLocation($: Engine): Promise<GitLocation> {
  const [cwd, repo] = await Promise.all([$.session.cwd(), $.session.repo()])
  if (repo === null) return { repo: null, dir: basename(cwd), branch: null, isDirty: false }
  const [branch, status] = await Promise.all([
    git($, cwd, ['branch', '--show-current']),
    git($, cwd, ['status', '--porcelain']),
  ])
  return {
    repo: basename(repo.root),
    dir: basename(cwd),
    branch: branch?.exitCode === 0 && branch.stdout ? branch.stdout : null,
    isDirty: Boolean(status?.stdout),
  }
}

async function storePr($: Engine, found: PrRead): Promise<void> {
  if (!isSame(await read($, prRead), found)) await update($, prRead, () => found)
}

async function readPr($: Engine): Promise<PrRead> {
  const here = (await read($, band))?.location
  if (here !== undefined && here.branch === null) return { pr: null, error: null }

  const cwd = await $.session.cwd()
  let view
  try {
    view = await $.process.run(['gh', 'pr', 'view', '--json', PR_FIELDS], { cwd, timeoutMs: 15000 })
  } catch {
    return { pr: null, error: 'gh is not installed' }
  }
  if (view.exitCode !== 0) return { pr: null, error: prViewError(view.stderr) }

  const parsed = parsePrView(view.stdout)
  let threads: PrThread[] = []
  try {
    const answer = await $.process.run(
      [
        'gh', 'api', 'graphql',
        '-f', `query=${THREADS_QUERY}`,
        '-F', 'owner={owner}',
        '-F', 'repo={repo}',
        '-F', `number=${parsed.number}`,
      ],
      { cwd, timeoutMs: 15000 },
    )
    if (answer.exitCode === 0) threads = parseThreads(answer.stdout)
  } catch {
    // The checks still show; the threads read as none.
  }
  return { pr: { ...parsed, threads }, error: null }
}

// The module's own, so a reload starts them over; that only drops a queued refresh.
let isBandQueued = false
let prInFlight: Promise<void> | null = null
let isPrRereadWanted = false

/**
 * One PR read at a time. A call during a read asks for one more after it, since
 * the branch may have moved since that read began; it resolves after both.
 */
function refreshPr($: Engine): Promise<void> {
  if (prInFlight !== null) {
    isPrRereadWanted = true
    return prInFlight
  }
  prInFlight = (async () => {
    do {
      isPrRereadWanted = false
      await storePr($, await readPr($))
    } while (isPrRereadWanted)
  })().finally(() => {
    prInFlight = null
  })
  return prInFlight
}

function inBackground($: Engine, work: Promise<void>): void {
  work.catch(error => $.ui.log(`mods: ${String(error)}`, { to: 'debug' }))
}

/** Rereads the band; a branch switch rereads the PR too. */
async function refreshBand($: Engine): Promise<void> {
  const [location, modelName, usage] = await Promise.all([readLocation($), $.session.model(), $.session.usage()])
  const { percent } = usage.context
  const next: Band = {
    location,
    model: modelName,
    contextPercent: percent === undefined ? null : Math.round(percent),
    usageLimits: usageLimits(usage.rateLimits),
  }
  const last = await read($, band)
  if (isSame(last, next)) return
  await update($, band, () => next)
  if (last !== null && last.location.branch !== location.branch) inBackground($, refreshPr($))
}

function queueBandRefresh($: Engine): void {
  if (isBandQueued) return
  isBandQueued = true
  $.clock.after(BAND_SETTLE_MS, () => {
    isBandQueued = false
    inBackground($, refreshBand($))
  })
}

const PANE = 'mods-pr'
const PR_COMMAND: CommandSpec = {
  name: 'pr',
  description: "Show this branch's PR: checks, open review threads, and the PR skills",
}
const PR_ACTIONS = [
  { key: 'address', hotkey: 'a', label: 'Address feedback', prompt: '/pr-workflows:address-pr-feedback' },
  { key: 'verify', hotkey: 'v', label: 'Verify state', prompt: '/pr-workflows:verify-pr-state' },
  { key: 'finalize', hotkey: 'f', label: 'Finalize', prompt: '/pr-workflows:finalize-pr' },
] as const

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

// A /config change reloads this module, so a mod switched off registers nothing.
export const register: Register = (on, options) => {
  const isOn = (name: string): boolean => options[name] !== false
  const hasGitGate = isOn('gitGate')
  const hasStatusBand = isOn('statusBand')
  const blockedTerms = termPattern(parseTerms(options.blockedTerms))
  const commands = [
    ...(hasGitGate ? [GIT_GATE_COMMAND] : []),
    ...(isOn('prPane') ? [PR_COMMAND] : []),
    ...(isOn('skillTally') ? [TALLY_COMMAND] : []),
  ]

  on('session.start', async ($, e, next) => {
    await Promise.all(commands.map(command => $.command.register(command)))
    const started = await next(e)
    if (hasStatusBand) {
      // On timers, not in this dispatch, so the first prompt does not wait on git or gh.
      $.clock.after(0, () => {
        inBackground($, refreshBand($))
        inBackground($, refreshPr($))
      })
      $.clock.every(PR_POLL_MS, () => inBackground($, refreshPr($)))
    }
    return started
  })

  on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
    const refusal = hasGitGate ? await gateGitWrite($, e.command) : null
    if (refusal !== null) return refusal
    const ran = await next(e)
    // Other commands that move the branch are caught when the turn ends.
    if (hasStatusBand && runsGit(e.command)) {
      queueBandRefresh($)
      if (changesPr(e.command)) $.clock.after(0, () => inBackground($, refreshPr($)))
    }
    return ran
  }).catch(($, e, next) =>
    // A gate that broke fails closed; a refresh that broke after the call
    // hands its result on (`next` is replay-safe).
    next.called || !hasGitGate || !isGitWrite(e.command)
      ? next(e)
      : { deny: `BLOCKED: the git write gate failed (${String(next.error)}), so the write did not run.` },
  )

  if (hasGitGate) {
    on('command.run', { command: 'git-gate' }, async ($, e) => {
      if (e.args.trim() === 'reset') {
        await update($, gitGrant, () => false)
        return { text: 'Git write gate: session approval revoked. The next write asks again.' }
      }
      return {
        text: (await read($, gitGrant))
          ? 'Git write gate: writes are approved for this session. /git-gate reset revokes that.'
          : `Git write gate: each ${GATED_COMMANDS.join(', ')} asks first.`,
      }
    })
  }

  if (hasStatusBand) {
    on('turn.complete', async ($, e, next) => {
      const completed = await next(e)
      if (e.agentId === undefined) queueBandRefresh($)
      return completed
    })

    // A window can move a point mid-turn, while the model runs tools. Only the
    // limits are patched: the rest of the band is reread when the turn ends.
    on('session.measure', async ($, e, next) => {
      const measured = await next(e)
      if (e.changed.includes('rateLimits')) {
        const limits = usageLimits(e.rateLimits)
        await update($, band, last => (last === null ? null : { ...last, usageLimits: limits }))
      }
      return measured
    })

    on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
      const shown = await read($, band)
      if (e.props.hasSurvey || shown === null) return next(e)

      const { Box, Text } = $.ui.resolve(e)
      const { location: here, model: modelName, contextPercent: percent, usageLimits: limits } = shown
      const current = (await read($, prRead))?.pr ?? null
      const counts = countChecks(current?.checks ?? [])
      const threads = current?.threads.length ?? 0
      const place = here.repo !== null && here.repo !== here.dir ? `${here.repo}/${here.dir}` : here.dir

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
            {percent !== null && <Text color={usageColor(percent)}> ctx:{percent}%</Text>}
            {limits.map(limit => (
              <Text key={limit.label} color={usageColor(limit.percent)}>
                {' '}
                {limit.label}:{limit.percent}%
              </Text>
            ))}
          </Text>
          {current !== null && (
            <Text wrap="truncate-end">
              <Text dimColor>PR </Text>
              <Text bold>#{current.number}</Text>
              {current.isDraft && <Text dimColor> draft</Text>}
              {current.state !== 'OPEN' && <Text color="magenta"> {current.state.toLowerCase()}</Text>}
              {(['fail', 'pending', 'pass'] as const).map(
                state =>
                  counts[state] > 0 && (
                    <Text color={CHECK[state].color}>
                      {' '}
                      {CHECK[state].mark}
                      {counts[state]}
                    </Text>
                  ),
              )}
              {threads > 0 && (
                <Text color="yellow">
                  {' '}
                  · {threads} open thread{threads === 1 ? '' : 's'}
                </Text>
              )}
              {current.mergeable === 'CONFLICTING' && <Text color="red"> · conflicts</Text>}
              {current.reviewDecision === 'APPROVED' && <Text color="green"> · approved</Text>}
              {current.reviewDecision === 'CHANGES_REQUESTED' && <Text color="red"> · changes requested</Text>}
              <Text dimColor> · {current.title}</Text>
            </Text>
          )}
        </Box>
      )
    })
  }

  if (isOn('prPane')) {
    on('command.run', { command: 'pr' }, async $ => {
      await $.ui.open({ id: PANE, title: 'Pull request' })
      await refreshPr($)
      const current = (await read($, prRead))?.pr ?? null
      return { text: current === null ? 'No PR for this branch yet.' : `PR #${current.number} is in the pane.` }
    })

    on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
      const { Box, Text, Button, Link } = $.ui.resolve(e)
      const last = await read($, prRead)
      const refresh = <Button key="refresh" hotkey="r" label="Refresh" onPress={() => inBackground($, refreshPr($))} />

      if (last?.pr == null) {
        return (
          <Box flexDirection="column">
            <Text dimColor>{last === null ? 'Reading the PR…' : (last.error ?? 'No PR for this branch.')}</Text>
            {refresh}
          </Box>
        )
      }

      const current = last.pr
      const checks = [...current.checks].sort((a, b) => CHECK_STATES.indexOf(a.state) - CHECK_STATES.indexOf(b.state))
      const counts = countChecks(current.checks)
      return (
        <Box flexDirection="column">
          <Text bold wrap="wrap">
            #{current.number} {current.title}
          </Text>
          <Link key="url" href={current.url} label={current.url} />
          <Text>
            <Text color={current.state === 'OPEN' ? 'green' : 'magenta'}>{current.state.toLowerCase()}</Text>
            {current.isDraft && <Text dimColor> · draft</Text>}
            {current.mergeable === 'CONFLICTING' ? (
              <Text color="red"> · merge conflicts</Text>
            ) : (
              <Text> · {current.mergeable.toLowerCase()}</Text>
            )}
            {current.reviewDecision !== null && (
              <Text> · {current.reviewDecision.toLowerCase().replace('_', ' ')}</Text>
            )}
          </Text>

          <Text bold>
            {'\n'}Checks{(['fail', 'pending', 'pass'] as const).map(state => ` ${CHECK[state].mark}${counts[state]}`)}
          </Text>
          {checks.length === 0 && <Text dimColor>No checks reported.</Text>}
          {checks.map(check => (
            <Text wrap="truncate-end">
              <Text color={CHECK[check.state].color}>{CHECK[check.state].mark}</Text> {check.name}
            </Text>
          ))}

          <Text bold>
            {'\n'}Open threads ({current.threads.length})
          </Text>
          {current.threads.length === 0 && <Text dimColor>None.</Text>}
          {current.threads.map(thread => (
            <Text wrap="truncate-end">
              <Text color="cyan">
                {thread.path}
                {thread.line === null ? '' : `:${thread.line}`}
              </Text>{' '}
              <Text dimColor>{thread.author}:</Text> {thread.excerpt}
            </Text>
          ))}

          <Text> </Text>
          <Box flexDirection="row" gap={1}>
            {refresh}
            {PR_ACTIONS.map(action => (
              <Button
                key={action.key}
                hotkey={action.hotkey}
                label={action.label}
                onPress={() => void $.prompt.submit({ text: action.prompt })}
              />
            ))}
          </Box>
        </Box>
      )
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

  // skill.prompt fires however a skill loads: typed as /name, the Skill tool,
  // or preloaded into a subagent.
  if (isOn('skillTally')) {
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
}
