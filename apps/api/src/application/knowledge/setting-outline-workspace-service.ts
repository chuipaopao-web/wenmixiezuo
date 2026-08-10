import type { DatabaseSync } from 'node:sqlite';
import type { Clock } from '../../domain/ids.js';
import { DomainError, errorCodes } from '../../domain/errors.js';
import { assertBookScope, type BookScope } from '../../domain/scope.js';
import { SettingOutlineWorkspaceRepository } from '../../infrastructure/db/repositories/setting-outline-workspace-repository.js';

export const settingOutlineStatuses = [
  '待讨论', '讨论中', '候选待确认', '已确认', '稍后补充', '刻意留白', '不适用'
] as const;
export type SettingOutlineStatus = typeof settingOutlineStatuses[number];

export interface SettingOutlineWorkspaceItem {
  itemKey: string;
  groupTitle: string;
  label: string;
  prompt: string;
  sourceLabel: string;
  status: SettingOutlineStatus;
  custom: boolean;
  sortOrder: number;
  content: string | null;
  sourceDiscussionId: string | null;
  sourceDecisionId: string | null;
  candidateAt: string | null;
  confirmedAt: string | null;
  updatedAt: string;
}

export class SettingOutlineWorkspaceService {
  private readonly repository: SettingOutlineWorkspaceRepository;

  public constructor(database: DatabaseSync, private readonly clock: Clock) {
    this.repository = new SettingOutlineWorkspaceRepository(database);
  }

  public list(scope: BookScope): SettingOutlineWorkspaceItem[] {
    assertBookScope(scope);
    return this.repository.list(scope).map((row) => ({
      itemKey: row.item_key,
      groupTitle: row.group_title,
      label: row.label,
      prompt: row.prompt,
      sourceLabel: row.source_label,
      status: row.item_status as SettingOutlineStatus,
      custom: row.is_custom === 1,
      sortOrder: row.sort_order,
      content: row.content_text,
      sourceDiscussionId: row.source_discussion_id,
      sourceDecisionId: row.source_decision_id,
      candidateAt: row.candidate_at,
      confirmedAt: row.confirmed_at,
      updatedAt: row.updated_at
    }));
  }

  public save(scope: BookScope, input: {
    itemKey: string;
    groupTitle: string;
    label: string;
    prompt: string;
    sourceLabel: string;
    status: string;
    custom?: boolean;
    sortOrder?: number;
    content?: string | null;
  }): SettingOutlineWorkspaceItem {
    assertBookScope(scope);
    if (!settingOutlineStatuses.includes(input.status as SettingOutlineStatus)) {
      throw new DomainError(errorCodes.validation, '设定项状态无效');
    }
    const itemKey = required(input.itemKey, '设定项键', 100);
    const groupTitle = required(input.groupTitle, '设定板块', 80);
    const label = required(input.label, '设定项名称', 80);
    const prompt = required(input.prompt, '设定项说明', 600);
    const sourceLabel = required(input.sourceLabel, '模板来源', 120);
    const sortOrder = Number.isInteger(input.sortOrder) && input.sortOrder! >= 0 ? input.sortOrder! : 0;
    const existing = this.list(scope).find((item) => item.itemKey === itemKey);
    const contentText = optional(input.content, '设定内容', 20_000) ?? existing?.content ?? null;
    if (input.status === '已确认' && contentText === null) {
      throw new DomainError(errorCodes.validation, '确认设定项前必须先填写内容或确认讨论候选');
    }
    const now = this.clock.now().toISOString();
    this.repository.upsert(scope, {
      itemKey, groupTitle, label, prompt, sourceLabel,
      itemStatus: input.status, isCustom: input.custom === true, sortOrder,
      contentText,
      ...(input.status === '已确认' ? { confirmedAt: now } : {}),
      now
    });
    return this.list(scope).find((item) => item.itemKey === itemKey)!;
  }

