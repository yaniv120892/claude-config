import { describe, expect, test } from 'claude-code/testing'

import { prSkillOf, prSkillRuns, recordRun, runTargets } from '../hooks/pr-skills'

const ROOT = '/w/claude-config'
const URL_63 = 'https://github.com/owner/claude-config/pull/63'

describe('prSkillOf', () => {
  test('matches the three skills under any plugin prefix', () => {
    expect(prSkillOf('simplify')).toBe('simplify')
    expect(prSkillOf('pr-workflows:pr-review')).toBe('pr-review')
    expect(prSkillOf('my-expenses-website:pr-review')).toBe('pr-review')
    expect(prSkillOf('dev-workflows:prune-comments')).toBe('prune-comments')
  })

  test('ignores every other skill, including near names', () => {
    expect(prSkillOf('pr-workflows:pr-second-review')).toBe(null)
    expect(prSkillOf('code-review')).toBe(null)
  })
})

describe('runTargets', () => {
  test('counts a run with no PR in its arguments for the branch', () => {
    expect(runTargets(ROOT, 'feat/x', 'Simplify the diff.')).toEqual([`${ROOT}@feat/x`])
    expect(runTargets(ROOT, null, 'Simplify the diff.')).toEqual([])
  })

  test('counts a run for the PR numbers and URLs its arguments name, not the branch', () => {
    const text = `Review the PRs.\n\nARGUMENTS: 63 #64 ${URL_63}`
    expect(runTargets(ROOT, 'main', text)).toEqual([URL_63, `${ROOT}#63`, `${ROOT}#64`])
  })

  test('reads PR links only from the arguments line, never from the skill text', () => {
    expect(runTargets(ROOT, 'feat/x', `See ${URL_63} for an example.`)).toEqual([`${ROOT}@feat/x`])
  })
})

describe('prSkillRuns', () => {
  const pr = { number: 63, url: URL_63, headRefName: 'feat/x' }

  test('joins the runs on the branch, the number and the URL, keeping the latest', () => {
    let runs = recordRun({}, [`${ROOT}@feat/x`], 'simplify', '2026-10-10T09:00:00.000Z')
    runs = recordRun(runs, [`${ROOT}#63`], 'pr-review', '2026-10-10T10:00:00.000Z')
    runs = recordRun(runs, [URL_63], 'simplify', '2026-10-10T11:00:00.000Z')
    expect(prSkillRuns(runs, ROOT, pr)).toEqual({ simplify: '2026-10-10T11:00:00.000Z', 'pr-review': '2026-10-10T10:00:00.000Z' })
  })

  test('keeps runs on the same branch name in another repository apart', () => {
    const runs = recordRun({}, ['/w/other@feat/x'], 'simplify', '2026-10-10T09:00:00.000Z')
    expect(prSkillRuns(runs, ROOT, pr)).toEqual({})
  })
})
