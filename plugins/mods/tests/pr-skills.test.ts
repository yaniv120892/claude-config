import { describe, expect, test } from 'claude-code/testing'

import { githubSlug, prSkillOf, prSkillRuns, recordRun, runTargets } from '../hooks/pr-skills'

const ROOT = '/w/claude-config'
const URL_63 = 'https://github.com/owner/claude-config/pull/63'

describe('prSkillOf', () => {
  test('matches the three skills under any plugin prefix', () => {
    expect(prSkillOf('simplify')).toBe('simplify')
    expect(prSkillOf('pr-workflows:pr-review')).toBe('pr-review')
    expect(prSkillOf('my-expenses-website:pr-review')).toBe('pr-review')
    expect(prSkillOf('dev-workflows:prune-comments')).toBe('prune-comments')
    expect(prSkillOf('code-review')).toBe('code-review')
  })

  test('ignores every other skill, including near names', () => {
    expect(prSkillOf('pr-workflows:pr-second-review')).toBe(null)
    expect(prSkillOf('security-review')).toBe(null)
  })
})

describe('runTargets', () => {
  const place = { root: ROOT, branch: 'feat/x', slug: 'owner/claude-config' }
  const args = (line: string) => `The skill.\n\nARGUMENTS: ${line}`

  test('counts a run with no arguments for the branch', () => {
    expect(runTargets(place, 'Simplify the diff.')).toEqual([`${ROOT}@feat/x`])
    expect(runTargets({ ...place, branch: null }, 'Simplify the diff.')).toEqual([])
  })

  test('counts a run for each PR its arguments name, by URL', () => {
    const URL_64 = 'https://github.com/owner/claude-config/pull/64'
    const URL_OTHER = 'https://github.com/other/repo/pull/9'
    expect(runTargets(place, args(`63 #64 ${URL_63} other/repo#9`))).toEqual([URL_63, URL_64, URL_OTHER])
  })

  test('counts a run for the branch when any argument is not a PR', () => {
    expect(runTargets(place, args('3 files'))).toEqual([`${ROOT}@feat/x`])
    expect(runTargets(place, args(`${URL_63} --comment`))).toEqual([`${ROOT}@feat/x`])
  })

  test('cannot name a bare number without a GitHub remote, so falls back to the branch', () => {
    expect(runTargets({ ...place, slug: null }, args('63'))).toEqual([`${ROOT}@feat/x`])
    expect(runTargets({ ...place, slug: null }, args('owner/claude-config#63'))).toEqual([URL_63])
  })

  test('reads PR links only from the arguments line, never from the skill text', () => {
    expect(runTargets(place, `See ${URL_63} for an example.`)).toEqual([`${ROOT}@feat/x`])
  })
})

describe('githubSlug', () => {
  test('reads owner/repo from an SSH or HTTPS remote', () => {
    expect(githubSlug('git@github.com:owner/claude-config.git')).toBe('owner/claude-config')
    expect(githubSlug('https://github.com/owner/claude-config')).toBe('owner/claude-config')
    expect(githubSlug('git@gitlab.com:owner/repo.git')).toBe(null)
    expect(githubSlug(null)).toBe(null)
  })
})

describe('prSkillRuns', () => {
  const pr = { url: URL_63, headRefName: 'feat/x' }

  test('joins the runs on the branch and the URL, keeping the latest', () => {
    let runs = recordRun({}, [`${ROOT}@feat/x`], 'simplify', '2026-10-10T09:00:00.000Z')
    runs = recordRun(runs, [URL_63], 'pr-review', '2026-10-10T10:00:00.000Z')
    runs = recordRun(runs, [URL_63], 'simplify', '2026-10-10T11:00:00.000Z')
    expect(prSkillRuns(runs, ROOT, pr)).toEqual({ simplify: '2026-10-10T11:00:00.000Z', 'pr-review': '2026-10-10T10:00:00.000Z' })
  })

  test('keeps runs on the same branch name in another repository apart', () => {
    const runs = recordRun({}, ['/w/other@feat/x'], 'simplify', '2026-10-10T09:00:00.000Z')
    expect(prSkillRuns(runs, ROOT, pr)).toEqual({})
  })
})