  public initialize(scope: BookScope, items: Array<{
    itemKey: string;
    groupTitle: string;
    label: string;
    prompt: string;
    sourceLabel: string;
    custom?: boolean;
    sortOrder?: number;
  }>): SettingOutlineWorkspaceItem[] {
    assertBookScope(scope);
    if (items.length === 0 || items.length > 120) {
      throw new DomainError(errorCodes.validation, '设定模板必须包含1至120项');
    }
    const now = this.clock.now().toISOString();
    const seen = new Set<string>();
    for (const input of items) {
      const itemKey = required(input.itemKey, '设定项键', 100);
      if (seen.has(itemKey)) throw new DomainError(errorCodes.validation, `设定模板包含重复项：${itemKey}`);
      seen.add(itemKey);
      this.repository.insertIfMissing(scope, {
        itemKey,
        groupTitle: required(input.groupTitle, '设定板块', 80),
        label: required(input.label, '设定项名称', 80),
        prompt: required(input.prompt, '设定项说明', 600),
        sourceLabel: required(input.sourceLabel, '模板来源', 120),
        itemStatus: '待讨论',
        isCustom: input.custom === true,
        sortOrder: Number.isInteger(input.sortOrder) && input.sortOrder! >= 0 ? input.sortOrder! : 0,
        now
      });
    }
    return this.list(scope);
  }

  public recordDiscussionCandidate(scope: BookScope, input: {
    discussionId: string;
    decisionId: string;
    scopeText: string;
    content: string;
  }): SettingOutlineWorkspaceItem | null {
    return this.recordDiscussionCandidates(scope, input)[0] ?? null;
  }

  public recordDiscussionCandidates(scope: BookScope, input: {
    discussionId: string;
    decisionId: string;
    scopeText: string;
    content: string;
  }): SettingOutlineWorkspaceItem[] {
    assertBookScope(scope);
    const batch = parseSettingBatchTargets(input.scopeText);
    if (batch !== null) {
      const deposits = parseSettingOutlineDeposit(input.content);
      if (deposits.length === 0) return [];
      const allowed = new Set(batch.map((target) => target.itemKey));
      const now = this.clock.now().toISOString();
      for (const deposit of deposits) {
        if (!allowed.has(deposit.itemKey)) continue;
        const existing = this.list(scope).find((item) => item.itemKey === deposit.itemKey);
        if (existing === undefined) continue;
        this.repository.upsert(scope, {
          itemKey: existing.itemKey,
          groupTitle: existing.groupTitle,
          label: existing.label,
          prompt: existing.prompt,
          sourceLabel: existing.sourceLabel,
          itemStatus: '候选待确认',
          isCustom: existing.custom,
          sortOrder: existing.sortOrder,
          contentText: required(deposit.content, `设定项${deposit.itemKey}的讨论结论`, 20_000),
          sourceDiscussionId: input.discussionId,
          sourceDecisionId: input.decisionId,
          candidateAt: now,
          now
        });
      }
      return this.list(scope).filter((item) => (
        item.sourceDiscussionId === input.discussionId
        && item.sourceDecisionId === input.decisionId
      ));
    }
    const target = parseSettingTarget(input.scopeText);
    if (target === null) return [];
    const existing = target.itemKey === null
      ? this.repository.findByGroupAndLabel(scope, target.groupTitle, target.label)
      : this.list(scope).find((item) => item.itemKey === target.itemKey);
    if (existing === undefined) return [];
    const itemKey = 'item_key' in existing ? existing.item_key : existing.itemKey;
    const groupTitle = 'group_title' in existing ? existing.group_title : existing.groupTitle;
    const label = existing.label;
    const prompt = existing.prompt;
    const sourceLabel = 'source_label' in existing ? existing.source_label : existing.sourceLabel;
    const custom = 'is_custom' in existing ? existing.is_custom === 1 : existing.custom;
    const sortOrder = 'sort_order' in existing ? existing.sort_order : existing.sortOrder;
    const now = this.clock.now().toISOString();
    this.repository.upsert(scope, {
      itemKey, groupTitle, label, prompt, sourceLabel,
      itemStatus: '候选待确认', isCustom: custom, sortOrder,
      contentText: required(input.content, '讨论结论', 20_000),
      sourceDiscussionId: input.discussionId,
      sourceDecisionId: input.decisionId,
      candidateAt: now,
      now
    });
    return [this.list(scope).find((item) => item.itemKey === itemKey)!];
  }

  public activateGuidanceItem(scope: BookScope, itemKey: string): SettingOutlineWorkspaceItem {
    assertBookScope(scope);
    const items = this.list(scope);
    const current = items.find((item) => item.itemKey === itemKey);
    if (current === undefined) throw new DomainError(errorCodes.operationIncomplete, '当前设定项不存在', {}, false, 404);
    const now = this.clock.now().toISOString();
    for (const item of items) {
      if (item.itemKey === itemKey || item.status !== '讨论中') continue;
      this.repository.upsert(scope, {
        itemKey: item.itemKey,
        groupTitle: item.groupTitle,
        label: item.label,
        prompt: item.prompt,
        sourceLabel: item.sourceLabel,
        itemStatus: '待讨论',
        isCustom: item.custom,
        sortOrder: item.sortOrder,
        contentText: item.content,
        now
      });
    }
    if (current.status === '已确认' || current.status === '候选待确认') return current;
    this.repository.upsert(scope, {
      itemKey: current.itemKey,
      groupTitle: current.groupTitle,
      label: current.label,
      prompt: current.prompt,
      sourceLabel: current.sourceLabel,
      itemStatus: '讨论中',
      isCustom: current.custom,
      sortOrder: current.sortOrder,
      contentText: current.content,
      now
    });
    return this.list(scope).find((item) => item.itemKey === itemKey)!;
  }

