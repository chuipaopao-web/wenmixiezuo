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
    this.repository.upsert(scope, {
      itemKey, groupTitle, label, prompt, sourceLabel,
      itemStatus: input.status, isCustom: input.custom === true, sortOrder,
      now: this.clock.now().toISOString()
    });
    return this.list(scope).find((item) => item.itemKey === itemKey)!;
  }
}

function required(value: string, label: string, maxLength: number): string {
  const normalized = value?.trim();
  if (normalized.length === 0 || normalized.length > maxLength) {
    throw new DomainError(errorCodes.validation, `${label}不能为空且不能超过${maxLength}字`);
  }
  return normalized;
}
