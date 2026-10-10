import type { PrSkillRuns } from '../types'
import { prAddresses } from './pr-data'

// The skills every PR gets before it ships, matched on the name after the
// plugin prefix: `pr-review` and `pr-workflows:pr-review` are one skill.
export const PR_SKILLS = [
  { skill: 'simplify', label: 'simplify' },
  { skill: 'pr-review', label: 'review' },
  { skill: 'prune-comments', label: 'prune' },
] as const

// The engine appends a skill's arguments as this line when the skill's text has no
// `$ARGUMENTS` of its own; a PR named there is the one the skill ran on.
const ARGUMENTS_LINE = /^ARGUMENTS:(.*)$/gm
const PR_NUMBER = /(?:^|\s)#?(\d+)(?=\s|$)/g

export function prSkillOf(skill: string): string | null {
  const name = skill.slice(skill.lastIndexOf(':') + 1)
  return PR_SKILLS.some(entry => entry.skill === name) ? name : null
}

const branchKey = (root: string, branch: string) => `${root}@${branch}`
const numberKey = (root: string, number: number) => `${root}#${number}`

/** What a skill run counts for: the PRs its arguments name, else the branch it ran on. */
export function runTargets(root: string, branch: string | null, text: string): string[] {
  const named = [...text.matchAll(ARGUMENTS_LINE)].map(match => match[1] ?? '').join(' ')
  const urls = prAddresses(named).map(address => address.url)
  const bare = urls.reduce((text, url) => text.replaceAll(url, ' '), named)
  const numbers = [...bare.matchAll(PR_NUMBER)].map(match => numberKey(root, Number(match[1])))
  const targets = [...urls, ...numbers]
  if (targets.length > 0) return targets
  return branch === null ? [] : [branchKey(root, branch)]
}

export function recordRun(runs: PrSkillRuns, targets: readonly string[], skill: string, now: string): PrSkillRuns {
  const next = { ...runs }
  for (const target of targets) next[target] = { ...next[target], [skill]: now }
  return next
}

/** Joins the runs stored under the PR's URL, its number and its head branch. */
export function prSkillRuns(
  runs: PrSkillRuns,
  root: string | null,
  pr: { number: number; url: string; headRefName: string },
): Record<string, string> {
  const keys = [pr.url]
  if (root !== null) {
    keys.push(numberKey(root, pr.number))
    if (pr.headRefName) keys.push(branchKey(root, pr.headRefName))
  }
  const found: Record<string, string> = {}
  for (const key of keys) {
    for (const [skill, when] of Object.entries(runs[key] ?? {})) {
      if (when > (found[skill] ?? '')) found[skill] = when
    }
  }
  return found
}
