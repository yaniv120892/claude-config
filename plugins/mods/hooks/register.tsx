import { atom, read, update } from 'claude-code'
import type { CommandSpec, EngineInterface, Register } from 'claude-code'

import type { GitLocation, PrThread, PullRequest } from '../types'
import { credentialReason, findCredential, findTerm, parseTerms, termReason } from './credentials'
import { isGitWrite, movesPr, movesRepo } from './git-write'
import {
  basename,
  checksSummary,
  contextColor,
  dirname,
  parsePrView,
  parseThreads,
  PR_FIELDS,
  prUrlParts,
  prViewError,
  THREADS_QUERY,
} from './pr-data'
import { asTally, countSkill, formatTally } from './tally'

// Every hook lives in this file: the engine follows `$` only into functions
// declared beside the hook that passes it. The pure logic sits in the files
// imported above, which is what the tests cover.

type Engine = EngineInterface

const gitGrant = atom({ plugin: 'mods', key: 'gitGrant' } as const, false)
const location = atom({ plugin: 'mods', key: 'location' } as const, null)
const model = atom({ plugin: 'mods', key: 'model' } as const, null)
const contextPercent = atom({ plugin: 'mods', key: 'contextPercent' } as const, null)
const pr = atom({ plugin: 'mods', key: 'pr' } as const, null)
const prError = atom({ plugin: 'mods', key: 'prError' } as const, null)
const prFetchedAt = atom({ plugin: 'mods', key: 'prFetchedAt' } as const, 0)

// ── git write gate ──────────────────────────────────────────────────────────

const GIT_GATE_COMMAND: CommandSpec = {
  name: 'git-gate',
  description: 'Show the git write gate, or reset its session approval',
  argumentHint: '[reset]',
}
const ONCE = 'Allow once'
const SESSION = 'Allow for this session'
const DENY = 'Deny'
const SHOWN_COMMAND_LENGTH = 200

/**
 * Asks the person, in a dialog the model cannot answer, before a git commit or
 * push or a gh pr create or merge runs. "Allow for this session" holds until
 * `/git-gate reset` or the session ends. Resolves the refusal, or null to run.
 */
