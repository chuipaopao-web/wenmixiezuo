export function bookStatusLabel(status: string): string {
  return ({ active: '创作中', archived: '已归档' } as Record<string, string>)[status] ?? status;
}

export function shortId(value: string): string {
  return value.length <= 10 ? value : value.slice(0, 8);
}
