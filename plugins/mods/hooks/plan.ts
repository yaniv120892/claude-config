import type { PlanTask, StoredPlan } from '../types'
import { asRecord } from './store'
import { truncate } from './text'

export type PlanSummary = {
  /** `building` while a task is in progress, `done` once every task is marked completed, else `planned`. */
  phase: 'planned' | 'building' | 'done'
  completed: number
  total: number
  /** The first in-progress task's title; null when none is in progress. */
  active: string | null
}

/** One stored plan per session, so sessions never share or overwrite one. */
export const PLAN_KEY_PREFIX = 'planProgress:'
/** A session's plan is dropped a day after its last task call. */
export const PLAN_TTL_MS = 24 * 60 * 60 * 1000
// Below this many columns for the title, the line drops it rather than show a stub.
const MIN_TITLE_COLUMNS = 12

/** TodoWrite sends the whole list each time, so it replaces the plan; a todo left out is gone. */
export function fromTodos(todos: readonly { content: string; status: PlanTask['status'] }[]): PlanTask[] {
  return todos.map((todo, index) => ({ id: `todo-${index}`, subject: todo.content, status: todo.status }))
}

export function addTask(tasks: readonly PlanTask[], id: string, subject: string): PlanTask[] {
  return [...tasks.filter(task => task.id !== id), { id, subject, status: 'pending' }]
}

/** `deleted` removes the task; an id the plan does not have changes nothing. */
export function updateTask(
  tasks: readonly PlanTask[],
  change: { taskId: string; status?: PlanTask['status'] | 'deleted'; subject?: string },
): PlanTask[] {
  const { taskId, status, subject } = change
  if (status === 'deleted') return tasks.filter(task => task.id !== taskId)
  return tasks.map(task =>
    task.id === taskId ? { ...task, status: status ?? task.status, subject: subject ?? task.subject } : task,
  )
}

export function summarize(tasks: readonly PlanTask[]): PlanSummary | null {
  if (tasks.length === 0) return null
  const completed = tasks.filter(task => task.status === 'completed').length
  const active = tasks.find(task => task.status === 'in_progress')?.subject ?? null
  const phase = active !== null ? 'building' : completed === tasks.length ? 'done' : 'planned'
  return { phase, completed, total: tasks.length, active }
}

/** The count part of the line: `building · 2/5 tasks`. */
export function planCount(summary: PlanSummary): string {
  return `${summary.phase} · ${summary.completed}/${summary.total} ${summary.total === 1 ? 'task' : 'tasks'}`
}

/** The active title cut to what `columns` leaves after the count, or null where too little is left. */
export function planTitle(summary: PlanSummary, columns: number): string | null {
  if (summary.active === null) return null
  const room = columns - planCount(summary).length - ' · '.length
  return room < MIN_TITLE_COLUMNS ? null : truncate(summary.active, room - 1)
}

/** A stored plan's tasks, or null when the entry is malformed or past its day. */
export function freshTasks(stored: unknown, now: number): PlanTask[] | null {
  const { tasks, updatedAt } = asRecord<Partial<StoredPlan>>(stored)
  if (!Array.isArray(tasks) || typeof updatedAt !== 'number') return null
  return now - updatedAt > PLAN_TTL_MS ? null : tasks
}