  public recordGuidanceCandidate(scope: BookScope, itemKey: string, content: string): SettingOutlineWorkspaceItem {
    assertBookScope(scope);
    const current = this.list(scope).find((item) => item.itemKey === itemKey);
    if (current === undefined) throw new DomainError(errorCodes.operationIncomplete, '当前设定项不存在', {}, false, 404);
    const normalized = required(content, `${current.label}候选内容`, 20_000);
    const now = this.clock.now().toISOString();
    this.repository.upsert(scope, {
      itemKey: current.itemKey,
      groupTitle: current.groupTitle,
      label: current.label,
      prompt: current.prompt,
      sourceLabel: current.sourceLabel,
      itemStatus: '候选待确认',
      isCustom: current.custom,
      sortOrder: current.sortOrder,
      contentText: normalized,
      candidateAt: now,
      now
    });
    return this.list(scope).find((item) => item.itemKey === itemKey)!;
  }

  public confirmGuidanceCandidate(scope: BookScope, itemKey: string): SettingOutlineWorkspaceItem {
    assertBookScope(scope);
    const current = this.list(scope).find((item) => item.itemKey === itemKey);
    if (current === undefined) throw new DomainError(errorCodes.operationIncomplete, '当前设定项不存在', {}, false, 404);
    if (current.status !== '候选待确认' || current.content === null) {
      throw new DomainError(errorCodes.operationIncomplete, `“${current.label}”还没有可确认的候选内容`, {}, false, 409);
    }
    const now = this.clock.now().toISOString();
    this.repository.upsert(scope, {
      itemKey: current.itemKey,
      groupTitle: current.groupTitle,
      label: current.label,
      prompt: current.prompt,
      sourceLabel: current.sourceLabel,
      itemStatus: '已确认',
      isCustom: current.custom,
      sortOrder: current.sortOrder,
      contentText: current.content,
      sourceDiscussionId: current.sourceDiscussionId,
      sourceDecisionId: current.sourceDecisionId,
      confirmedAt: now,
      now
    });
    return this.list(scope).find((item) => item.itemKey === itemKey)!;
  }

  public confirmDiscussionCandidate(scope: BookScope, discussionId: string, decisionId: string): SettingOutlineWorkspaceItem | null {
    return this.confirmDiscussionCandidates(scope, discussionId, decisionId)[0] ?? null;
  }

  public confirmDiscussionCandidates(scope: BookScope, discussionId: string, decisionId: string): SettingOutlineWorkspaceItem[] {
    assertBookScope(scope);
    const existingRows = this.repository.listByDiscussion(scope, discussionId)
      .filter((row) => row.source_decision_id === decisionId && row.content_text !== null);
    if (existingRows.length === 0) return [];
    const now = this.clock.now().toISOString();
    for (const existing of existingRows) {
      this.repository.upsert(scope, {
        itemKey: existing.item_key,
        groupTitle: existing.group_title,
        label: existing.label,
        prompt: existing.prompt,
        sourceLabel: existing.source_label,
        itemStatus: '已确认',
        isCustom: existing.is_custom === 1,
        sortOrder: existing.sort_order,
        contentText: existing.content_text,
        sourceDiscussionId: discussionId,
        sourceDecisionId: decisionId,
        confirmedAt: now,
        now
      });
    }
    const keys = new Set(existingRows.map((row) => row.item_key));
    return this.list(scope).filter((item) => keys.has(item.itemKey));
  }
}

