// Commands are split into words the way a shell would, and every `git` or `gh`
// word is read as a program start wherever it stands, so a keyword (`do git
// push`), a wrapper (`timeout 60 git push`) or a global option (`git -C "$R"
// push`) cannot hide a write. Text that merely mentions a write is asked about
// too: a false ask costs a click, a false pass an unapproved push.

export const GATED_COMMANDS = ['git commit', 'git push', 'gh pr create', 'gh pr merge'] as const

const SEPARATORS = new Set([';', '&', '|', '(', ')', '{', '}', '\n', '`'])
const GIT_VALUE_OPTIONS = new Set(['-C', '-c', '--git-dir', '--work-tree', '--namespace', '--super-prefix', '--config-env'])
const GH_VALUE_OPTIONS = new Set(['-R', '--repo'])
const GIT_WRITES = new Set(['commit', 'push'])
const GH_PR_WRITES = new Set(['create', 'merge'])
// What else a command does to a PR, so the status band rereads it.
const GH_PR_CHANGES = new Set(['create', 'merge', 'ready', 'edit', 'close', 'reopen', 'review', 'comment'])

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

type Call = { program: 'git'; subcommand: string | undefined } | { program: 'gh'; group: string | undefined; action: string | undefined }

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
        const [group, action] = positionals(texts.slice(index + 1), GH_VALUE_OPTIONS, 'all')
        found.push({ program: 'gh', group, action })
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

export function changesPr(command: string): boolean {
  return calls(command).some(call =>
    call.program === 'git' ? call.subcommand === 'push' : call.group === 'pr' && GH_PR_CHANGES.has(call.action ?? ''),
  )
}

export function runsGit(command: string): boolean {
  return calls(command).length > 0
}
