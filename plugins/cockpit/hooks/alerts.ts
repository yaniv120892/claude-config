import type { Alert, AlertVerdict, BoardPr } from '../types'

const MAX_ALERTS = 50
const MAX_PROMPT_FILES = 40
const VERDICTS: readonly string[] = ['likely', 'unlikely', 'unclear'] satisfies AlertVerdict[]

export type Verdict = { prUrl: string | null; verdict: AlertVerdict; reason: string }

/** The PRs whose production deploy the alert follows closely enough to be its cause, newest deploy first. */
export function watchedDeploys(prs: readonly BoardPr[], alertAt: number, windowMs: number): BoardPr[] {
  return prs
    .filter(pr => pr.deployedAt !== null && alertAt >= pr.deployedAt && alertAt - pr.deployedAt <= windowMs)
    .sort((a, b) => (b.deployedAt ?? 0) - (a.deployedAt ?? 0))
}

export function verdictPrompt(alertText: string, deployed: readonly BoardPr[]): string {
  const changes = deployed.map(pr => {
    const files = pr.files.slice(0, MAX_PROMPT_FILES).join(', ')
    return `- ${pr.url}\n  repository: ${pr.repo}\n  title: ${pr.title}\n  files: ${files}`
  })
  return [
    'A monitoring alert fired shortly after these pull requests were deployed to production.',
    'Decide whether one of them plausibly caused it, from the service, paths and wording alone.',
    '',
    'Pull requests:',
    ...changes,
    '',
    'Alert:',
    alertText,
    '',
    'Answer with one JSON object and nothing else:',
    '{"prUrl": "<the URL of the most likely pull request, or null>", "verdict": "likely" | "unlikely" | "unclear", "reason": "<one sentence>"}',
  ].join('\n')
}

function isVerdict(value: unknown): value is AlertVerdict {
  return typeof value === 'string' && VERDICTS.includes(value)
}

/** The model's answer; anything that is not the asked JSON reads as unclear. */
export function parseVerdict(answer: string, deployed: readonly BoardPr[]): Verdict {
  const fallback: Verdict = { prUrl: deployed[0]?.url ?? null, verdict: 'unclear', reason: 'The comparison gave no clear answer.' }
  const json = /\{[\s\S]*\}/.exec(answer)?.[0]
  if (json === undefined) return fallback
  try {
    const parsed: Record<string, unknown> = { ...JSON.parse(json) }
    if (!isVerdict(parsed.verdict)) return fallback
    const named = deployed.find(pr => pr.url === parsed.prUrl)
    return {
      prUrl: named?.url ?? fallback.prUrl,
      verdict: parsed.verdict,
      reason: typeof parsed.reason === 'string' ? parsed.reason : '',
    }
  } catch {
    return fallback
  }
}

export function asAlerts(stored: unknown): Alert[] {
  return Array.isArray(stored) ? stored.filter(alert => typeof alert?.id === 'string') : []
}

export function addAlert(alerts: readonly Alert[], alert: Alert): Alert[] {
  return [alert, ...alerts.filter(other => other.id !== alert.id)].slice(0, MAX_ALERTS)
}
