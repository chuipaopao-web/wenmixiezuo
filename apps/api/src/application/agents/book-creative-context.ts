import type { DatabaseSync } from 'node:sqlite';
import { creativeDirective, CREATIVE_WORK_TYPE_LABELS, type CreativeProfile, type CreativeWorkType } from '@wenmi/agent-catalog';
import { DomainError, errorCodes } from '../../domain/errors.js';

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

/**
 * 长篇小说任务链能力门禁（R2）：设定编选、故事线推荐、时光机设计/重试等会新建或继续
 * 长篇任务的入口，必须在写任务、排队或占用生成预算之前调用。非长篇（含旧快照缺失
 * 以外的三种已开放开书类型）明确拒绝；无快照旧书与长篇不受影响。历史任务与候选
 * 只读保留，不在此处删除、改型或取消。
 */
export function assertNovelChainOpen(database: DatabaseSync, ownerId: string, bookId: string): void {
  const workType = readBookCreativeWorkType(database, ownerId, bookId);
  if (workType === 'novel') return;
  throw new DomainError(
    errorCodes.validation,
    `${CREATIVE_WORK_TYPE_LABELS[workType] ?? '该类型'}的后续创作工作台尚未开放：不能新建或继续长篇小说设计任务。开书资料已保留，可正常查看与编辑。`,
    {},
    false,
    409
  );
}

/**
 * 开书入口开放边界（OPENING-NOVEL-CLOSE-01）：新开书任务、修订与确认入架新建书籍
 * 只放行长篇小说；短篇/自传/剧本保留类型枚举、存储与历史结果可读，但新请求在此
 * 明确拒绝。放在服务层入口调用，不塞进底层解析器；调用方按请求偏好或冻结任务
 * 类型传入。幂等重放已由各入口先行返回，不会走到这里。
 */
export function assertOpeningWorkTypeOpen(workType: CreativeWorkType): void {
  if (workType === 'novel') return;
  throw new DomainError(
    errorCodes.validation,
    `${CREATIVE_WORK_TYPE_LABELS[workType] ?? '该作品类型'}暂未开放，目前仅支持长篇小说。`,
    {},
    false,
    409
  );
}
