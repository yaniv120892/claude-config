import type { Board, BoardLease, SharedBoard } from '../types'

export const LEASE_MS = 60_000

type Json = Record<string, unknown>

function record(value: unknown): Json {
  return typeof value === 'object' && value !== null ? { ...value } : {}
}

/** The board another session stored, or null when nothing usable is stored. */
export function asSharedBoard(stored: unknown): SharedBoard | null {
  return isSharedBoard(stored) ? stored : null
}

export function asLease(stored: unknown): BoardLease | null {
  const lease = record(stored)
  const { owner, until } = lease
  return typeof owner === 'string' && typeof until === 'number' ? { owner, until } : null
}

/** Whether another session holds a claim on the read that has not run out. */
export function isLeasedToOther({ lease, owner, now }: { lease: BoardLease | null; owner: string; now: number }): boolean {
  return lease !== null && lease.owner !== owner && lease.until > now
}

/** Whether the stored board is newer than the one this session shows. */
export function isNewerBoard({ shown, shared }: { shown: Board | null; shared: Board }): boolean {
  return shown === null || shared.readAt > shown.readAt
}

function isSharedBoard(stored: unknown): stored is SharedBoard {
  const shared = record(stored)
  const board = record(shared.board)
  const isBoard = Array.isArray(board.prs) && Array.isArray(board.tickets) && typeof board.readAt === 'number'
  return isBoard && typeof shared.nextReadAt === 'number'
}
