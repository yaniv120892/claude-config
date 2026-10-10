import { describe, expect, test } from 'claude-code/testing'

import { argumentsLine, prReferences, prSkillOf, prSkillRuns, recordRun } from '../hooks/pr-skills'

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

describe('prReferences', () => {
  test('reads links, owner/repo#n and numbers, past flags and effort levels', () => {
    expect(prReferences(`high 64 #65 ${URL_63}/files --comment other/repo#9`)).toEqual({
      urls: [URL_63, 'https://github.com/other/repo/pull/9'],
      numbers: [64, 65],
    })
  })

  test('is null when nothing names a PR, or anything left is not one', () => {
    expect(prReferences('')).toBe(null)
    expect(prReferences('--comment high')).toBe(null)
    expect(prReferences('3 files')).toBe(null)
    expect(prReferences('plugins/mods')).toBe(null)
  })
})

describe('argumentsLine', () => {
  test('reads the line the engine appends, never PR links elsewhere in the skill text', () => {
    expect(argumentsLine(`See ${URL_63}.\n\nARGUMENTS: 63`)).toBe(' 63')
    expect(argumentsLine(`See ${URL_63}.`)).toBe('')
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
