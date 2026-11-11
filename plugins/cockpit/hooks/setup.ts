import { record } from './json'
import type { ScopeVerdict, SetupFacts, SetupStep, SlackLink } from '../types'

const EVENT_FRESH_MS = 7 * 86_400_000
// A sidecar in standby defers to another session's connection, which is the one up.
const LINK_UP: ReadonlySet<SlackLink['state']> = new Set(['connected', 'standby'])

type SetupState = {
  hasTokens: boolean
  link: SlackLink['state']
  alertChannels: string
  eventChannels: string
  facts: SetupFacts
  now: number
}

/** Each step the cockpit needs, from the options and what Slack has shown: none is a stored checkbox. */
export function setupSteps({ hasTokens, link, alertChannels, eventChannels, facts, now }: SetupState): SetupStep[] {
  const verdicts = Object.values(facts.scopes)
  const refused = Object.keys(facts.scopes).filter(method => facts.scopes[method] === 'missing')
  const isScopeMissing = refused.length > 0
  return [
    {
      id: 'tokens',
      label: 'Slack tokens',
      isDone: hasTokens,
      todo: 'Save the app-level and user tokens: claude plugin configure cockpit@yaniv-claude-config --values-stdin (README, Cockpit).',
    },
    { id: 'connected', label: 'Slack connected', isDone: isLinkUp(link), todo: `The Slack link is ${link}: the Inbox tab says why.` },
    {
      id: 'scopes',
      label: 'Slack reactions and replies',
      isDone: verdicts.includes('ok') && !isScopeMissing,
      todo: isScopeMissing
        ? `Update the Slack app from plugins/cockpit/slack-app-manifest.yaml and reinstall it, then use ${refused.join(' and ')} once more: Slack refused it for a scope.`
        : 'React to or reply to a Slack message from the Inbox once, to confirm the app may.',
    },
    { id: 'alerts', label: 'Alert channels', isDone: alertChannels !== '', todo: 'Set alertChannels under cockpit in /config.' },
    { id: 'events', label: 'Event channels', isDone: eventChannels !== '', todo: 'Set eventChannels under cockpit in /config, such as cockpit-events.' },
    {
      id: 'flowing',
      label: 'Events flowing',
      isDone: isEventFlowing({ facts, now }),
      todo: "In the event channel run /github subscribe <owner/repo> pulls reviews comments, and send Linear's Slack notifications to it.",
    },
  ]
}

export function isLinkUp(link: SlackLink['state']): boolean {
  return LINK_UP.has(link)
}

/** An event channel delivered a message in the last week: Slack events are bringing the board's changes. */
export function isEventFlowing({ facts, now }: { facts: SetupFacts; now: number }): boolean {
  return facts.lastEventAt !== null && now - facts.lastEventAt <= EVENT_FRESH_MS
}

export function asSetupFacts(stored: unknown): SetupFacts {
  const facts = record(stored)
  const scopes: Record<string, ScopeVerdict> = {}
  for (const [method, verdict] of Object.entries(record(facts.scopes))) {
    if (isScopeVerdict(verdict)) scopes[method] = verdict
  }
  return { scopes, lastEventAt: typeof facts.lastEventAt === 'number' ? facts.lastEventAt : null }
}

function isScopeVerdict(value: unknown): value is ScopeVerdict {
  return value === 'ok' || value === 'missing'
}
