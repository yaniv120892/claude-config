import { describe, expect, test } from 'claude-code/testing'

import { findCredential, findTerm, parseTerms } from '../hooks/credentials'

// Built at run time so this file holds no credential-shaped literal of its
// own, for the guard or a push-protection scan to trip on.
const GITHUB_TOKEN = `ghp_${'a1B2'.repeat(9)}`
const AWS_KEY = `AKIA${'Q'.repeat(16)}`
const ANTHROPIC_KEY = `sk-ant-api03-${'x'.repeat(40)}`

describe('findCredential', () => {
  test('finds a full-length token', () => {
    expect(findCredential(`token = "${GITHUB_TOKEN}"`)?.kind).toBe('GitHub token')
    expect(findCredential(`AWS_ACCESS_KEY_ID=${AWS_KEY}`)?.kind).toBe('AWS access key')
    expect(findCredential(ANTHROPIC_KEY)?.kind).toBe('Anthropic API key')
    expect(findCredential(['-----BEGIN', 'OPENSSH PRIVATE KEY-----'].join(' '))?.kind).toBe('private key')
  })

  test('shows only the start of what it found', () => {
    expect(findCredential(GITHUB_TOKEN)?.excerpt).toBe(`${GITHUB_TOKEN.slice(0, 8)}…`)
  })

  test('lets placeholders, references and documented examples through', () => {
    expect(findCredential('export GITHUB_TOKEN="ghp_xxx"')).toBe(null)
    expect(findCredential('"token": "${LINEAR_API_KEY}"')).toBe(null)
    expect(findCredential(`AKIA${'IOSFODNN7EXAMPLE'}`)).toBe(null)
  })
})

describe('blocked terms', () => {
  test('parseTerms splits and trims', () => {
    expect(parseTerms(' Acme, Globex ,,')).toEqual(['Acme', 'Globex'])
    expect(parseTerms(undefined)).toEqual([])
  })

  test('findTerm matches whole words, ignoring case', () => {
    expect(findTerm('Deploys to the ACME cluster', ['Acme'])).toBe('Acme')
    expect(findTerm('acmeish tooling', ['Acme'])).toBe(null)
  })
})

describe('the guard', () => {
  // No git runs under `claude plugin test`, so the guard cannot see whether
  // the file is ignored and counts it as tracked: it fails closed.
  test('refuses a Write that puts a token in a file', async ($, on) => {
    const written: string[] = []
    on('tool.call', { tool: 'Write' }, ($, e) => {
      written.push(e.file_path)
      return { result: { type: 'create', filePath: e.file_path, content: e.content, structuredPatch: [], originalFile: null } }
    })
    const result = await $.tool.call({ tool: 'Write', file_path: '/repo/config.json', content: `{"token": "${GITHUB_TOKEN}"}` })
    expect(written).toEqual([])
    expect(result.isError === true || result.deny !== undefined).toBe(true)
  })

  test('lets an ordinary Edit through', async ($, on) => {
    const edited: string[] = []
    on('tool.call', { tool: 'Edit' }, ($, e) => {
      edited.push(e.new_string)
      return { result: { filePath: e.file_path, oldString: e.old_string, newString: e.new_string, originalFile: '', structuredPatch: [], userModified: false, replaceAll: false } }
    })
    await $.tool.call({ tool: 'Edit', file_path: '/repo/a.ts', old_string: 'a', new_string: 'const token = process.env.TOKEN' })
    expect(edited).toEqual(['const token = process.env.TOKEN'])
  })
})
