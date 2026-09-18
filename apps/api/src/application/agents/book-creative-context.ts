import type { DatabaseSync } from 'node:sqlite';
import { creativeDirective, type CreativeProfile, type CreativeWorkType } from '@wenmi/agent-catalog';

/** Owner-scoped book preferences; rules only, never the opening inspiration catalogue. */
export function withBookCreativeProfile(database: DatabaseSync, ownerId: string, bookId: string, prompt: string, stage: string): string {
  const row = database.prepare('SELECT profile_json FROM book_creative_profiles WHERE owner_id=? AND book_id=?').get(ownerId,bookId) as {profile_json:string} | undefined;
  if (!row) return prompt;
  let payload: Record<string, unknown>;
  try { const parsed: unknown = JSON.parse(prompt); payload=parsed !== null && typeof parsed==='object' && !Array.isArray(parsed) ? parsed as Record<string,unknown> : {task:parsed}; }
  catch { payload={task:prompt}; }
  // Technical retries keep the original embedded direction, rather than reading a new version into it.
  if (payload.creativeDirection) return prompt;
  return JSON.stringify({...payload,creativeDirection:creativeDirective(JSON.parse(row.profile_json) as CreativeProfile,stage)});
}

/** 作品类型回读：创作偏好快照随确认入架写入 book_creative_profiles；无快照、解析失败或未知值的旧书按长篇处理。 */
export function readBookCreativeWorkType(database: DatabaseSync, ownerId: string, bookId: string): CreativeWorkType {
  const row = database.prepare('SELECT profile_json FROM book_creative_profiles WHERE owner_id=? AND book_id=?').get(ownerId,bookId) as {profile_json:string} | undefined;
  if (!row) return 'novel';
  try {
    const parsed = JSON.parse(row.profile_json) as { workType?: unknown };
    return parsed.workType === 'short_story' || parsed.workType === 'memoir' || parsed.workType === 'script' ? parsed.workType : 'novel';
  } catch {
    return 'novel';
  }
}
