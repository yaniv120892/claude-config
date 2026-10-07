export function slash(command: string, args = '') {
  return {
    command,
    args,
    origin: { kind: 'composer' as const },
    presentation: { isFullscreen: true, columns: 120 },
  }
}