export function parseSettingOutlineDeposit(content: string): Array<{ itemKey: string; content: string }> {
  const workflowItems = parseSettingWorkflowArtifact(content);
  if (workflowItems !== null) return workflowItems;
  const marker = ['设定落库', '设定' + '大纲落库'].find((candidate) => content.includes(candidate));
  if (marker === undefined) return [];
  const markerIndex = content.indexOf(marker);
  for (const candidate of extractCompleteJsonObjects(content.slice(markerIndex + marker.length))) {
    try {
      const parsed = JSON.parse(candidate) as { items?: unknown };
      if (!Array.isArray(parsed.items)) continue;
      const items: Array<{ itemKey: string; content: string }> = [];
      for (const value of parsed.items) {
        if (typeof value !== 'object' || value === null) return [];
        const record = value as Record<string, unknown>;
        if (typeof record.itemKey !== 'string' || typeof record.content !== 'string') return [];
        const itemKey = record.itemKey.trim();
        const itemContent = record.content.trim();
        if (itemKey.length === 0 || itemContent.length < 8) return [];
        if (/(?:待老板|老板裁定|需老板|婉儿|红玉|主编|编剧|共识：|分歧：|方案[ABC])/u.test(itemContent)) {
          return [];
        }
        items.push({ itemKey, content: itemContent });
      }
      return items;
    } catch {
      // Try the next complete JSON object after the explicit marker.
    }
  }
  return [];
}

function parseSettingWorkflowArtifact(content: string): Array<{ itemKey: string; content: string }> | null {
  for (const candidate of extractCompleteJsonObjects(content)) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(candidate) as unknown;
    } catch {
      try {
        parsed = JSON.parse(repairUnescapedJsonQuotes(candidate)) as unknown;
      } catch {
        continue;
      }
    }
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) continue;
    const root = parsed as Record<string, unknown>;
    const fields = typeof root.fields === 'object' && root.fields !== null && !Array.isArray(root.fields)
      ? root.fields as Record<string, unknown>
      : root;
    const artifact = fields.workflowArtifact;
    if (typeof artifact !== 'object' || artifact === null || Array.isArray(artifact)) continue;
    const workflow = artifact as Record<string, unknown>;
    if (workflow.type !== 'setting_outline'
      || typeof workflow.payload !== 'object' || workflow.payload === null || Array.isArray(workflow.payload)) continue;
    const items = (workflow.payload as Record<string, unknown>).items;
    if (!Array.isArray(items)) return [];
    const normalized: Array<{ itemKey: string; content: string }> = [];
    for (const value of items) {
      if (typeof value !== 'object' || value === null || Array.isArray(value)) return [];
      const record = value as Record<string, unknown>;
      if (typeof record.itemKey !== 'string' || typeof record.content !== 'string') return [];
      const itemKey = record.itemKey.trim();
      const itemContent = record.content.trim();
      if (itemKey.length === 0 || itemContent.length < 8) return [];
      if (/(?:待老板|老板裁定|需老板|婉儿|红玉|主编|编剧|共识：|分歧：|方案[ABC])/u.test(itemContent)) return [];
      normalized.push({ itemKey, content: itemContent });
    }
    return normalized;
  }

  // The author-facing answer and the workflow artifact share one model response.
  // A stray, unescaped quote in the prose must not discard an otherwise valid,
  // schema-checked artifact.  Recover only the exact workflowArtifact property;
  // arbitrary prose is still never accepted as a setting candidate.
  const isolatedArtifact = extractNamedJsonObject(content, 'workflowArtifact');
  if (isolatedArtifact !== null) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(isolatedArtifact) as unknown;
    } catch {
      try {
        parsed = JSON.parse(repairUnescapedJsonQuotes(isolatedArtifact)) as unknown;
      } catch {
        return [];
      }
    }
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return [];
    const workflow = parsed as Record<string, unknown>;
    if (workflow.type !== 'setting_outline'
      || typeof workflow.payload !== 'object' || workflow.payload === null || Array.isArray(workflow.payload)) return [];
    const items = (workflow.payload as Record<string, unknown>).items;
    if (!Array.isArray(items)) return [];
    const normalized: Array<{ itemKey: string; content: string }> = [];
    for (const value of items) {
      if (typeof value !== 'object' || value === null || Array.isArray(value)) return [];
      const record = value as Record<string, unknown>;
      if (typeof record.itemKey !== 'string' || typeof record.content !== 'string') return [];
      const itemKey = record.itemKey.trim();
      const itemContent = record.content.trim();
      if (itemKey.length === 0 || itemContent.length < 8) return [];
      if (/(?:待老板|老板裁定|需老板|婉儿|红玉|主编|编剧|共识：|分歧：|方案[ABC])/u.test(itemContent)) return [];
      normalized.push({ itemKey, content: itemContent });
    }
    return normalized;
  }
  return null;
}

