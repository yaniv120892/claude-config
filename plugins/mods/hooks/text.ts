export function truncate(text: string, length: number): string {
  return text.length > length ? `${text.slice(0, length)}…` : text
}

export function basename(path: string): string {
  return path.replace(/\/+$/, '').split('/').pop() ?? path
}
