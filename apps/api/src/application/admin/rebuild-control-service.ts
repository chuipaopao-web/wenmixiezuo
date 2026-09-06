import { createHash } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import type {
  RebuildConfiguration, RebuildControlData, RebuildSourceFeature, RebuildUnit
} from '@wenmi/v7-backend';
import { DomainError } from '../../domain/errors.js';
import { V7TaskAuditRepository, type V7TaskAuditRow } from '../../infrastructure/db/repositories/v7-task-audit-repository.js';
import type { RuntimeConfig } from '../../infrastructure/runtime-config.js';

export const REBUILD_PLAN_PATH = 'docs/REBUILD_EXECUTION_PLAN.md';
const STATUS_VALUES = [
  ['待讨论', '讨论中', '已定', '待调整', '暂缓', '取消'],
  ['未开始', '开发中', '已实现', '不适用'],
  ['未开始', '开发中', '已实现', '不适用'],
  ['未验证', '验收中', '通过', '未通过', '阻塞', '不适用'],
  ['未发布', '试用中', '已发布', '已回退', '不适用']
];

// These are explicit associations with current V7 audit categories, not claims that
// a new rebuild unit has been implemented or passed an end-to-end probe.
const TASK_KINDS: Readonly<Record<string, string[]>> = {
  'RB-19': ['opening_design'], 'RB-21': ['setting_item', 'setting_item_fusion', 'setting_item_review', 'setting_item_redesign', 'setting_item_revision', 'setting_catalog_recommendation', 'setting_final_review'],
  'RB-22': ['planning_recipe', 'planning_tree'], 'RB-23': ['planning_tree'], 'RB-24': ['planning_tree'],
  'RB-26': ['creation_workflow'], 'RB-27': ['creation_workflow'],
  'RB-28': ['formalization'], 'RB-29': ['formalization', 'character_maintenance', 'planning_maintenance'],
  'RB-30': ['planning_maintenance'], 'RB-32': ['character_maintenance', 'character_context'],
  'RB-34': ['title_design', 'cover_design'], 'RB-37': ['managed_creation'], 'RB-39': ['stage_settlement']
};

const CONFIGURATIONS: RebuildConfiguration[] = [
  { id: 'agents', name: '成员、模型与任务策略', description: '查看成员启用情况、模型和参数，进入现有治理页面修改。',
    scope: '沿用现有配置校验和任务快照；进入后核对具体生效范围。', section: 'agents', unitIds: ['RB-16', 'RB-48'] },
  { id: 'prompts', name: '提示词与上下文', description: '查看提示资产、版本和任务使用资料，按现有流程预览、发布或恢复草稿。',
    scope: '发布新版本不会改写过去任务的提示快照。', section: 'prompt-context', unitIds: ['RB-17', 'RB-49'] },
  { id: 'membership', name: '会员权益办理', description: '进入现有会员页面办理或核对权益，保留操作流水。',
    scope: '这是当前人工办理能力；自动支付、退款和全局价格配置仍需后续开发。', section: 'memberships', unitIds: ['RB-13', 'RB-44'] },
  { id: 'issues', name: '问题处理', description: '查看真实失败任务与作者反馈，记录处理进度和备注。',
    scope: '关闭问题记录不代表任务恢复成功，也不证明软件没有BUG。', section: 'issues', unitIds: ['RB-47'] },
  { id: 'safety', name: '内容安全与申诉策略', description: '后续按功能合同开发审核、限制和申诉配置。',
    scope: '配置未完成；不能通过普通开关关闭账号隔离或正文保护。', section: null, unitIds: ['RB-16.1', 'RB-27.1', 'RB-47.1'] },
  { id: 'operations', name: '备份、发布与环境配置', description: '后续建设可审计的运行管理；目前按项目部署流程执行。',
    scope: '本页不显示密钥，也不提供未经验证的一键迁移、清库或发布。', section: null, unitIds: ['RB-56', 'RB-58', 'RB-59'] }
];

function invalidPlan(): never {
  throw new DomainError('REBUILD_PLAN_UNAVAILABLE', '开发顺序表暂时无法核对，请维护者检查源文档后重新加载。', {}, true, 503);
}

