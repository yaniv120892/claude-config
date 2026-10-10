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
// `$ARGUMENTS` of its own; a PR named there is the one the skill ran on.
const ARGUMENTS_LINE = /^ARGUMENTS:(.*)$/gm
const SLUG_PR = /^([\w.-]+\/[\w.-]+)#(\d+)$/
const BARE_PR = /^#?(\d+)$/
const GITHUB_REMOTE = /github\.com[:/]([\w.-]+\/[\w.-]+?)(?:\.git)?\/?$/

export type RunPlace = {
  root: string
  branch: string | null
  /** `owner/repo` of the session's GitHub remote, so a bare PR number can be named by its URL. */
  slug: string | null
}

export function prSkillOf(skill: string): string | null {
  const name = skill.slice(skill.lastIndexOf(':') + 1)
  return PR_SKILLS.some(entry => entry.skill === name) ? name : null
}

export function githubSlug(remote: string | null): string | null {
  return remote === null ? null : (GITHUB_REMOTE.exec(remote)?.[1] ?? null)
}

const branchKey = (root: string, branch: string) => `${root}@${branch}`
const prUrl = (slug: string, number: string) => `https://github.com/${slug}/pull/${number}`

/** The PR URL a single argument names, or null when it is not a PR reference. */
function prReference(token: string, slug: string | null): string | null {
  const url = prAddresses(token)[0]?.url
  if (url !== undefined && url === token.replace(/\/$/, '')) return url
  const slugged = SLUG_PR.exec(token)
  if (slugged !== null) return prUrl(slugged[1] ?? '', slugged[2] ?? '')
  const bare = BARE_PR.exec(token)
  return bare !== null && slug !== null ? prUrl(slug, bare[1] ?? '') : null
}

/**
 * What a skill run counts for: the PRs its arguments name when every argument names one,
 * else the branch it ran on, so `/simplify 3 files` is not read as PR #3.
 */
export function runTargets(place: RunPlace, text: string): string[] {
  const tokens = [...text.matchAll(ARGUMENTS_LINE)].flatMap(match => (match[1] ?? '').split(/\s+/)).filter(Boolean)
  const urls = tokens.map(token => prReference(token, place.slug)).filter(url => url !== null)
  if (tokens.length > 0 && urls.length === tokens.length) return [...new Set(urls)]
  return place.branch === null ? [] : [branchKey(place.root, place.branch)]
}

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
