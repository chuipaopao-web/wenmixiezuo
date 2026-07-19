import { createHash } from 'node:crypto';
import type { Clock, IdGenerator } from '../../domain/ids.js';
import { creativeMemberContracts, type CreativeRoleKey } from '../../contracts/agent-team-v2.js';
import type { PromptTemplateRepository } from '../../infrastructure/db/repositories/prompt-template-repository.js';

export interface CompiledRolePrompt { snapshotId: string; roleKey: CreativeRoleKey; version: number; hash: string; system: string; task: string }
export class PromptCompiler {
  public constructor(private readonly repository: PromptTemplateRepository, private readonly ids: IdGenerator, private readonly clock: Clock) {}
  public compile(roleKey: CreativeRoleKey, task: { objective: string; mode: 'discussion' | 'formal_production' | 'review'; contextManifest: string[]; outputSchema: unknown }): CompiledRolePrompt {
    const contract = creativeMemberContracts.find((item) => item.roleKey === roleKey);
    if (contract === undefined) throw new Error(`未知岗位：${roleKey}`);
    const hardRules = ['只在当前书籍和任务范围工作', '不展示或保存内部思维链', '不伪造来源、状态或异模型意见',
      '候选与讨论不自动进入正史', '保护人物生命力与合理惊喜，不把软倾向机械化'];
    const publicContract = { title: contract.shortTitle, member: contract.memberName, summary: contract.publicSummary,
      responsibilities: contract.responsibilities, boundaries: contract.boundaries };
    const retrievalProfile = { focus: contract.retrievalFocus, contextManifest: task.contextManifest };
    const template = { publicContract, hardRules, outputSchema: task.outputSchema, retrievalProfile };
    const hash = createHash('sha256').update(JSON.stringify(template)).digest('hex');
    const active = this.repository.active(roleKey);
    const snapshotId = active?.hash === hash ? active.id : this.ids.next();
    const version = active?.hash === hash ? active.version : (active?.version ?? 0) + 1;
    if (active?.hash !== hash) this.repository.insert({ id: snapshotId, roleKey, version, contract: publicContract, hardRules,
      outputSchema: task.outputSchema, retrievalProfile, hash, now: this.clock.now().toISOString() });
    const system = [`你是${contract.memberName}（${contract.shortTitle}）。${contract.publicSummary}。`,
      `职责：${contract.responsibilities.join('；')}。`, `边界：${contract.boundaries.join('；')}。`, hardRules.join('；')].join('\n');
    return { snapshotId, roleKey, version, hash, system, task: `模式：${task.mode}\n目标：${task.objective}\n可用资料清单：${task.contextManifest.join('、') || '无'}` };
  }
}