/** Parse only our fixed table/card contract. Never execute or render document HTML. */
export function parseRebuildPlan(markdown: string): Pick<RebuildControlData, 'units' | 'sourceFeatures'> & { version: string; currentBatch?: string; currentWork?: string } {
  const version = markdown.match(/^> 版本([^\s·]+)/mu)?.[1];
  const currentProgress = parseCurrentProgress(markdown);
  const table = markdown.match(/^## 5\.[\s\S]*?(?=^## 6\.)/mu)?.[0];
  const cards = markdown.match(/^## 6\.[\s\S]*?(?=^## 7\.)/mu)?.[0];
  const coverage = markdown.match(/^## 11\.[\s\S]*/mu)?.[0];
  if (!version || !table || !cards || !coverage) invalidPlan();
  const units: RebuildUnit[] = [];
  let stage = '';
  for (const line of table.split(/\r?\n/u)) {
    const heading = line.match(/^### (5\.\d+) (.+)$/u);
    if (heading) stage = heading[2]!;
    if (!/^\| \[RB-/u.test(line)) continue;
    const cells = line.split('|').slice(1, -1).map((part) => part.trim());
    const id = cells[0]?.match(/^\[(RB-\d{2}(?:\.\d+)?)\]\(#rb-[\d-]+\)$/u)?.[1];
    if (!id || !stage || cells.length !== 9 || units.some((unit) => unit.id === id)) invalidPlan();
    for (let index = 0; index < STATUS_VALUES.length; index++) {
      if (!STATUS_VALUES[index]!.includes(cells[index + 3]!)) invalidPlan();
    }
    units.push({ id, name: cells[1]!, order: units.length + 1, stage,
      dependencies: cells[2]!.match(/RB-\d{2}(?:\.\d+)?/gu) ?? [],
      design: cells[3]!, frontend: cells[4]!, backend: cells[5]!, acceptance: cells[6]!, deployment: cells[7]!,
      evidence: plainText(cells[8]!), details: [], sourceFeatures: [], taskKinds: TASK_KINDS[id] ?? [] });
  }
  const seenCards = new Set<string>();
  for (const match of cards.matchAll(/^### (RB-\d{2}(?:\.\d+)?) (.+)\r?\n([\s\S]*?)(?=^### RB-|$(?![\s\S]))/gmu)) {
    const unit = units.find((item) => item.id === match[1]);
    if (!unit || seenCards.has(unit.id) || match[2] !== unit.name) invalidPlan();
    seenCards.add(unit.id);
    unit.details = [...match[3]!.matchAll(/^- \*\*([^*]+)\*\*：(.+)$/gmu)]
      .map((item) => ({ label: item[1]!, text: plainText(item[2]!) }));
    if (!['讨论', '前端交付', '后端逐项实现', '重点验收', '依赖与详细设计']
      .every((label) => unit.details.some((item) => item.label === label))) invalidPlan();
  }
  if (units.length === 0 || seenCards.size !== units.length) invalidPlan();
  for (const unit of units) {
    if (unit.acceptance === '通过' && ![unit.frontend, unit.backend].every((value) => ['已实现', '不适用'].includes(value))) invalidPlan();
    for (const id of unit.dependencies) {
      const dependency = units.find((item) => item.id === id);
      if (!dependency || dependency.order >= unit.order) invalidPlan();
    }
  }
  const sourceFeatures: RebuildSourceFeature[] = [];
  for (const line of coverage.split(/\r?\n/u)) {
    if (!/^\| F-/u.test(line)) continue;
    const cells = line.split('|').slice(1, -1).map((part) => part.trim());
    if (cells.length !== 6 || !/^F-\d{4}$/u.test(cells[0]!) || sourceFeatures.some((item) => item.id === cells[0])) invalidPlan();
    const feature: RebuildSourceFeature = { id: cells[0]!, name: cells[1]!, decision: cells[2]!,
      unitIds: coverageUnitIds(cells[3]!, units),
      specification: cells[4]!, acceptance: cells[5]! };
    if (!feature.unitIds.length) invalidPlan();
    for (const id of feature.unitIds) {
      const unit = units.find((item) => item.id === id);
      if (!unit) invalidPlan();
      unit.sourceFeatures.push(feature);
    }
    sourceFeatures.push(feature);
  }
  if (!sourceFeatures.length) invalidPlan();
  return { version, ...currentProgress, units, sourceFeatures };
}

function plainText(value: string): string {
  return value.replace(/\[([^\]]+)\]\([^)]*\)/gu, '$1').replace(/\*\*|`/gu, '').trim();
}

function parseCurrentProgress(markdown: string): { currentBatch?: string; currentWork?: string } {
  const section = markdown.match(/^## 3\.[\s\S]*?(?=^## \d+\.|$(?![\s\S]))/mu)?.[0];
  if (!section) return {};
  const result: { currentBatch?: string; currentWork?: string } = {};
  for (const [label, field] of [['当前批次', 'currentBatch'], ['当前工作', 'currentWork']] as const) {
    const matches = [...section.matchAll(new RegExp(`^- \\*\\*${label}\\*\\*：(.+)$`, 'gmu'))];
    if (matches.length > 1) invalidPlan();
    const value = matches[0]?.[1];
    if (value === undefined) continue;
    const text = plainText(value);
    if (!text) invalidPlan();
    result[field] = text;
  }
  return result;
}

function coverageUnitIds(value: string, units: RebuildUnit[]): string[] {
  const expanded = plainText(value).replace(/(RB-\d{2}(?:\.\d+)?)\s*[—–]\s*(RB-\d{2}(?:\.\d+)?)/gu, (_match, first: string, last: string) => {
    const start = units.findIndex((unit) => unit.id === first);
    const end = units.findIndex((unit) => unit.id === last);
    if (start < 0 || end < start) invalidPlan();
    return units.slice(start, end + 1).map((unit) => unit.id).join('、');
  });
  return [...new Set(expanded.match(/RB-\d{2}(?:\.\d+)?/gu) ?? [])];
}

export function summarizeTaskSignals(rows: V7TaskAuditRow[]): RebuildControlData['runtime']['taskSignals'] {
  const groups = new Map<string, RebuildControlData['runtime']['taskSignals'][number]>();
  for (const row of rows) {
    const group = groups.get(row.taskType) ?? { taskKind: row.taskType, observed: 0, succeeded: 0, failed: 0, other: 0, latestAt: row.occurredAt };
    group.observed++;
    if (['succeeded', 'completed'].includes(row.status)) group.succeeded++;
    else if (['failed', 'partially_failed'].includes(row.status)) group.failed++;
    else group.other++;
    if (row.occurredAt > group.latestAt) group.latestAt = row.occurredAt;
    groups.set(row.taskType, group);
  }
  return [...groups.values()];
}

export async function readRebuildControl(config: RuntimeConfig, database: DatabaseSync): Promise<RebuildControlData> {
  const path = resolve(config.projectRoot, REBUILD_PLAN_PATH);
  // Read one document snapshot for both progress and details. A malformed or
  // unavailable source fails explicitly rather than returning an empty green map.
  const snapshot = await Promise.all([readFile(path, 'utf8'), stat(path)]).catch(() => invalidPlan());
  const plan = parseRebuildPlan(snapshot[0]);
  const now = new Date();
  const windowStart = new Date(now.getTime() - 86_400_000).toISOString();
  const audit = new V7TaskAuditRepository(database);
  const taskCount = audit.count({ start: windowStart });
  const rows = audit.list({ start: windowStart, limit: 1000 });
  const heartbeat = audit.latestWorkerHeartbeat();
  const age = heartbeat ? now.getTime() - Date.parse(heartbeat) : NaN;
  const openIssueCount = audit.issuePage({ status: 'open', offset: 0, limit: 1 }).total
    + audit.issuePage({ status: 'in_progress', offset: 0, limit: 1 }).total;
  const sourceProgress = {
    ...(plan.currentBatch === undefined ? {} : { currentBatch: plan.currentBatch }),
    ...(plan.currentWork === undefined ? {} : { currentWork: plan.currentWork })
  };
  return {
    source: { version: plan.version, ...sourceProgress, digest: createHash('sha256').update(snapshot[0]).digest('hex'),
      updatedAt: snapshot[1].mtime.toISOString(), path: REBUILD_PLAN_PATH },
    units: plan.units, sourceFeatures: plan.sourceFeatures, configurations: CONFIGURATIONS,
    runtime: { checkedAt: now.toISOString(), origin: config.publicOrigin ?? '本地或隔离服务', releaseId: config.releaseId,
      database: 'responding', worker: age >= 0 && age <= 15_000 ? 'recent_heartbeat' : 'stale_or_missing',
      heartbeatAt: heartbeat, windowStart, taskCount, sampledCount: rows.length,
      taskSignals: summarizeTaskSignals(rows), openIssueCount }
  };
}