function repairUnescapedJsonQuotes(value: string): string {
  let inString = false;
  let escaped = false;
  let repaired = '';
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index]!;
    if (!inString) {
      if (character === '"') inString = true;
      repaired += character;
      continue;
    }
    if (escaped) {
      escaped = false;
      repaired += character;
      continue;
    }
    if (character === '\\') {
      escaped = true;
      repaired += character;
      continue;
    }
    if (character !== '"') {
      repaired += character;
      continue;
    }
    let nextIndex = index + 1;
    while (nextIndex < value.length && /\s/u.test(value[nextIndex]!)) nextIndex += 1;
    const next = value[nextIndex];
    if (next === ':' || next === ',' || next === '}' || next === ']' || next === undefined) {
      inString = false;
      repaired += character;
    } else {
      repaired += '\\"';
    }
  }
  return repaired;
}

function parseSettingTarget(scopeText: string): {
  itemKey: string | null;
  groupTitle: string;
  label: string;
} | null {
  if (!scopeText.includes('【设定专项讨论资料包】')) return null;
  const value = (name: string): string | null => {
    const match = scopeText.match(new RegExp(`^${name}：(.+)$`, 'mu'));
    return match?.[1]?.trim() ?? null;
  };
  const groupTitle = value('当前板块');
  const label = value('当前设定项');
  if (groupTitle === null || label === null) return null;
  return { itemKey: value('设定项编号'), groupTitle, label };
}

function parseSettingBatchTargets(scopeText: string): Array<{ itemKey: string }> | null {
  if (!['【设定成组讨论资料包】', '【设定' + '大纲成组讨论资料包】'].some((marker) => scopeText.includes(marker))) return null;
  const match = scopeText.match(/^本批设定项JSON：(.+)$/mu);
  if (match?.[1] === undefined) return [];
  try {
    const parsed = JSON.parse(match[1]) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.flatMap((value) => {
      if (typeof value !== 'object' || value === null) return [];
      const itemKey = (value as Record<string, unknown>).itemKey;
      return typeof itemKey === 'string' && itemKey.trim().length > 0
        ? [{ itemKey: itemKey.trim() }]
        : [];
    });
  } catch {
    return [];
  }
}

function extractCompleteJsonObjects(value: string): string[] {
  const objects: string[] = [];
  for (let start = 0; start < value.length; start += 1) {
    if (value[start] !== '{') continue;
    let depth = 0;
    let inString = false;
    let escaped = false;
    for (let index = start; index < value.length; index += 1) {
      const character = value[index]!;
      if (inString) {
        if (escaped) escaped = false;
        else if (character === '\\') escaped = true;
        else if (character === '"') inString = false;
        continue;
      }
      if (character === '"') inString = true;
      else if (character === '{') depth += 1;
      else if (character === '}') {
        depth -= 1;
        if (depth === 0) {
          objects.push(value.slice(start, index + 1));
          start = index;
          break;
        }
      }
    }
  }
  return objects;
}

function extractNamedJsonObject(value: string, propertyName: string): string | null {
  const propertyToken = `"${propertyName}"`;
  let searchFrom = 0;
  while (searchFrom < value.length) {
    const propertyIndex = value.indexOf(propertyToken, searchFrom);
    if (propertyIndex < 0) return null;
    let cursor = propertyIndex + propertyToken.length;
    while (/\s/u.test(value[cursor] ?? '')) cursor += 1;
    if (value[cursor] !== ':') {
      searchFrom = cursor;
      continue;
    }
    cursor += 1;
    while (/\s/u.test(value[cursor] ?? '')) cursor += 1;
    if (value[cursor] !== '{') {
      searchFrom = cursor;
      continue;
    }

    let depth = 0;
    let inString = false;
    let escaped = false;
    for (let index = cursor; index < value.length; index += 1) {
      const character = value[index]!;
      if (inString) {
        if (escaped) escaped = false;
        else if (character === '\\') escaped = true;
        else if (character === '"') inString = false;
        continue;
      }
      if (character === '"') inString = true;
      else if (character === '{') depth += 1;
      else if (character === '}') {
        depth -= 1;
        if (depth === 0) return value.slice(cursor, index + 1);
      }
    }
    return null;
  }
  return null;
}

function required(value: string, label: string, maxLength: number): string {
  const normalized = value?.trim();
  if (normalized.length === 0 || normalized.length > maxLength) {
    throw new DomainError(errorCodes.validation, `${label}不能为空且不能超过${maxLength}字`);
  }
  return normalized;
}

function optional(value: string | null | undefined, label: string, maxLength: number): string | null {
  if (value === undefined || value === null || value.trim().length === 0) return null;
  return required(value, label, maxLength);
}
