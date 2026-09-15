import {digest} from '@wenmi/time-machine-core';
import {DomainError,errorCodes} from '../../domain/errors.js';
import {manifestSourcesSignature,type StorylineSelectionSnapshot} from './time-machine-sources.js';
import {StorylineSelectionRepository} from '../../infrastructure/db/repositories/storyline-selection-repository.js';

/** S1-A：故事线结构化确认的请求解析、来源校验、规范哈希与供生成intent的构建。
 * 请求边界（不是文学建议）：选择ID≤30、自添线≤20、标题≤80字符、描述≤500、authorNote≤1000、最终intent≤4000。
 * 超限明确提示精简、不截断；名称/描述/role取服务端推荐，不接受客户端改写既有推荐内容。
 * 6ad621dd修正：authorNote非字符串直接拒绝（不静默转空串）；DB查询已提取到StorylineSelectionRepository。 */

export interface StorylineSelectionInput {
  recommendationRunId: string;
  recommendationHash: string;
  preparationVersion: string;
  selectedLineIds: string[];
  addedLines: { title: string; description: string }[];
  shape: 'auto' | 'single' | 'multiple';
  ensemble: boolean;
  authorNote: string;
}

export const SELECTION_LIMITS = {selectedLineIds: 30, addedLines: 20, title: 80, description: 500, authorNote: 1000, intent: 4000} as const;

function bad(message: string, status = 400): DomainError {
  return new DomainError(errorCodes.validation, message, {}, true, status);
}

function asTrimmedString(value: unknown, label: string, max: number): string {
  if (typeof value !== 'string') throw bad(`${label}格式不正确`);
  const trimmed = value.trim();
  if (trimmed.length > max) throw bad(`${label}过长（最多${max}字），请精简后再确认`);
  return trimmed;
}

/** 严格解析design-runs的selection负载；旧intent-only请求在路由层先行拒绝。 */
export function parseStorylineSelectionInput(body: unknown): {idempotencyKey: string; selection: StorylineSelectionInput} {
  if (body === null || typeof body !== 'object') throw bad('提交格式不正确');
  const record = body as Record<string, unknown>;
  if (typeof record.idempotempotencyKey === 'string') throw bad('提交格式不正确');
  if (typeof record.idempotencyKey !== 'string' || !record.idempotencyKey.trim() || record.idempotencyKey.length > 160) throw bad('操作编号无效');
  return {idempotencyKey: record.idempotencyKey, selection: parseStorylineSelectionContent(record.selection)};
}

