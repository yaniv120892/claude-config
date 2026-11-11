import { describe, expect, test } from 'claude-code/testing'

import { asLease, asSharedBoard, isLeasedToOther, isNewerBoard } from '../hooks/share'

const BOARD = { prs: [], tickets: [], error: null, ticketsError: null, readAt: 100, quota: null }

describe('the board the sessions share', () => {
  test('a lease held by another session blocks the read until it runs out; my own never does', async () => {
    const lease = { owner: 'session-b', until: 1000 }
    expect(isLeasedToOther({ lease, owner: 'session-a', now: 999 })).toBe(true)
    expect(isLeasedToOther({ lease, owner: 'session-a', now: 1000 })).toBe(false)
    expect(isLeasedToOther({ lease, owner: 'session-b', now: 999 })).toBe(false)
    expect(isLeasedToOther({ lease: null, owner: 'session-a', now: 0 })).toBe(false)
  })

  test('reads only a well-formed stored board and lease', async () => {
    expect(asSharedBoard({ board: BOARD, nextReadAt: 200 })).toEqual({ board: BOARD, nextReadAt: 200 })
    expect(asSharedBoard({ board: BOARD })).toBe(null)
    expect(asSharedBoard(undefined)).toBe(null)
    expect(asLease({ owner: 'a', until: 1 })).toEqual({ owner: 'a', until: 1 })
    expect(asLease({ owner: 'a' })).toBe(null)
  })

  test('a stored board is taken only when it is newer than the one shown', async () => {
    expect(isNewerBoard({ shown: null, shared: BOARD })).toBe(true)
    expect(isNewerBoard({ shown: BOARD, shared: BOARD })).toBe(false)
    expect(isNewerBoard({ shown: BOARD, shared: { ...BOARD, readAt: 101 } })).toBe(true)
  })
})
