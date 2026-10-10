export function asRecord<T extends object>(stored: unknown): T {
  return (stored !== null && typeof stored === 'object' && !Array.isArray(stored) ? stored : {}) as T
}