/** 严格解析故事线选择内容本体：design-runs确认与故事线资料编辑保存共用同一解析与上限（第25.3节）。 */
export function parseStorylineSelectionContent(raw: unknown): StorylineSelectionInput {
  if (raw === null || typeof raw !== 'object') throw bad('请刷新页面后重新确认故事线');
  const s = raw as Record<string, unknown>;
  if (typeof s.recommendationRunId !== 'string' || !s.recommendationRunId.trim()) throw bad('请刷新页面后重新确认故事线');
  if (typeof s.recommendationHash !== 'string' || !s.recommendationHash.trim()) throw bad('请刷新页面后重新确认故事线');
  if (typeof s.preparationVersion !== 'string' || !s.preparationVersion.trim()) throw bad('请刷新页面后重新确认故事线');
  if (!Array.isArray(s.selectedLineIds)) throw bad('提交格式不正确');
  const selectedLineIds: string[] = [];
  for (const id of s.selectedLineIds) {
    if (typeof id !== 'string' || !id.trim()) throw bad('提交格式不正确');
    if (!selectedLineIds.includes(id)) selectedLineIds.push(id);
  }
  if (selectedLineIds.length > SELECTION_LIMITS.selectedLineIds) throw bad(`勾选故事线最多${SELECTION_LIMITS.selectedLineIds}条，请精简后再确认`);
  if (!Array.isArray(s.addedLines)) throw bad('提交格式不正确');
  const addedLines: {title: string; description: string}[] = [];
  for (const entry of s.addedLines) {
    if (entry === null || typeof entry !== 'object') throw bad('提交格式不正确');
    const line = entry as Record<string, unknown>;
    const title = asTrimmedString(line.title, '自添故事线标题', SELECTION_LIMITS.title);
    const description = asTrimmedString(line.description, '自添故事线描述', SELECTION_LIMITS.description);
    if (!title) throw bad('自添故事线标题不能为空');
    addedLines.push({title, description});
  }
  if (addedLines.length > SELECTION_LIMITS.addedLines) throw bad(`自添故事线最多${SELECTION_LIMITS.addedLines}条，请精简后再确认`);
  if (!['auto', 'single', 'multiple'].includes(String(s.shape))) throw bad('提交格式不正确');
  if (typeof s.ensemble !== 'boolean') throw bad('提交格式不正确');
  // 严格字符串：authorNote必须始终为字符串（缺失/非字符串都拒绝，不静默丢作者输入）
  if (typeof s.authorNote !== 'string') throw bad('作者补充格式不正确');
  const authorNote = s.authorNote.trim();
  if (authorNote.length > SELECTION_LIMITS.authorNote) throw bad(`作者补充最多${SELECTION_LIMITS.authorNote}字，请精简后再确认`);
  if (selectedLineIds.length + addedLines.length === 0) throw bad('请至少选择或添加一条故事线');
  return {recommendationRunId: s.recommendationRunId, recommendationHash: s.recommendationHash, preparationVersion: s.preparationVersion, selectedLineIds, addedLines, shape: s.shape as StorylineSelectionInput['shape'], ensemble: s.ensemble, authorNote};
}

/** 对成功推荐result_json的规范摘要：前端不可伪造，服务端在state与校验时同口径计算。 */
export function canonicalRecommendationHash(resultJson: string): string {
  const parsed = JSON.parse(resultJson) as {greeting?:unknown; lines?:unknown; structure?:unknown; reason?:unknown};
  const lines = Array.isArray(parsed.lines) ? parsed.lines.map(entry => {
    const line = entry as Record<string, unknown>;
    return {id: String(line.id ?? ''), role: String(line.role ?? ''), title: String(line.title ?? ''), description: String(line.description ?? ''), recommended: line.recommended === true};
  }) : [];
  return digest({greeting: String(parsed.greeting ?? ''), lines, structure: String(parsed.structure ?? ''), reason: String(parsed.reason ?? '')});
}

interface RecommendLine {id: string; role: string; title: string; description: string}

function parseRecommendLines(resultJson: string): {lines: RecommendLine[]; structure: 'single' | 'multiple'} {
  let parsed: {lines?: unknown; structure?: unknown};
  try { parsed = JSON.parse(resultJson); } catch { throw bad('推荐不存在或尚未完成，请刷新后重新确认', 404); }
  if (!Array.isArray(parsed.lines) || !parsed.lines.length || (parsed.structure !== 'single' && parsed.structure !== 'multiple')) throw bad('推荐不存在或尚未完成，请刷新后重新确认', 404);
  const lines: RecommendLine[] = [];
  for (const entry of parsed.lines) {
    const line = entry as Record<string, unknown>;
    if (typeof line.id !== 'string' || typeof line.title !== 'string' || typeof line.description !== 'string' || !['main', 'through', 'stage'].includes(String(line.role))) throw bad('推荐不存在或尚未完成，请刷新后重新确认', 404);
    lines.push({id: line.id, role: String(line.role), title: line.title, description: line.description});
  }
  return {lines, structure: parsed.structure};
}

function roleLabel(role: string): string { return role === 'main' ? '主线' : role === 'through' ? '支线' : '阶段线'; }

