// What the rule guard refuses: rules/config.md, "Secrets Never Live in a
// Tracked File", and the blocked terms of an employer-agnostic repository.

// Each pattern needs the credential's full length, so a placeholder such as
// `ghp_xxx` passes.
const CREDENTIALS: readonly { kind: string; pattern: RegExp }[] = [
  { kind: 'private key', pattern: /-----BEGIN (?:RSA |EC |DSA |OPENSSH |PGP |ENCRYPTED )?PRIVATE KEY-----/ },
  { kind: 'Anthropic API key', pattern: /\bsk-ant-[A-Za-z0-9]+-[A-Za-z0-9_-]{32,}/ },
  { kind: 'OpenAI API key', pattern: /\bsk-(?:proj-)?[A-Za-z0-9_-]{40,}/ },
  { kind: 'GitHub token', pattern: /\b(?:gh[pousr]_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{60,})/ },
  { kind: 'AWS access key', pattern: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/ },
  { kind: 'Slack token', pattern: /\bxox[abpors]-[A-Za-z0-9-]{20,}/ },
  { kind: 'Google API key', pattern: /\bAIza[0-9A-Za-z_-]{35}\b/ },
  { kind: 'Linear API key', pattern: /\blin_api_[A-Za-z0-9]{32,}/ },
  { kind: 'npm token', pattern: /\bnpm_[A-Za-z0-9]{36}\b/ },
]
// AWS's documented example keys, and placeholders named after them.
const EXAMPLE = /EXAMPLE/

export type Finding = { kind: string; excerpt: string }

export function findCredential(text: string): Finding | null {
  for (const { kind, pattern } of CREDENTIALS) {
    const found = pattern.exec(text)
    if (found !== null && !EXAMPLE.test(found[0])) {
      return { kind, excerpt: `${found[0].slice(0, 8)}…` }
    }
  }
  return null
}

export function parseTerms(option: unknown): string[] {
  if (typeof option !== 'string') return []
  return option
    .split(',')
    .map(term => term.trim())
    .filter(Boolean)
}

/** The first term the text holds, matched as a whole word, ignoring case. */
export function findTerm(text: string, terms: readonly string[]): string | null {
  return (
    terms.find(term => {
      const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      return new RegExp(`(^|[^A-Za-z0-9_])${escaped}([^A-Za-z0-9_]|$)`, 'i').test(text)
    }) ?? null
  )
}

export function credentialReason(path: string, finding: Finding): string {
  return (
    `Secrets Never Live in a Tracked File: ${path} would hold what looks like a ${finding.kind} ` +
    `(${finding.excerpt}). Keep the value in the environment and reference it as \${VAR}; commit a ` +
    '*.example with a placeholder. If it is a real credential that was already shared, rotate it.'
  )
}

export function termReason(path: string, term: string): string {
  return (
    `This repository is a plugin marketplace and stays employer-agnostic: ${path} would contain ` +
    `"${term}". Put the value in a machine-local config (see config.example.json) or a *.local.md file.`
  )
}
