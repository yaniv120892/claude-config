// A slash command as the person types it at the prompt.
export function slash(command: string, args = '') {
  return {
    command,
    args,
    origin: { kind: 'composer' as const },
    presentation: { isFullscreen: true, columns: 120 },
  }
}
