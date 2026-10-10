import type { PrSkillRuns } from '../types'
import { prAddresses } from './pr-data'

// The skills every PR gets before it ships, matched on the name after the
// plugin prefix: `pr-review` and `pr-workflows:pr-review` are one skill.
export const PR_SKILLS = [
  { skill: 'simplify', label: 'simplify' },
  { skill: 'code-review', label: 'code-review' },
  { skill: 'pr-review', label: 'pr-review' },
  { skill: 'prune-comments', label: 'prune' },
] as const

// The engine appends a skill's arguments as this line when the skill's text has no
// `$ARGUMENTS` of its own: the fallback when the call that loaded it was not seen.
const ARGUMENTS_LINE = /^ARGUMENTS:(.*)$/gm
const SLUG_PR = /^([\w.-]+\/[\w.-]+)#(\d+)$/
const NUMBER_PR = /^#?(\d+)$/
// code-review's effort levels, which sit beside a PR number in its arguments.
const EFFORT_LEVELS = new Set(['low', 'medium', 'high', 'xhigh', 'max', 'ultra'])

/** The PRs a skill's arguments name: links as given, numbers for gh to resolve in the session's repo. */
export type PrReferences = { urls: string[]; numbers: number[] }

export function prSkillOf(skill: string): string | null {
  const name = skill.slice(skill.lastIndexOf(':') + 1)
  return PR_SKILLS.some(entry => entry.skill === name) ? name : null
}

export function argumentsLine(text: string): string {
  return [...text.matchAll(ARGUMENTS_LINE)].map(match => match[1] ?? '').join(' ')
}

/**
 * The PRs the arguments name, once flags and effort levels are set aside; null when nothing
 * is left or anything left is not a PR, so `/simplify 3 files` is not read as PR #3.
 */
export function prReferences(args: string): PrReferences | null {
  const tokens = args.split(/\s+/).filter(token => token !== '' && !token.startsWith('-') && !EFFORT_LEVELS.has(token))
  const found: PrReferences = { urls: [], numbers: [] }
  for (const token of tokens) {
    const link = prAddresses(token)[0]
    const slugged = SLUG_PR.exec(token)
    const numbered = NUMBER_PR.exec(token)
    if (link !== undefined && token.startsWith(link.url)) found.urls.push(link.url)
    else if (slugged !== null) found.urls.push(`https://github.com/${slugged[1]}/pull/${slugged[2]}`)
    else if (numbered !== null) found.numbers.push(Number(numbered[1]))
    else return null
  }
  return tokens.length === 0 ? null : found
}

export const branchKey = (root: string, branch: string) => `${root}@${branch}`

export function recordRun(runs: PrSkillRuns, targets: readonly string[], skill: string, now: string): PrSkillRuns {
  const next = { ...runs }
  for (const target of targets) next[target] = { ...next[target], [skill]: now }
  return next
}

/** Joins the runs stored under the PR's URL and under its head branch. */
export function prSkillRuns(
  runs: PrSkillRuns,
  root: string | null,
  pr: { url: string; headRefName: string },
): Record<string, string> {
  const keys = [pr.url]
  if (root !== null && pr.headRefName) keys.push(branchKey(root, pr.headRefName))
  const found: Record<string, string> = {}
  for (const key of keys) {
    for (const [skill, when] of Object.entries(runs[key] ?? {})) {
      if (when > (found[skill] ?? '')) found[skill] = when
    }
  }
  return found
}
