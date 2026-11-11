/** A JSON value read as an object: its own fields, or none for anything else. */
export function record(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null ? { ...value } : {}
}
