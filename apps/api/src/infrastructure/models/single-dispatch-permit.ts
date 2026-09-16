import { readFileSync, writeFileSync, existsSync, renameSync } from 'node:fs';
import type { DatabaseSync } from 'node:sqlite';
import { ModelAdapterError, type ModelAdapter } from './model-adapter.js';

/**
 * 单节点真实调用许可闸门（d7fc67f5复核项4，2026-09-16）。
 *
 * 仅隔离探针使用：包装模型resolver，硬性保证指定run的指定步骤只发生一次真实dispatch，
 * 其余一切dispatch在网络前阻止。生产装配（app-server）不引用本模块，生产执行器不变。
 *
 * 绑定：run + step（step id = `${runId}:${stepNode}` 的attempt）+ 快照模型 +
 * 输入hash（网关落库tm2_model_calls.request_hash，消耗时录入许可文件供审计）。
 * 消耗状态持久化到persistPath：进程重启后许可不重置，已成功/已发出的调用不会重复。
 * 许可在委托真实适配器之前消耗（宁可未知也不重复发网络请求）；目标步骤之外的
 * 任何dispatch（后续卷卡、自检、审查、其他run）一律在网络前拒绝。
 */

export interface SingleDispatchPermitOptions {
  db: DatabaseSync;
  /** 目标run id（如B方案run）。 */
  runId: string;
  /** 目标步骤节点（如 'volume-card:0'）。 */
  stepNode: string;
  /** 快照冻结的目标步骤成员模型（如 'glm-5.3'）；模型不符即拒绝。 */
  expectedModelId: string;
  /** 消耗状态持久化文件（JSON）；已存在且consumed=true时一切dispatch被阻止。 */
  persistPath: string;
}

interface PermitFile {
  consumed: boolean;
  runId: string;
  stepNode: string;
  attemptId?: string;
  requestHash?: string;
  consumedAt?: string;
  outcome?: 'dispatched';
}

function blocked(reason: string): never {
  // 不可重试的确定性拒绝：服务不会自动重发，run如实失败并保留进度。
  throw new ModelAdapterError(`单节点验证门禁：${reason}`, 'request_failure', false);
}

export function createSingleDispatchResolver(
  base: (provider: string, model: string) => ModelAdapter,
  options: SingleDispatchPermitOptions
): (provider: string, model: string) => ModelAdapter {
  const stepId = `${options.runId}:${options.stepNode}`;
  const readPermit = (): PermitFile | null => {
    if (!existsSync(options.persistPath)) return null;
    try { return JSON.parse(readFileSync(options.persistPath, 'utf8')) as PermitFile; }
    catch { blocked('许可文件不可解析，为防重复调用全部阻止'); }
  };
  const consume = (permit: PermitFile): void => {
    const tmp = `${options.persistPath}.tmp`;
    writeFileSync(tmp, JSON.stringify(permit, null, 1));
    renameSync(tmp, options.persistPath);
  };
  return (provider, model) => {
    const adapter = base(provider, model);
    return {
      provider: adapter.provider,
      modelId: adapter.modelId,
      inputContext: adapter.inputContext?.bind(adapter),
      async generate(request, signal) {
        const existing = readPermit();
        if (existing?.consumed) blocked(`许可已消耗（${existing.stepNode} attempt=${existing.attemptId ?? '?'}），禁止任何再次dispatch`);
        // 模型绑定在resolver装配侧（ModelRequest不带modelId字段）：适配器实际模型必须与快照冻结一致。
        if (adapter.modelId !== options.expectedModelId) {
          blocked(`模型${adapter.modelId}与快照冻结模型${options.expectedModelId}不符`);
        }
        // 目标绑定：request.id必须是目标步骤的已登记attempt（服务claim时落tm2_attempts）。
        // ModelRequest字段是requestId（不是id）：attempt绑定以此为准。
        const attempt = options.db.prepare('SELECT 1 AS ok FROM tm2_attempts WHERE id=? AND step=?').get(request.requestId, stepId) as { ok: number } | undefined;
        if (!attempt) blocked(`dispatch目标不是${stepId}的登记attempt（实得id=${request.requestId.slice(0, 8)}…），网络前阻止`);
        const callRow = options.db.prepare('SELECT request_hash FROM tm2_model_calls WHERE id=?').get(request.requestId) as { request_hash: string } | undefined;
        // 先消耗再委托：dispatch中途崩溃也不允许重发，未知结果人工核对。
        consume({
          consumed: true, runId: options.runId, stepNode: options.stepNode,
          attemptId: request.requestId, requestHash: callRow?.request_hash,
          consumedAt: new Date().toISOString(), outcome: 'dispatched'
        });
        return adapter.generate(request, signal);
      }
    };
  };
}
