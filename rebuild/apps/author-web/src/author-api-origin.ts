export function authorApiUrl(path: string): string {
  if (!path.startsWith('/api/')) {
    throw new Error('Author API requests must use the rebuild same-origin /api proxy.');
  }
  return path;
}

export function authorAssetUrl(path: string): string {
  if (!path.startsWith('/')) return path;
  if (!path.startsWith('/api/')) return path;
  return authorApiUrl(path);
}
