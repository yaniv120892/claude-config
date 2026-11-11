export type GitLocation = {
  /** The repository's name, or null outside a repository. */
  repo: string | null
  /** The session directory's own name. */
  dir: string
  /** The checked-out branch, or null on a detached HEAD or outside a repository. */
  branch: string | null
  isDirty: boolean
}

export type Band = {
  location: GitLocation
  model: string
}

export type UsageLimit = {
  /** `5h` or `wk`: the key a toasted window is remembered by. */
  label: string
  /** `5-hour` or `Weekly`, as a toast says it. */
  name: string
  percent: number
  /** ISO 8601; null when the window reports no reset. */
  resetsAt: string | null
}

export type PlanTask = {
  id: string
  subject: string
  /** The status the model declared; a deleted task is dropped, never kept. */
  status: 'pending' | 'in_progress' | 'completed'
}

/** One session's plan in the store, under `planProgress:<session id>`. */
export type StoredPlan = {
  tasks: PlanTask[]
  /** Epoch milliseconds of the last task call that changed it. */
  updatedAt: number
}

declare module 'claude-code' {
  interface PluginState {
    mods: {
      /** Null until the band's first read. A reload that changes Band's fields bumps the atom's shape tag. */
      band: Shaped<Band | null>
      /** The main loop's plan, from its TodoWrite, TaskCreate and TaskUpdate calls; a subagent's never land here. */
      planTasks: Shaped<PlanTask[]>
    }
  }
}
