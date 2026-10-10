import { splitCommands } from './git-write'

// Where each `git commit` or `git push` in a command runs, followed through the
// command in order: each `cd`, a `-C` on that git call, and the variables the
// command itself assigns. A directory that cannot be read off the text (a `$VAR`
// the command never set, `cd $(...)`) is null, never a guess: the guard stays
// out of those, and the git write gate still asks about the write.

export const OPT_OUT = 'ALLOW_DEFAULT_BRANCH_WRITE=1'

// `deletedBranches` names the branches a push only deletes; null for a commit, or a push
// that sends anything or names a branch it cannot read.
export type GitWrite = { directory: string | null; isOptedOut: boolean; deletedBranches: string[] | null }

const ASSIGNMENT = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/s
const WRAPPERS = new Set(['sudo', 'env', 'command', 'nice', 'time', 'exec'])
const SHELLS = new Set(['bash', 'sh', 'zsh'])
const GIT_VALUE_OPTIONS = new Set(['-c', '--git-dir', '--work-tree', '--namespace', '--super-prefix', '--config-env'])
const WRITES = new Set(['commit', 'push'])
const PUSH_VALUE_OPTIONS = new Set(['-o', '--push-option', '--repo', '--receive-pack', '--exec'])

type Scope = { directory: string | null; variables: Map<string, string> }

export function gitWrites(command: string, cwd: string, home: string | null): GitWrite[] {
  const variables = new Map<string, string>()
  if (home !== null) variables.set('HOME', home)
  return writesIn(command, { directory: cwd, variables })
}

function writesIn(command: string, scope: Scope): GitWrite[] {
  const found: GitWrite[] = []
  for (const words of splitCommands(command)) {
    const texts = words.map(word => word.text)
    let start = 0
    while (start < texts.length && ASSIGNMENT.test(texts[start] ?? '')) start++
    const prefix = texts.slice(0, start)
    while (start < texts.length && WRAPPERS.has(texts[start] ?? '')) start++
    const program = texts[start]?.split('/').pop()
    const args = texts.slice(start + 1)

    if (program === undefined) {
      for (const assignment of prefix) remember(scope, assignment)
    } else if (program === 'cd') {
      scope.directory = changeDirectory(scope, args[0])
    } else if (program === 'git') {
      const write = gitWrite(scope, args, prefix)
      if (write !== null) found.push(write)
    } else if (SHELLS.has(program) && args[0] === '-c' && args[1] !== undefined) {
      found.push(...writesIn(args[1], { ...scope, variables: new Map(scope.variables) }))
    } else if (program === 'eval') {
      found.push(...writesIn(args.join(' '), scope))
    }
  }
  return found
}

function gitWrite(scope: Scope, args: readonly string[], prefix: readonly string[]): GitWrite | null {
  let directory = scope.directory
  let index = 0
  while (index < args.length && (args[index] ?? '').startsWith('-')) {
    const option = args[index]
    if (option === '-C') {
      directory = directory === null ? null : resolvePath(directory, expand(scope, args[index + 1]))
      index += 2
    } else {
      index += GIT_VALUE_OPTIONS.has(option ?? '') ? 2 : 1
    }
  }
  const subcommand = args[index] ?? ''
  if (!WRITES.has(subcommand)) return null
  const deletedBranches = subcommand === 'push' ? pushDeletes(scope, args.slice(index + 1)) : null
  return { directory, isOptedOut: prefix.includes(OPT_OUT), deletedBranches }
}

function pushDeletes(scope: Scope, args: readonly string[]): string[] | null {
  let isDelete = false
  const positional: string[] = []
  for (let index = 0; index < args.length; index++) {
    const arg = args[index] ?? ''
    if (arg === '--delete' || arg === '-d') isDelete = true
    else if (PUSH_VALUE_OPTIONS.has(arg)) index++
    else if (!arg.startsWith('-')) positional.push(arg)
  }
  const refspecs = positional.slice(1)
  if (refspecs.length === 0) return null
  const branches = refspecs.map(refspec => {
    const name = isDelete ? refspec : /^:./.test(refspec) ? refspec.slice(1) : null
    if (name === null || name.includes(':')) return null
    return expand(scope, name)?.replace(/^refs\/heads\//, '') ?? null
  })
  return branches.every(branch => branch !== null) ? branches : null
}

function remember(scope: Scope, assignment: string): void {
  const [, name = '', value = ''] = ASSIGNMENT.exec(assignment) ?? []
  const expanded = expand(scope, value)
  if (expanded === null) scope.variables.delete(name)
  else scope.variables.set(name, expanded)
}

/** A bare `cd` reads as unknown: the splitter ends a word list at `$(`, so `cd $(x)` looks the same. */
function changeDirectory(scope: Scope, target: string | undefined): string | null {
  if (scope.directory === null || target === undefined || target === '-') return null
  return resolvePath(scope.directory, expand(scope, target))
}

function expand(scope: Scope, text: string | undefined): string | null {
  if (text === undefined) return null
  const home = scope.variables.get('HOME')
  const tilded = text === '~' || text.startsWith('~/') ? (home === undefined ? null : home + text.slice(1)) : text
  if (tilded === null) return null
  let isKnown = true
  const expanded = tilded.replace(/\$\{([A-Za-z_][A-Za-z0-9_]*)\}|\$([A-Za-z_][A-Za-z0-9_]*)/g, (_, braced, bare) => {
    const value = scope.variables.get(braced ?? bare)
    if (value === undefined) isKnown = false
    return value ?? ''
  })
  return isKnown && !expanded.includes('$') ? expanded : null
}

export function resolvePath(base: string, path: string | null): string | null {
  if (path === null) return null
  const parts = path.startsWith('/') ? [] : base.split('/').filter(Boolean)
  for (const part of path.split('/')) {
    if (part === '..') parts.pop()
    else if (part !== '' && part !== '.') parts.push(part)
  }
  return `/${parts.join('/')}`
}
