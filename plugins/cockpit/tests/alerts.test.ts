import { describe, expect, test } from 'claude-code/testing'

import { parseVerdict, verdictPrompt, watchedDeploys } from '../hooks/alerts'
import { parseBoard } from '../hooks/prs'
import { boardAnswer, row } from './fixtures'

const HOUR = 3_600_000

function deployedPrs() {
  const at = (iso: string) => [{ environment: 'production', statuses: [{ state: 'SUCCESS', createdAt: iso }] }]
  return parseBoard(
    boardAnswer([row({ number: 1 })], [
      row({ number: 2, state: 'MERGED', deployments: at('2026-11-01T10:00:00Z') }),
      row({ number: 3, state: 'MERGED', deployments: at('2026-11-01T10:30:00Z') }),
    ]),
    'production',
  )
}

describe('alerts after a deploy', () => {
  test('an alert is compared only to PRs deployed within the window before it', async () => {
    const prs = deployedPrs()
    const at = (iso: string) => watchedDeploys(prs, Date.parse(iso), HOUR).map(pr => pr.number)
    expect(at('2026-11-01T10:45:00Z')).toEqual([3, 2])
    expect(at('2026-11-01T11:15:00Z')).toEqual([3])
    expect(at('2026-11-01T09:59:00Z')).toEqual([])
    expect(at('2026-11-01T12:00:00Z')).toEqual([])
  })

  test('the prompt names each deployed PR with its files and the alert', async () => {
    const prompt = verdictPrompt('5xx spike on billing-api', deployedPrs().slice(1))
    expect(prompt).toContain('https://github.com/acme/app/pull/2')
    expect(prompt).toContain('src/billing/charge.ts')
    expect(prompt).toContain('5xx spike on billing-api')
  })

  test('reads the verdict, and anything else as unclear against the newest deploy', async () => {
    const deployed = watchedDeploys(deployedPrs(), Date.parse('2026-11-01T10:45:00Z'), HOUR)
    const answer = 'Here: {"prUrl": "https://github.com/acme/app/pull/2", "verdict": "likely", "reason": "It changed charge.ts."}'
    expect(parseVerdict(answer, deployed)).toEqual({
      prUrl: 'https://github.com/acme/app/pull/2',
      verdict: 'likely',
      reason: 'It changed charge.ts.',
    })
    expect(parseVerdict('{"prUrl": "https://evil.example/pull/9", "verdict": "unlikely", "reason": "x"}', deployed).prUrl).toBe(
      'https://github.com/acme/app/pull/3',
    )
    expect(parseVerdict('I cannot say.', deployed).verdict).toBe('unclear')
    expect(parseVerdict('{"verdict": "certain"}', deployed).verdict).toBe('unclear')
  })
})
