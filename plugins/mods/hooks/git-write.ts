// Commands are split into words the way a shell would, and every `git` or `gh`
// word is read as a program start wherever it stands, so a keyword (`do git
// push`), a wrapper (`timeout 60 git push`) or a global option (`git -C "$R"
// push`) cannot hide a write. Text that merely mentions a write is asked about
// too: a false ask costs a click, a false pass an unapproved push.

/** What the git write gate asks about, for `/git-gate`. */
export const GATE_SCOPE =
  'a git commit or git push that may land on the default branch, or that it cannot rule out, and every gh pr merge'

const SEPARATORS = new Set([';', '&', '|', '(', ')', '{', '}', '\n', '`'])
const GIT_VALUE_OPTIONS = new Set(['-C', '-c', '--git-dir', '--work-tree', '--namespace', '--super-prefix', '--config-env'])
const GH_VALUE_OPTIONS = new Set(['-R', '--repo'])
const GIT_WRITES = new Set(['commit', 'push'])
const GH_PR_WRITES = new Set(['create', 'merge'])
// What else a command does to a PR, so the status band rereads it.
const GH_PR_CHANGES = new Set(['create', 'merge', 'ready', 'edit', 'close', 'reopen', 'review', 'comment'])
const GH_API_VALUE_OPTIONS = new Set([
  '-X', '--method', '-f', '--raw-field', '-F', '--field', '-H', '--header', '--input',
  '-q', '--jq', '-t', '--template', '--hostname', '--cache', '-p', '--preview',
])
const GH_API_SENDS = new Set(['-f', '--raw-field', '-F', '--field', '--input'])
const PR_ENDPOINT = /(^|\/)(pulls|issues)\/\d+(\/|$)/

type Word = { text: string; isQuoted: boolean }

export function splitCommands(command: string): Word[][] {
  const commands: Word[][] = []
  let words: Word[] = []
  let word = ''
  let isQuoted = false
  let hasWord = false
  const endWord = () => {
    if (hasWord) words.push({ text: word, isQuoted })
    word = ''
    isQuoted = false
    hasWord = false
  }
  const endCommand = () => {
    endWord()
    if (words.length > 0) commands.push(words)
    words = []
  }

  for (let i = 0; i < command.length; i++) {
    const char = command[i] ?? ''
    if (char === "'" || char === '"') {
      const close = command.indexOf(char, i + 1)
      const end = close === -1 ? command.length : close
      word += command.slice(i + 1, end)
      isQuoted = true
      hasWord = true
      i = end
    } else if (char === '\\' && command[i + 1] === '\n') {
      i++
    } else if (char === '\\' && i + 1 < command.length) {
      word += command[i + 1]
      hasWord = true
      i++
    } else if (char === '$' && command[i + 1] === '(') {
      endCommand()
      i++
    } else if (char === '#' && !hasWord) {
      const newline = command.indexOf('\n', i)
      i = newline === -1 ? command.length : newline - 1
    } else if (SEPARATORS.has(char)) {
      endCommand()
    } else if (char === ' ' || char === '\t') {
      endWord()
    } else {
      word += char
      hasWord = true
    }
  }
  endCommand()
  return commands
}

function positionals(args: readonly string[], valueOptions: ReadonlySet<string>, scope: 'leading' | 'all'): string[] {
  const kept: string[] = []
  for (let i = 0; i < args.length; i++) {
    const arg = args[i] ?? ''
    const isOption = arg.startsWith('-') && (scope === 'all' || kept.length === 0)
    if (!isOption) kept.push(arg)
    else if (valueOptions.has(arg)) i++
  }
  return kept
}

type Call =
  | { program: 'git'; subcommand: string | undefined }
  | { program: 'gh'; group: string | undefined; action: string | undefined; args: string[] }