/** 规范requestHash：只覆盖作者可变部分与来源三要素；parse与幂等回放共用同一函数，不依赖属性顺序。 */
export function selectionRequestHash(selection: StorylineSelectionInput): string {
  return digest(JSON.stringify([
    selection.recommendationRunId,
    selection.recommendationHash,
    selection.preparationVersion,
    selection.selectedLineIds,
    selection.addedLines.map(line => [line.title, line.description]),
    selection.shape,
    selection.ensemble,
    selection.authorNote
  ]));
}

/** 校验选择来源并构建供生成的intent与规范requestHash。全部为确定性检查，不调用模型。
 * DB读取经StorylineSelectionRepository（6ad621dd第6项）。 */
export function validateStorylineSelection(repository: StorylineSelectionRepository, scope: {ownerId: string; bookId: string}, selection: StorylineSelectionInput, currentPreparationVersion: string | null, currentManifestSignature: string): {intent: string; selectionSnapshot: StorylineSelectionSnapshot} {
  const requestHash = selectionRequestHash(selection);
  const row = repository.findRecommendationRun(selection.recommendationRunId);
  if (!row || row.owner_id !== scope.ownerId || row.book_id !== scope.bookId) throw bad('推荐不存在或尚未完成，请刷新后重新确认', 404);
  if (row.kind !== 'recommend' || row.state !== 'succeeded' || row.result_json === null) throw bad('推荐尚未完成，请先等待主编完成推荐', 409);
  if (canonicalRecommendationHash(row.result_json) !== selection.recommendationHash) throw bad('推荐结果已更新，请刷新页面后重新确认故事线', 409);
  if (currentPreparationVersion === null || selection.preparationVersion !== currentPreparationVersion) throw bad('设定资料已变化，请重新核对后再确认故事线', 409);
  let snapshotSources:{kind:string;id:string;revision:string;hash:string}[];
  try { snapshotSources = (JSON.parse(row.snapshot_json) as {manifest:{sources:{kind:string;id:string;revision:string;hash:string}[]}}).manifest.sources; } catch { throw bad('推荐不存在或尚未完成，请刷新后重新确认', 404); }
  if (manifestSourcesSignature({sources:snapshotSources}) !== currentManifestSignature) throw bad('推荐所依据的资料已变化，请刷新后重新确认故事线', 409);
  const {lines, structure} = parseRecommendLines(row.result_json);
  const known = new Map(lines.map(line => [line.id, line]));
  for (const id of selection.selectedLineIds) if (!known.has(id)) throw bad(`勾选的故事线不在本次推荐内（${id}），请刷新后重新选择`, 400);
  const chosen = [
    ...selection.selectedLineIds.map(id => { const line = known.get(id)!; return `${roleLabel(line.role)}·${line.title}（${line.description}）`; }),
    ...selection.addedLines.map(line => `${line.title}（${line.description}）`)
  ];
  const structureHint = selection.shape === 'auto' ? (structure === 'multiple' ? '（主编建议多线交织）' : '（主编建议单主线推进）') : '';
  const shapeText = selection.shape === 'auto' ? '由主编推荐' : selection.shape === 'single' ? '单主线推进' : '多线交织';
  const intent = `选择的故事线：${chosen.join('；')}${selection.authorNote ? `。作者补充：${selection.authorNote}` : ''}。故事展开方式：${shapeText}${selection.ensemble ? '；也希望配角拥有自己的完整故事' : ''}${structureHint}`;
  if (intent.length > SELECTION_LIMITS.intent) throw bad(`确认内容过长（最多${SELECTION_LIMITS.intent}字），请精简勾选或补充后再确认`, 400);
  return {intent, selectionSnapshot: {recommendationRunId: selection.recommendationRunId, recommendationHash: selection.recommendationHash, preparationVersion: selection.preparationVersion, selectedLineIds: selection.selectedLineIds, addedLines: selection.addedLines, shape: selection.shape, ensemble: selection.ensemble, authorNote: selection.authorNote, requestHash}};
}
