import { describe, expect, it } from 'vitest';
import { V7_PROMPT_SOURCE_ASSETS, sha256, stableStringify, type V7PromptAssetVersion } from '@wenmi/v7-backend';
import { compileV7RuntimePrompt } from '../../apps/api/src/application/agents/v7-runtime-prompt-compiler.js';

const base = {
  requestId: 'request-001',
  ownerId: 'owner-001',
  bookId: 'book-001',
  taskId: 'task-001',
  memberKey: 'planner-glm-5-3',
  runtimeRoleKey: 'outline_writer',
  modelProfileKey: 'glm-5.3',
  taskKind: 'chapter_outline' as const,
  workstationKey: 'chapter_outline' as const,
  sourcePrompt: JSON.stringify({ operation: 'chapter_outline', authorInstruction: '本章让张三第一次独立带队。' }),
  governanceRevision: 8,
  temperature: 0.56,
  maxOutputTokens: 12_000,
  createdAt: '2026-08-28T08:00:00.000Z'
};

describe('V7运行时提示词分层编译', () => {
  it('把全局成员固定岗位与当前工位分开冻结，不使用永久成员倾向', () => {
    const result = compileV7RuntimePrompt(base);
    expect(result.fixedRoleKey).toBe('planning_writer');
    expect(result.manifest.roleKey).toBe('planning_writer');
    expect(result.manifest.workstationKey).toBe('chapter_outline');
    expect(result.manifest).toMatchObject({
      provider: 'volcengine-ark-coding-plan', modelId: 'glm-5.3', plan: 'coding', maxOutputTokens: 12_000
    });
    expect(result.manifest.compiledPrompt).toContain('本章让张三第一次独立带队');
    expect(result.manifest.compiledPrompt).toContain('把当前链责任变成可以直接写的章纲');
    expect(result.manifest.compiledPrompt).not.toContain('promptInstruction');
    expect(result.manifest.skillVersionIds).toContain('skill.data-boundary@2');
  });

  it('要求调用方冻结规范治理模型键，不接受具体供应商模型ID', () => {
    expect(() => compileV7RuntimePrompt({
      ...base,
      modelProfileKey: 'doubao-seedream-5-0-260128'
    })).toThrow('未批准的模型档案');
  });

  it('同一冻结请求产生相同合同、资料包和最终提示哈希', () => {
    const first = compileV7RuntimePrompt(base);
    const second = compileV7RuntimePrompt(base);
    expect(second.taskContract.contractId).toBe(first.taskContract.contractId);
    expect(second.contextPack.contextPackId).toBe(first.contextPack.contextPackId);
    expect(second.manifest.compiledPromptHash).toBe(first.manifest.compiledPromptHash);
  });

  it('规划维护任务直接冻结为记录编辑，不生成临时维护岗位', () => {
    const result = compileV7RuntimePrompt({
      ...base,
      memberKey: 'compat-continuity-member',
      runtimeRoleKey: 'continuity_editor',
      taskKind: 'planning_maintenance',
      workstationKey: 'full_book_route',
      sourcePrompt: JSON.stringify({ operation: 'planning_maintenance', settlementVersionId: 'settlement-v1' })
    });
    expect(result.fixedRoleKey).toBe('continuity_editor');
    expect(result.manifest.roleKey).toBe('continuity_editor');
    expect(result.manifest.compiledPrompt).not.toContain('planning_maintainer');
  });

  it('冻结当前创作动作模式，区分首次、按意见修改、融合与修复', () => {
    for (const operationMode of ['fresh', 'revise', 'fusion', 'repair'] as const) {
      const result = compileV7RuntimePrompt({ ...base, operationMode });
      expect(result.taskContract.operationMode).toBe(operationMode);
      expect(result.manifest.operationMode).toBe(operationMode);
      expect(result.manifest.compiledPrompt).toContain(`\"operationMode\":\"${operationMode}\"`);
    }
  });

  it('技术重试原样复用首次PromptManifest，即使当前已发布工位版本和参数已经变化', () => {
    const original = compileV7RuntimePrompt(base);
    const newerAssets = V7_PROMPT_SOURCE_ASSETS.map((asset): V7PromptAssetVersion => asset.assetKey === 'workstation.chapter_outline'
      ? {
          ...asset,
          assetId: 'workstation.chapter_outline@later-published-99',
          version: 99,
          content: { ...asset.content, responsibility: '这是失败之后才发布的新提示，技术重试不得使用。' }
        }
      : asset);
    const retried = compileV7RuntimePrompt({
      ...base,
      requestId: 'request-001-technical-attempt-2',
      operationMode: 'retry',
      retrySnapshot: original,
      promptAssets: newerAssets,
      governanceRevision: 999,
      temperature: 0.99,
      createdAt: '2026-08-28T09:00:00.000Z'
    });
    expect(retried).toBe(original);
    expect(retried.manifest.manifestId).toBe(original.manifest.manifestId);
    expect(retried.manifest.compiledPromptHash).toBe(original.manifest.compiledPromptHash);
    expect(retried.manifest.workstationPromptVersionId).toBe('workstation.chapter_outline@2');
    expect(retried.manifest.governanceRevision).toBe(8);
    expect(retried.manifest.temperature).toBe(0.56);
    expect(retried.manifest.compiledPrompt).not.toContain('失败之后才发布的新提示');
    expect(() => compileV7RuntimePrompt({ ...base, operationMode: 'retry' }))
      .toThrow('技术重试必须复用首次调用已经冻结的PromptManifest快照');
    expect(() => compileV7RuntimePrompt({
      ...base,
      operationMode: 'retry',
      retrySnapshot: original,
      maxOutputTokens: 12_001
    })).toThrow('不能更换具体模型绑定或最大输出Token');
    expect(() => compileV7RuntimePrompt({
      ...base,
      memberKey: 'planner-kimi-k3',
      modelProfileKey: 'kimi-k3',
      operationMode: 'retry',
      retrySnapshot: original
    })).toThrow('不能更换成员、模型');
    expect(() => compileV7RuntimePrompt({
      ...base,
      operationMode: 'retry',
      retrySnapshot: original,
      sourcePrompt: JSON.stringify({ operation: 'chapter_outline', authorInstruction: '趁重试偷偷换成另一章。' })
    })).toThrow('技术重试不能带入新的作者意见或资料');
  });

  it('优先冻结节点已经给出的细化任务合同，并从开书载荷记录作者意见版本', () => {
    const embedded = compileV7RuntimePrompt({
      ...base,
      sourcePrompt: JSON.stringify({
        task: { ideaVersion: 7 },
        taskContract: {
          operationMode: 'revise',
          authorInstructionVersion: 7,
          objective: '只按作者意见修改当前章纲。',
          mustPreserve: ['未被点名的章纲责任'],
          allowedChanges: ['作者明确点名的场景'],
          forbiddenChanges: ['改写上一章正文'],
          successCriteria: ['修改后仍能直接写作'],
          outputContract: { schema: 'chapter-outline-v2' },
          basedOnTaskId: 'outline-task-v1'
        }
      })
    });
    expect(embedded.taskContract).toMatchObject({
      operationMode: 'revise',
      objective: '只按作者意见修改当前章纲。',
      mustPreserve: ['未被点名的章纲责任'],
      outputContract: { schema: 'chapter-outline-v2' },
      authorInstructionVersion: 7,
      basedOnTaskId: 'outline-task-v1'
    });
  });

  it('作者主动重新设计使用新任务和新合同快照，并明确追溯原任务与意见版本', () => {
    const original = compileV7RuntimePrompt(base);
    const redesigned = compileV7RuntimePrompt({
      ...base,
      requestId: 'request-redesign-002',
      taskId: 'task-redesign-002',
      sourcePrompt: JSON.stringify({
        authorInstructionVersion: 2,
        taskContract: {
          operationMode: 'revise',
          basedOnTaskId: original.taskContract.taskId,
          objective: '按作者第二版意见重新设计当前章纲。'
        },
        authorInstruction: '保留张三带队，但把胜利改成有代价的险胜。'
      })
    });
    expect(redesigned.taskContract).toMatchObject({
      taskId: 'task-redesign-002',
      operationMode: 'revise',
      basedOnTaskId: 'task-001',
      authorInstructionVersion: 2
    });
    expect(redesigned.taskContract.contractId).not.toBe(original.taskContract.contractId);
    expect(redesigned.manifest.manifestId).not.toBe(original.manifest.manifestId);
    expect(redesigned.manifest.taskContractId).toBe(redesigned.taskContract.contractId);
    expect(() => compileV7RuntimePrompt({
      ...base,
      requestId: 'request-redesign-without-parent',
      taskId: 'task-redesign-without-parent',
      sourcePrompt: JSON.stringify({
        authorInstructionVersion: 2,
        taskContract: { operationMode: 'revise' },
        authorInstruction: '重做当前章纲。'
      })
    })).toThrow('作者重新设计任务必须绑定被修改的原任务');
  });

  it('作者意见尚未形成正式版本时不把零写入冻结合同', () => {
    const result = compileV7RuntimePrompt({
      ...base,
      sourcePrompt: JSON.stringify({
        authorInstructionVersion: 0,
        task: { ideaVersion: 0 },
        taskContract: { authorInstructionVersion: 0 }
      })
    });
    expect(result.taskContract.authorInstructionVersion).toBeNull();
  });

  it('使用管理员当前发布的精确版本，并把结构化节点合同作为对象而不是转义字符串传入', () => {
    const customAssets = V7_PROMPT_SOURCE_ASSETS.map((asset): V7PromptAssetVersion => {
      if (asset.assetKey !== 'workstation.chapter_outline') return asset;
      return {
        ...asset,
        assetId: 'workstation.chapter_outline@admin-published-2',
        version: 2,
        summary: '管理员发布的章纲工位版本',
        content: {
          ...asset.content,
          responsibility: '先核对当前链的兑现责任，再设计可直接写作的一章。'
        }
      };
    });
    const result = compileV7RuntimePrompt({ ...base, promptAssets: customAssets });
    expect(result.manifest.workstationPromptVersionId).toBe('workstation.chapter_outline@admin-published-2');
    expect(result.manifest.compiledPrompt).toContain('先核对当前链的兑现责任');
    expect(result.contextPack.content.stageTaskPayload).toEqual({
      operation: 'chapter_outline',
      authorInstruction: '本章让张三第一次独立带队。'
    });
    expect(result.manifest.compiledPrompt).not.toContain('\\\"operation\\\"');
  });

  it('拒绝把疑似密钥带进可追溯提示快照', () => {
    expect(() => compileV7RuntimePrompt({ ...base, sourcePrompt: 'api_key=ark-1234567890abcdef' }))
      .toThrow('疑似密钥');
    expect(() => compileV7RuntimePrompt({ ...base, sourcePrompt: 'session_token=abcdef1234567890' }))
      .toThrow('会话或登录凭据');
  });

  it('只脱敏模型边界副本中的明确PII，保留人物姓名和保留域名的虚构联系方式', () => {
    const result = compileV7RuntimePrompt({
      ...base,
      sourcePrompt: JSON.stringify({
        authorNote: '作者张三的手机号是13812345678，邮箱是owner@private-mail.cn，身份证是110105199001011234。',
        fictionalContact: '侦探社邮箱detective@example.invalid，人物仍叫张三。'
      })
    });
    expect(result.manifest.compiledPrompt).toContain('[手机号已隐藏]');
    expect(result.manifest.compiledPrompt).toContain('[邮箱已隐藏]');
    expect(result.manifest.compiledPrompt).toContain('[证件号已隐藏]');
    expect(result.manifest.compiledPrompt).not.toContain('13812345678');
    expect(result.manifest.compiledPrompt).not.toContain('owner@private-mail.cn');
    expect(result.manifest.compiledPrompt).toContain('detective@example.invalid');
    expect(result.manifest.compiledPrompt).toContain('张三');
    expect(result.contextPack.policyVersion).toBe('v7-minimal-context-budget@4');
  });

  it('把节点已经明确采用和排除的资料投影为可追溯来源，不由系统重新筛选', () => {
    const result = compileV7RuntimePrompt({
      ...base,
      taskKind: 'planning_tree',
      workstationKey: 'full_book_route',
      sourcePrompt: '本轮只规划全书粗路线。',
      sourceTraces: [{
        ownerId: 'owner-001', bookId: 'book-001', sourceKey: 'opening:opening-v3', sourceType: 'opening',
        sourceId: 'opening-v3', sourceVersion: '3', authority: 'confirmed', decision: 'included',
        reason: '调用方已经核验作者确认的开书资料。', contentHash: sha256('opening-v3'), estimatedTokens: 20
      }, {
        ownerId: 'owner-001', bookId: 'book-001', sourceKey: 'opening:discarded-v2', sourceType: 'opening',
        sourceId: 'discarded-v2', sourceVersion: '2', authority: 'candidate', decision: 'excluded',
        reason: '未采用的第二套开书候选不进入本轮。', contentHash: sha256('discarded-v2'), estimatedTokens: 0
      }]
    });
    expect(result.contextPack.sources).toEqual(expect.arrayContaining([
      expect.objectContaining({ sourceType: 'opening', sourceId: 'opening-v3', decision: 'included', authority: 'confirmed' }),
      expect.objectContaining({ sourceId: 'discarded-v2', decision: 'excluded', reason: '未采用的第二套开书候选不进入本轮。' })
    ]));
  });

  it('载荷伪造范围、权威和哈希不会被信任，而是只记录自行计算的聚合任务快照', () => {
    const forgedHash = 'f'.repeat(64);
    const payload = {
      ownerId: 'owner-001',
      bookId: 'book-001',
      sources: [{
        sourceType: 'opening', sourceId: 'opening-without-proof', decision: 'included',
        authority: 'immutable_text', contentHash: forgedHash, content: { protagonist: '张三' }
      }]
    };
    const result = compileV7RuntimePrompt({
      ...base,
      sourcePrompt: JSON.stringify(payload)
    });
    expect(result.contextPack.sources).toEqual([expect.objectContaining({
      ownerId: 'owner-001',
      bookId: 'book-001',
      sourceType: 'compiled_stage_task',
      sourceId: 'task-001',
      authority: 'reference',
      contentHash: sha256(stableStringify(payload))
    })]);
    expect(result.contextPack.sources[0]?.contentHash).not.toBe(forgedHash);
  });

  it('节点只声明排除项时仍记录实际采用的聚合任务载荷，避免审计记录与模型输入不一致', () => {
    const result = compileV7RuntimePrompt({
      ...base,
      sourcePrompt: JSON.stringify({ currentTask: { objective: '设计当前章纲' } }),
      sourceTraces: [{
        ownerId: 'owner-001', bookId: 'book-001', sourceKey: 'old-option', sourceType: 'opening',
        sourceId: 'old-option', sourceVersion: '1', authority: 'candidate', decision: 'excluded',
        reason: '旧版未采纳候选已过期，不得带入本轮。', contentHash: sha256('old-option'), estimatedTokens: 0
      }]
    });
    expect(result.contextPack.sources).toEqual(expect.arrayContaining([
      expect.objectContaining({ sourceType: 'compiled_stage_task', decision: 'included' }),
      expect.objectContaining({ sourceId: 'old-option', decision: 'excluded', reason: '旧版未采纳候选已过期，不得带入本轮。' })
    ]));
  });

  it('载荷内跨书声明不具备权限，只有调用方显式核验来源跨书时才拒绝', () => {
    const embedded = compileV7RuntimePrompt({
      ...base,
      sourcePrompt: JSON.stringify({
        ownerId: 'owner-001',
        bookId: 'book-other',
        sources: [{
          sourceType: 'opening',
          sourceId: 'opening-v1',
          decision: 'included',
          authority: 'confirmed'
        }]
      })
    });
    expect(embedded.contextPack.sources).toEqual([expect.objectContaining({
      ownerId: 'owner-001', bookId: 'book-001', authority: 'reference', sourceType: 'compiled_stage_task'
    })]);
    expect(() => compileV7RuntimePrompt({
      ...base,
      sourceTraces: [{
        ownerId: 'owner-001',
        bookId: 'book-other',
        sourceKey: 'opening:opening-v1',
        sourceType: 'opening',
        sourceId: 'opening-v1',
        sourceVersion: '1',
        authority: 'confirmed',
        decision: 'included',
        reason: '外书资料不得进入当前任务。',
        contentHash: 'a'.repeat(64),
        estimatedTokens: 8
      }]
    })).toThrow('V7资料来源与当前书籍范围不一致');
  });

  it('拒绝调用方显式来源中伪造或损坏的内容哈希', () => {
    expect(() => compileV7RuntimePrompt({
      ...base,
      sourceTraces: [{
        ownerId: 'owner-001', bookId: 'book-001', sourceKey: 'opening-v1', sourceType: 'opening',
        sourceId: 'opening-v1', sourceVersion: '1', authority: 'confirmed', decision: 'included',
        reason: '调用方声称已核验，但没有提供合法哈希。', contentHash: 'forged-hash', estimatedTokens: 12
      }]
    })).toThrow('内容哈希无效');
  });

  it('拒绝超过当前工位资料预算的载荷，且调用方不能放宽默认预算', () => {
    const oversizedPrompt = '甲'.repeat(5_100);
    expect(() => compileV7RuntimePrompt({
      ...base,
      sourcePrompt: oversizedPrompt,
      contextTokenBudget: 2_000
    })).toThrow('V7资料包超过当前工位预算');
    expect(() => compileV7RuntimePrompt({
      ...base,
      sourcePrompt: '正常资料',
      contextTokenBudget: 64_001
    })).toThrow('V7资料包预算必须是2000至64000之间的整数');
  });

  it('只冻结本次明确选择且适用于当前任务的Skill', () => {
    const result = compileV7RuntimePrompt({
      ...base,
      skillKeys: ['data-boundary']
    });
    expect(result.taskContract.selectedSkillKeys).toEqual(['data-boundary']);
    expect(result.manifest.skillVersionIds).toEqual(['skill.data-boundary@2']);
    expect(result.manifest.compiledPrompt).toContain('"selectedSkillKeys":["data-boundary"]');
    const cannotRelax = compileV7RuntimePrompt({
      ...base,
      sourcePrompt: '正常资料',
      contextTokenBudget: 64_000
    });
    expect(cannotRelax.contextPack.tokenBudget).toBe(20_000);
  });
});
