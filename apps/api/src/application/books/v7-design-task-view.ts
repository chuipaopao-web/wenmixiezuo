export interface V7DesignTaskView {
  designId: string;
  taskKind: 'title_design' | 'cover_design';
  bookId: string;
  bookTitle: string;
  status: 'working' | 'succeeded' | 'failed';
  statusText: string;
  memberNames: string[];
  createdAt: string;
  updatedAt: string;
}

export function designTaskLimit(value: unknown): number {
  const parsed = typeof value === 'string' ? Number.parseInt(value, 10) : Number.NaN;
  return Number.isInteger(parsed) ? Math.min(100, Math.max(1, parsed)) : 50;
}