/** Quoted inner commands (`bash -c "git push"`) included. */
function calls(command: string): Call[] {
  const found: Call[] = []
  for (const words of splitCommands(command)) {
    const texts = words.map(word => word.text)
    texts.forEach((text, index) => {
      const name = text.split('/').pop()
      if (name === 'git') {
        found.push({ program: 'git', subcommand: positionals(texts.slice(index + 1), GIT_VALUE_OPTIONS, 'leading')[0] })
      } else if (name === 'gh') {
        // gh takes its flags anywhere: `gh pr -R owner/repo merge 3`.
        const args = texts.slice(index + 1)
        const [group, action] = positionals(args, GH_VALUE_OPTIONS, 'all')
        found.push({ program: 'gh', group, action, args })
      }
    })
    for (const word of words) {
      if (word.isQuoted && /\s/.test(word.text)) found.push(...calls(word.text))
    }
  }
  return found
}

export function isGitWrite(command: string): boolean {
  return calls(command).some(call =>
    call.program === 'git'
      ? GIT_WRITES.has(call.subcommand ?? '')
      : call.group === 'pr' && GH_PR_WRITES.has(call.action ?? ''),
  )
}

/**
 * Whether Claude Code's `Bash(...)` allow rules already cover every write in
 * the command: `Bash(git push:*)` a prefix, `*` any text, otherwise exact.
 * Only a segment that starts with `git` or `gh` can be covered, so a wrapper
 * (`timeout 60 git push`) or a substitution (`echo "$(git push)"`) still asks.
 */
export function isAllowedBy(rules: readonly string[], command: string): boolean {
  const patterns = rules.flatMap(rule => {
    const pattern = /^Bash\((.+)\)$/s.exec(rule)?.[1]
    return pattern === undefined ? [] : [bashRulePattern(pattern)]
  })
  const writes = splitCommands(command)
    .map(words => words.map(word => word.text))
    .filter(texts => isGitWrite(texts.join(' ')))
  return (
    writes.length > 0 &&
    writes.every(texts => {
      const program = texts[0]?.split('/').pop()
      const segment = texts.join(' ')
      return (program === 'git' || program === 'gh') && patterns.some(pattern => pattern.test(segment))
    })
  )
}

/** The `Bash(...)` entries of a settings file's `permissions.allow`. */
export function allowRules(settings: unknown): string[] {
  const allow = (settings as { permissions?: { allow?: unknown } } | null)?.permissions?.allow
  return Array.isArray(allow) ? allow.filter((rule): rule is string => typeof rule === 'string') : []
}

function bashRulePattern(rule: string): RegExp {
  const glob = (text: string) => text.split('*').map(part => part.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*')
  if (rule.endsWith(':*')) return new RegExp(`^${glob(rule.slice(0, -2))}(?:\\s.*)?$`, 's')
  if (rule.endsWith(' *')) return new RegExp(`^${glob(rule.slice(0, -2))}(?: .*)?$`, 's')
  return new RegExp(`^${glob(rule)}$`, 's')
}

/** Each git commit and git push the command runs, however it is reached. */
export function gitWriteCount(command: string): number {
  return calls(command).filter(call => call.program === 'git' && GIT_WRITES.has(call.subcommand ?? '')).length
}

export function mergesPr(command: string): boolean {
  return calls(command).some(call => call.program === 'gh' && call.group === 'pr' && call.action === 'merge')
}

export function changesPr(command: string): boolean {
  return calls(command).some(call => {
    if (call.program === 'git') return call.subcommand === 'push'
    if (call.group === 'api') return isPrApiWrite(call.args.slice(call.args.indexOf('api') + 1))
    return call.group === 'pr' && GH_PR_CHANGES.has(call.action ?? '')
  })
}

/** A `gh api` call that sends something to a PR or issue endpoint, or a GraphQL mutation. */
function isPrApiWrite(args: readonly string[]): boolean {
  const endpoint = positionals(args, GH_API_VALUE_OPTIONS, 'all')[0] ?? ''
  if (endpoint === 'graphql') return args.some(arg => /\bmutation\b/.test(arg))
  if (!PR_ENDPOINT.test(endpoint)) return false
  const method = args.find((arg, index) => index > 0 && (args[index - 1] === '-X' || args[index - 1] === '--method'))
  return method === undefined ? args.some(arg => GH_API_SENDS.has(arg)) : method.toUpperCase() !== 'GET'
}

export function createsPr(command: string): boolean {
  return calls(command).some(call => call.program === 'gh' && call.group === 'pr' && call.action === 'create')
}

export function runsGit(command: string): boolean {
  return calls(command).length > 0
}