async function gateGitWrite($: Engine, command: string): Promise<{ deny: string } | null> {
  if (!isGitWrite(command) || (await read($, gitGrant))) return null

  const shown =
    command.length > SHOWN_COMMAND_LENGTH ? `${command.slice(0, SHOWN_COMMAND_LENGTH)}…` : command
  let answer: string
  try {
    answer = await $.ui.ask(`Claude wants to run a git/gh write:\n\n${shown}\n\nRun it?`, {
      header: 'Git write',
      options: [ONCE, SESSION, DENY],
    })
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

// ── status band and PR ──────────────────────────────────────────────────────

const PR_POLL_MS = 90_000

// Each write is skipped when the value is unchanged, so a refresh that found
// nothing new redraws nothing.
function isSame(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b)
}

async function git($: Engine, cwd: string, args: string[]): Promise<string | null> {
  try {
    const ran = await $.process.run(['git', ...args], { cwd, timeoutMs: 5000 })
    return ran.exitCode === 0 ? ran.stdout.trim() : null
  } catch {
    return null
  }
}

async function readLocation($: Engine): Promise<GitLocation> {
  const cwd = await $.session.cwd()
  const commonDir = await git($, cwd, ['rev-parse', '--path-format=absolute', '--git-common-dir'])
  if (commonDir === null) return { repo: null, dir: basename(cwd), branch: null, isDirty: false }
  const branch = await git($, cwd, ['branch', '--show-current'])
  const porcelain = await git($, cwd, ['status', '--porcelain'])
  return {
    repo: basename(dirname(commonDir)),
    dir: basename(cwd),
    branch: branch || null,
    isDirty: Boolean(porcelain),
  }
}

/** The cheap half: the git location, the model and the context fill. */
async function refreshLocal($: Engine): Promise<void> {
  const here = await readLocation($)
  if (!isSame(await read($, location), here)) await update($, location, () => here)
  const modelName = await $.session.model()
  if ((await read($, model)) !== modelName) await update($, model, () => modelName)
  const { percent } = (await $.session.usage()).context
  const rounded = percent === undefined ? null : Math.round(percent)
  if ((await read($, contextPercent)) !== rounded) await update($, contextPercent, () => rounded)
}

/** Stores what a PR read found: the PR, or why there is none to show. */
async function storePr($: Engine, found: PullRequest | null, error: string | null): Promise<void> {
  if (!isSame(await read($, pr), found)) await update($, pr, () => found)
  if ((await read($, prError)) !== error) await update($, prError, () => error)
}

/** The network half: the branch's PR and its unresolved threads, through gh. */
async function refreshPr($: Engine): Promise<void> {
  const now = await $.clock.now()
  await update($, prFetchedAt, () => now)
  const cwd = await $.session.cwd()
  let view
  try {
    view = await $.process.run(['gh', 'pr', 'view', '--json', PR_FIELDS], { cwd, timeoutMs: 15000 })
  } catch {
    return storePr($, null, 'gh is not installed')
  }
  if (view.exitCode !== 0) return storePr($, null, prViewError(view.stderr))

  const parsed = parsePrView(view.stdout)
  const parts = prUrlParts(parsed.url)
  let threads: PrThread[] = []
  if (parts !== null) {
    try {
      const answer = await $.process.run(
        [
          'gh', 'api', 'graphql',
          '-f', `query=${THREADS_QUERY}`,
          '-F', `owner=${parts.owner}`,
          '-F', `name=${parts.name}`,
          '-F', `number=${parts.number}`,
        ],
        { cwd, timeoutMs: 15000 },
      )
      if (answer.exitCode === 0) threads = parseThreads(answer.stdout)
    } catch {
      // The checks still show; the threads read as none.
    }
  }
  return storePr($, { ...parsed, threads }, null)
}

// ── /pr pane ────────────────────────────────────────────────────────────────

const PANE = 'mods-pr'
const PR_COMMAND: CommandSpec = {
  name: 'pr',
  description: "Show this branch's PR: checks, open review threads, and the PR skills",
}
const CHECK_ORDER = { fail: 0, pending: 1, pass: 2, skipped: 3 } as const
const CHECK_MARK = { fail: '✗', pending: '…', pass: '✓', skipped: '-' } as const
const CHECK_COLOR = { fail: 'red', pending: 'yellow', pass: 'green', skipped: 'gray' } as const
// The pr-workflows skills each button hands the branch to.
const PR_ACTIONS = [
  { key: 'address', hotkey: 'a', label: 'Address feedback', prompt: '/pr-workflows:address-pr-feedback' },
  { key: 'verify', hotkey: 'v', label: 'Verify state', prompt: '/pr-workflows:verify-pr-state' },
  { key: 'finalize', hotkey: 'f', label: 'Finalize', prompt: '/pr-workflows:finalize-pr' },
] as const

// ── rule guard ──────────────────────────────────────────────────────────────

/** The closest directory at or above the file that exists, for git to run in. */
async function existingDir($: Engine, file: string): Promise<string> {
  let dir = dirname(file)
  try {
    while (dir !== '/' && !(await $.fs.exists(dir))) dir = dirname(dir)
  } catch {
    // Unreadable: git runs in the file's own directory and reports what it can.
  }
  return dir
}

/**
 * Whether git would track the file: inside a work tree and not ignored. A git
 * that cannot run counts as tracked, so the guard fails closed.
 */
async function isTracked($: Engine, file: string, cwd: string): Promise<boolean> {
  try {
    const ran = await $.process.run(['git', 'check-ignore', '-q', '--', file], { cwd, timeoutMs: 5000 })
    // 0: ignored. 1: not ignored. 128: outside a work tree.
    return ran.exitCode === 1
  } catch {
    return true
  }
}

/** Whether the directory is in a plugin marketplace repo, which stays employer-agnostic. */
async function isMarketplaceRepo($: Engine, cwd: string): Promise<boolean> {
  const root = await git($, cwd, ['rev-parse', '--show-toplevel'])
  if (root === null) return false
  try {
    return await $.fs.exists(`${root}/.claude-plugin/marketplace.json`)
  } catch {
    return false
  }
}

/** When the guard broke: a credential still refuses the edit; anything else runs. */
function guardFailed(isCalled: boolean, path: string, text: string): { deny: string } | null {
  const credential = isCalled ? null : findCredential(text)
  return credential === null ? null : { deny: credentialReason(path, credential) }
}

/** Why an edit putting `text` into `path` is refused, or null to let it run. */
async function guardEdit($: Engine, path: string, text: string, terms: readonly string[]): Promise<string | null> {
  const credential = findCredential(text)
  const term = terms.length > 0 ? findTerm(text, terms) : null
  if (credential === null && term === null) return null

  const file = path.startsWith('/') ? path : `${await $.session.cwd()}/${path}`
  const dir = await existingDir($, file)
  if (credential !== null && (await isTracked($, file, dir))) return credentialReason(path, credential)
  if (term !== null && (await isMarketplaceRepo($, dir))) return termReason(path, term)
  return null
}

// ── reply style, skill tally ────────────────────────────────────────────────

const REPLY_STYLE_SECTION = 'mods:reply-style'
// Side calls (summaries, classifiers) write no chat replies.
const NO_REPLY_TRAITS = new Set(['analysis', 'bare'])
const TALLY_KEY = 'skillTally'
const TALLY_COMMAND: CommandSpec = {
  name: 'skill-tally',
  description: 'Show how often each skill has loaded, across sessions',
  argumentHint: '[reset]',
}

// ── wiring ──────────────────────────────────────────────────────────────────

// Each mod has a switch in /config (the manifest's userConfig); all start on.
export const register: Register = (on, options) => {
  const isOn = (name: string): boolean => options[name] !== false
  const hasGitGate = isOn('gitGate')
  const hasStatusBand = isOn('statusBand')
  const hasPrPane = isOn('prPane')
  const hasRuleGuard = isOn('ruleGuard')
  const hasReplyStyle = isOn('replyStyle')
  const hasSkillTally = isOn('skillTally')
  const blockedTerms = parseTerms(options.blockedTerms)
  let replyStyle: string | null = null

  on('session.start', async ($, e, next) => {
    if (hasGitGate) await $.command.register(GIT_GATE_COMMAND)
    if (hasPrPane) await $.command.register(PR_COMMAND)
    if (hasSkillTally) await $.command.register(TALLY_COMMAND)
    const started = await next(e)
    if (hasStatusBand) {
      await refreshLocal($)
      // On timers, not in this dispatch: gh can take seconds, and a timer's
      // work outlives the hook that set it.
      $.clock.after(0, () => void refreshPr($))
      $.clock.every(PR_POLL_MS, () => void refreshPr($))
    }
    return started
  })

  // The git write gate before the call; the status band's refresh after it.
  on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
    const refusal = hasGitGate ? await gateGitWrite($, e.command) : null
    if (refusal !== null) return refusal
    const ran = await next(e)
    if (hasStatusBand && movesRepo(e.command)) {
      await refreshLocal($)
      if (movesPr(e.command)) $.clock.after(0, () => void refreshPr($))
    }
    return ran
  }).catch(($, e, next) =>
    // A gate that broke fails closed; a refresh that broke after the call
    // hands its result on (`next` is replay-safe).
    next.called || !hasGitGate || !isGitWrite(e.command)
      ? next(e)
      : { deny: `BLOCKED: the git write gate failed (${String(next.error)}), so the write did not run.` },
  )

  on('command.run', { command: 'git-gate' }, async ($, e) => {
    if (e.args.trim() === 'reset') {
      await update($, gitGrant, () => false)
      return { text: 'Git write gate: session approval revoked. The next write asks again.' }
    }
    return {
      text: (await read($, gitGrant))
        ? 'Git write gate: writes are approved for this session. /git-gate reset revokes that.'
        : 'Git write gate: each git commit, git push, gh pr create and gh pr merge asks first.',
    }
  })

  on('turn.complete', async ($, e, next) => {
    const completed = await next(e)
    if (hasStatusBand && e.agentId === undefined) await refreshLocal($)
    return completed
  })

  // The old statusline's `➜  repo/dir git:(branch) ✗ [model] ctx:42%`, and a
  // second row for the branch's PR: checks, open threads, merge state.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const here = hasStatusBand ? await read($, location) : null
    if (e.props.hasSurvey || here === null) return next(e)

    const { Box, Text } = $.ui.resolve(e)
    const modelName = await read($, model)
    const percent = await read($, contextPercent)
    const current = await read($, pr)
    const checks = checksSummary(current?.checks ?? [])
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
          {modelName !== null && <Text color="magenta"> [{modelName}]</Text>}
          {percent !== null && <Text color={contextColor(percent)}> ctx:{percent}%</Text>}
        </Text>
        {current !== null && (
          <Text wrap="truncate-end">
            <Text dimColor>PR </Text>
            <Text bold>#{current.number}</Text>
            {current.isDraft && <Text dimColor> draft</Text>}
            {current.state !== 'OPEN' && <Text color="magenta"> {current.state.toLowerCase()}</Text>}
            {checks.failing > 0 && <Text color="red"> ✗{checks.failing}</Text>}
            {checks.pending > 0 && <Text color="yellow"> …{checks.pending}</Text>}
            {checks.passing > 0 && <Text color="green"> ✓{checks.passing}</Text>}
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

  on('command.run', { command: 'pr' }, async $ => {
    await $.ui.open({ id: PANE, title: 'Pull request' })
    await refreshPr($)
    const current = await read($, pr)
    return { text: current === null ? 'No PR for this branch yet.' : `PR #${current.number} is in the pane.` }
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text, Button, Link } = $.ui.resolve(e)
    const current = await read($, pr)
    const error = await read($, prError)
    const fetchedAt = await read($, prFetchedAt)
    const refresh = <Button key="refresh" hotkey="r" label="Refresh" onPress={() => void refreshPr($)} />

    if (current === null) {
      return (
        <Box flexDirection="column">
          <Text dimColor>{error ?? (fetchedAt === 0 ? 'Reading the PR…' : 'No PR for this branch.')}</Text>
          {refresh}
        </Box>
      )
    }

    const checks = [...current.checks].sort((a, b) => CHECK_ORDER[a.state] - CHECK_ORDER[b.state])
    const summary = checksSummary(current.checks)
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
          {'\n'}Checks ✗{summary.failing} …{summary.pending} ✓{summary.passing}
        </Text>
        {checks.length === 0 && <Text dimColor>No checks reported.</Text>}
        {checks.map(check => (
          <Text wrap="truncate-end">
            <Text color={CHECK_COLOR[check.state]}>{CHECK_MARK[check.state]}</Text> {check.name}
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

  // The rule guard: Write, Edit and NotebookEdit, by what each puts in the file.
  on('tool.call', { tool: 'Write' }, async ($, e, next) => {
    const reason = hasRuleGuard ? await guardEdit($, e.file_path, e.content, blockedTerms) : null
    return reason === null ? next(e) : { deny: reason }
  }).catch(($, e, next) => guardFailed(next.called, e.file_path, e.content) ?? next(e))

  on('tool.call', { tool: 'Edit' }, async ($, e, next) => {
    const reason = hasRuleGuard ? await guardEdit($, e.file_path, e.new_string, blockedTerms) : null
    return reason === null ? next(e) : { deny: reason }
  }).catch(($, e, next) => guardFailed(next.called, e.file_path, e.new_string) ?? next(e))

  on('tool.call', { tool: 'NotebookEdit' }, async ($, e, next) => {
    const reason = hasRuleGuard ? await guardEdit($, e.notebook_path, e.new_source, blockedTerms) : null
    return reason === null ? next(e) : { deny: reason }
  }).catch(($, e, next) => guardFailed(next.called, e.notebook_path, e.new_source) ?? next(e))

  // prompts/reply-style.md as a system-prompt section of its own. Unlike the
  // SessionStart hook it replaces, it rides every request, so compaction cannot
  // drop it. Codex reads the same file through scripts/agents_md.py.
  on('prompt.compose', async ($, e, next) => {
    const composed = await next(e)
    if (!hasReplyStyle || e.traits.some(trait => NO_REPLY_TRAITS.has(trait))) return composed
    if (replyStyle === null) {
      try {
        replyStyle = String(await $.fs.read(`${$.plugin.root}/prompts/reply-style.md`)).trim()
      } catch {
        return composed
      }
    }
    return { sections: [...composed.sections, { id: REPLY_STYLE_SECTION, text: replyStyle, scope: 'session' }] }
  })

  // Counts each skill that loads, however it was asked for (typed as /name,
  // the Skill tool, preloaded into a subagent), across sessions: the live half
  // of what the trigger evals in evals/ predict.
  on('skill.prompt', async ($, e, next) => {
    const prompted = await next(e)
    if (hasSkillTally) {
      const now = new Date(await $.clock.now()).toISOString()
      await $.store.set(TALLY_KEY, countSkill(asTally(await $.store.get(TALLY_KEY)), e.skill, now))
    }
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
