import { asRecord } from './store'

export type Tally = Record<string, { count: number; lastUsed: string }>

export function asTally(stored: unknown): Tally {
  return asRecord<Tally>(stored)
}

export function countSkill(tally: Tally, skill: string, now: string): Tally {
  return { ...tally, [skill]: { count: (tally[skill]?.count ?? 0) + 1, lastUsed: now } }
}

export function formatTally(tally: Tally, known: readonly string[]): string {
  const rows = Object.entries(tally).sort(([, a], [, b]) => b.count - a.count)
  const unused = known.filter(name => !(name in tally)).sort()
  const lines = ['| Skill | Loads | Last |', '| --- | ---: | --- |']
  for (const [name, { count, lastUsed }] of rows) {
    lines.push(`| \`${name}\` | ${count} | ${lastUsed.slice(0, 10)} |`)
  }
  if (rows.length === 0) lines.push('| _none yet_ | 0 | |')
  if (unused.length > 0) {
    lines.push('', `**Never loaded (${unused.length}):** ${unused.map(name => `\`${name}\``).join(', ')}`)
  }
  return lines.join('\n')
}
