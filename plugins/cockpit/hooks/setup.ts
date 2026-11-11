import type { SetupFacts, SlackLink, SlackScopes } from '../types'

const EVENT_FRESH_MS = 7 * 86_400_000

export type SetupStep = { id: string; label: string; isDone: boolean; todo: string }

type SetupState = {
  hasTokens: boolean
  link: SlackLink['state']
  alertChannels: string
  eventChannels: string
  facts: SetupFacts
  now: number
}

const SCOPES_TODO = {
  unknown: 'React to or reply to a Slack message from the Inbox once, to confirm the app may.',
  missing: 'Update the Slack app from plugins/cockpit/slack-app-manifest.yaml and reinstall it: a reaction or reply was refused for a scope.',
  ok: '',
} as const satisfies Record<SlackScopes, string>

/** Each step the cockpit needs, from the options and what Slack has shown: none is a stored checkbox. */
export function setupSteps({ hasTokens, link, alertChannels, eventChannels, facts, now }: SetupState): SetupStep[] {
  const isEventFresh = facts.lastEventAt !== null && now - facts.lastEventAt <= EVENT_FRESH_MS
  return [
    {
      id: 'tokens',
      label: 'Slack tokens',
      isDone: hasTokens,
      todo: 'Save the app-level and user tokens: claude plugin configure cockpit@yaniv-claude-config --values-stdin (README, Cockpit).',
    },
    {
      id: 'connected',
      label: 'Slack connected',
      isDone: link === 'connected' || link === 'standby',
      todo: `The Slack link is ${link}: the Inbox tab says why.`,
    },
    { id: 'scopes', label: 'Slack reactions and replies', isDone: facts.scopes === 'ok', todo: SCOPES_TODO[facts.scopes] },
    { id: 'alerts', label: 'Alert channels', isDone: alertChannels !== '', todo: 'Set alertChannels under cockpit in /config.' },
    { id: 'events', label: 'Event channels', isDone: eventChannels !== '', todo: 'Set eventChannels under cockpit in /config, such as cockpit-events.' },
    {
      id: 'flowing',
      label: 'Events flowing',
      isDone: isEventFresh,
      todo: "In the event channel run /github subscribe <owner/repo> pulls reviews comments, and send Linear's Slack notifications to it.",
    },
  ]
}

export function asSetupFacts(stored: unknown): SetupFacts {
  const facts = typeof stored === 'object' && stored !== null ? { ...stored } : {}
  const scopes = 'scopes' in facts && (facts.scopes === 'ok' || facts.scopes === 'missing') ? facts.scopes : 'unknown'
  const lastEventAt = 'lastEventAt' in facts && typeof facts.lastEventAt === 'number' ? facts.lastEventAt : null
  return { scopes, lastEventAt }
}
