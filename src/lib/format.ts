export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

export function stripExtension(name: string): string {
  const i = name.lastIndexOf('.');
  return i > 0 ? name.slice(0, i) : name;
}
