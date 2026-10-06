// Which Bash commands the git write gate asks about.
//
// The command is split into simple commands and words the way a shell would
// (quotes, `;`, `&&`, `|`, `$(`, newlines), so global options such as
// `git -C "$REPO" push` cannot hide the subcommand, and `gh pr view --json
// mergeable` is not mistaken for a merge. A quoted word that holds a command of
// its own (`bash -c "git push"`) is checked too, which errs toward asking when
// a string merely mentions a write.

export const GATED_COMMANDS = ['git commit', 'git push', 'gh pr create', 'gh pr merge'] as const

const SEPARATORS = new Set([';', '&', '|', '(', ')', '{', '}', '\n', '`'])
// Prefixes that run the command after them: `sudo git push`, `env X=1 git push`.
const WRAPPERS = new Set(['sudo', 'env', 'command', 'exec', 'nohup', 'time', 'xargs', 'nice'])
const GIT_VALUE_OPTIONS = new Set(['-C', '-c', '--git-dir', '--work-tree', '--namespace', '--super-prefix', '--config-env'])
const GH_VALUE_OPTIONS = new Set(['-R', '--repo'])
const ASSIGNMENT = /^[A-Za-z_][A-Za-z0-9_]*=/

type Word = { text: string; isQuoted: boolean }

/** The command's simple commands, each as its words, quotes removed. */
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

/** The words after any `X=1` assignments and wrappers such as `sudo` or `env -i`. */
function commandWords(words: readonly Word[]): string[] {
  let start = 0
  while (start < words.length) {
    const text = words[start]?.text ?? ''
    if (ASSIGNMENT.test(text)) {
      start++
    } else if (WRAPPERS.has(text)) {
      start++
      while (start < words.length && (words[start]?.text ?? '').startsWith('-')) start++
    } else {
      break
    }
  }
  return words.slice(start).map(one => one.text)
}

/** The words after the program's global options, which may take a value. */
function afterOptions(words: readonly string[], valueOptions: ReadonlySet<string>): string[] {
  let index = 1
  while (index < words.length && (words[index] ?? '').startsWith('-')) {
    index += valueOptions.has(words[index] ?? '') ? 2 : 1
  }
  return words.slice(index)
}

function isWriteCommand(words: readonly Word[]): boolean {
  const program = commandWords(words)
  const name = (program[0] ?? '').split('/').pop()
  if (name === 'git') {
    const [subcommand] = afterOptions(program, GIT_VALUE_OPTIONS)
    return subcommand === 'commit' || subcommand === 'push'
  }
  if (name === 'gh') {
    const [group, action] = afterOptions(program, GH_VALUE_OPTIONS)
    return group === 'pr' && (action === 'create' || action === 'merge')
  }
  return false
}

export function isGitWrite(command: string): boolean {
  return splitCommands(command).some(
    words => isWriteCommand(words) || words.some(word => word.isQuoted && /\s/.test(word.text) && isGitWrite(word.text)),
  )
}
