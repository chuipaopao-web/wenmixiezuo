import { afterEach, describe, expect, it } from 'vitest';
import {
  V7_PROMPT_SOURCE_ASSETS,
  compilePromptManifest,
  modelBindingForProfile,
  sha256,
  stableStringify,
  type V7ContextPackTrace,
  type V7TaskContract
} from '@wenmi/v7-backend';
import { V7PromptGovernanceService } from '../../../apps/api/src/application/agents/v7-prompt-governance-service.js';
import { createServer } from '../../../apps/api/src/http/server.js';
import { V7PromptGovernanceRepository } from '../../../apps/api/src/infrastructure/db/repositories/v7-prompt-governance-repository.js';
import { FixedClock, SequenceIds, createTestContext, type TestContext } from '../../helpers/test-context.js';

const BROWSER_HEADERS = {
  host: '127.0.0.1:43111',
  origin: 'http://127.0.0.1:43110',
  'sec-fetch-site': 'same-site',
  'content-type': 'application/json'
};

let context: TestContext | undefined;
afterEach(() => { context?.close(); context = undefined; });

describe('V7提示词与上下文治理持久化', () => {
  it('已入库的提示资产不被覆盖，源注册表只能发布新版本并保留旧任务引用', () => {
    context = createTestContext('wenmi-v7-prompt-source-upgrade-');
    const current = V7_PROMPT_SOURCE_ASSETS.find((asset) => asset.assetKey === 'workstation.chapter_outline')!;
    const oldContent = { ...current.content, responsibility: '旧版章纲工位职责。' };
    const oldSerialized = stableStringify(oldContent);
    context.database.prepare(`INSERT INTO v7_prompt_asset_versions(
      asset_id,asset_key,kind,version,status,governance_revision,title,summary,content_json,content_hash,
      based_on_asset_id,created_by,created_at,published_by,published_at,retired_by,retired_at
    ) VALUES(?,?,?,1,'published',1,?,?,?,?,NULL,'legacy','2026-08-27T00:00:00.000Z','legacy','2026-08-27T00:00:00.000Z',NULL,NULL)`).run(
      'workstation.chapter_outline@1', current.assetKey, current.kind, current.title, '旧版章纲工位',
      oldSerialized, sha256(oldSerialized)
    );
    const repository = new V7PromptGovernanceRepository(context.database);
    const service = new V7PromptGovernanceService(repository, new SequenceIds(), new FixedClock());
    expect(repository.assetById('workstation.chapter_outline@1')?.status).toBe('retired');
    expect(repository.publishedAsset('workstation.chapter_outline')).toMatchObject({
      assetId: 'workstation.chapter_outline@2', version: 2, status: 'published', basedOnAssetId: 'workstation.chapter_outline@1'
    });
    expect(service.summary()).toMatchObject({ revision: 2, versionCount: V7_PROMPT_SOURCE_ASSETS.length + 1 });
  });

  it('安全登记初始资产，草稿发布和历史恢复都保留不可变版本并使用乐观版本', () => {
    context = createTestContext('wenmi-v7-prompt-assets-');
    const repository = new V7PromptGovernanceRepository(context.database);
    const service = new V7PromptGovernanceService(repository, new SequenceIds(), new FixedClock());
    expect(service.summary()).toMatchObject({
      revision: 1,
      assetKeyCount: V7_PROMPT_SOURCE_ASSETS.length,
      versionCount: V7_PROMPT_SOURCE_ASSETS.length,
      publishedCount: V7_PROMPT_SOURCE_ASSETS.length
    });
    const restarted = new V7PromptGovernanceService(repository, new SequenceIds(), new FixedClock());
    expect(restarted.summary()).toMatchObject({ revision: 1, versionCount: V7_PROMPT_SOURCE_ASSETS.length });

    const base = repository.publishedAsset('role.chief_editor')!;
    const draft = service.createDraft('admin', base.assetKey, {
      expectedRevision: 1,
      basedOnAssetId: base.assetId,
      content: { ...base.content, responsibility: '主持任务、派单、审查并给出最终判断。' },
      reason: '验证主编岗位草稿'
    });
    expect(draft).toMatchObject({ status: 'draft', version: 2, basedOnAssetId: base.assetId });
    expect(() => service.createDraft('admin', base.assetKey, { expectedRevision: 1, basedOnAssetId: base.assetId }))
      .toThrow('刚刚被其他操作更新');
    const preview = service.preview('admin', base.assetKey, { assetId: draft.assetId }) as {
      preview: { contextMode: string; compiledPrompt: string; checks: Array<{ key: string; passed: boolean }> }
    };
    expect(preview.preview.contextMode).toBe('simulated');
    expect(preview.preview.compiledPrompt).toContain('taskContract');
    expect(preview.preview.checks).toEqual(expect.arrayContaining([
      expect.objectContaining({ key: 'assetIdentity', passed: true }),
      expect.objectContaining({ key: 'secretBoundary', passed: true }),
      expect.objectContaining({ key: 'reasoningBoundary', passed: true }),
      expect.objectContaining({ key: 'runtimeCompilation', passed: true })
    ]));
    expect(() => service.createDraft('admin', base.assetKey, {
      expectedRevision: 2,
      basedOnAssetId: base.assetId,
      content: { ...base.content, roleKey: 'deputy_editor' }
    })).toThrow('编号与roleKey不一致');

    const published = service.publish('admin', base.assetKey, {
      expectedRevision: 2,
      assetId: draft.assetId,
      reason: '发布验证版本'
    });
    expect(published.status).toBe('published');
    expect(repository.assetById(base.assetId)?.status).toBe('retired');
    const restored = service.restoreDraft('admin', base.assetKey, {
      expectedRevision: 3,
      sourceAssetId: base.assetId,
      reason: '从历史版本恢复为新草稿'
    });
    expect(restored).toMatchObject({ status: 'draft', version: 3, basedOnAssetId: base.assetId });
    expect(repository.assetById(base.assetId)?.status).toBe('retired');
    expect(() => service.createDraft('admin', base.assetKey, {
      expectedRevision: 4,
      basedOnAssetId: base.assetId,
      content: { ...base.content, accidentalSecret: 'api_key=ark-secret-value-12345678' }
    })).toThrow('疑似密钥');
    expect(() => context!.database.prepare(`DELETE FROM v7_prompt_asset_versions WHERE asset_id=?`).run(base.assetId))
      .toThrow('immutable');
  });

  it('单事务冻结任务合同、资料包和每次请求唯一提示清单，重复保存幂等且可完整追溯', () => {
    context = createTestContext('wenmi-v7-runtime-bundle-');
    context.database.prepare(`INSERT OR IGNORE INTO owners(owner_id,display_name,version,created_at,updated_at)
      VALUES('owner-prompt-test','测试作者',1,?,?)`).run(NOW, NOW);
    context.database.prepare(`INSERT INTO books(book_id,owner_id,title,status,version,positioning_version,canon_revision,
      active_editor_agent_id,editor_epoch,created_at,updated_at)
      VALUES('book-prompt-test','owner-prompt-test','测试书','draft',1,0,0,NULL,0,?,?)`).run(NOW, NOW);
    const repository = new V7PromptGovernanceRepository(context.database);
    const service = new V7PromptGovernanceService(repository, new SequenceIds(), new FixedClock());
    const rolePrompt = repository.publishedAsset('role.chief_editor')!;
    const workstationPrompt = repository.publishedAsset('workstation.opening')!;
    const taskContract: V7TaskContract = {
      contractId: 'contract-opening-1', version: 1, ownerId: 'owner-prompt-test', bookId: 'book-prompt-test',
      taskId: 'request-opening-1', taskKind: 'opening_design', workstationKey: 'opening', operationMode: 'fresh',
      objective: '忠于作者想法整理开书资料。', mustPreserve: ['主角是张三'], allowedChanges: ['补全未确定字段'],
      forbiddenChanges: ['不得改换主角'], successCriteria: ['字段一致且完整'], outputContract: { type: 'opening_package' },
      selectedSkillKeys: [],
      authorInstructionVersion: 1, basedOnTaskId: null, createdAt: NOW
    };
    const content = { authorIdea: '张三穿越北宋，遇到岳飞并改变乱世。', confirmed: { protagonist: '张三' } };
    const contextPack: V7ContextPackTrace = {
      contextPackId: 'context-opening-1', ownerId: 'owner-prompt-test', bookId: 'book-prompt-test',
      taskId: 'request-opening-1', policyVersion: 'opening-v1', tokenBudget: 4000, estimatedTokens: 80,
      sources: [{
        ownerId: 'owner-prompt-test', bookId: 'book-prompt-test',
        sourceKey: 'author-idea', sourceType: 'author_source', sourceId: 'idea-1', sourceVersion: '1',
        authority: 'author_source', decision: 'included', reason: '作者本轮明确输入',
        contentHash: sha256('张三穿越北宋，遇到岳飞并改变乱世。'), estimatedTokens: 20
      }],
      content, contentHash: sha256(stableStringify(content)), createdAt: NOW
    };
    const manifest = compilePromptManifest({
      manifestId: 'manifest-request-opening-1', memberKey: 'chief-kimi-k3', modelProfileKey: 'kimi-k3',
      ...modelBindingForProfile('kimi-k3'), maxOutputTokens: 6_000,
      governanceRevision: 1, temperature: .24, rolePrompt, workstationPrompt, genreProfile: null, skills: [],
      taskContract, contextPack, allowedTools: ['正式开书资料读取'], createdAt: NOW
    });

    expect(service.saveRuntimeBundle({ taskContract, contextPack, manifest })).toMatchObject({ created: true });
    expect(service.saveRuntimeBundle({ taskContract, contextPack, manifest })).toMatchObject({ created: false });
    expect(service.manifests({ taskId: taskContract.taskId })).toHaveLength(1);
    const detail = service.manifest(manifest.manifestId) as {
      manifest: { compiledPromptHash: string; provider: string; modelId: string; plan: string; maxOutputTokens: number };
      taskContract: { objective: string };
      contextPack: { sources: unknown[] };
      execution: { state: string; artifactType: string };
    };
    expect(detail.manifest.compiledPromptHash).toBe(manifest.compiledPromptHash);
    expect(detail.manifest).toMatchObject({
      provider: 'volcengine-ark-agent-plan', modelId: 'kimi-k3', plan: 'agent', maxOutputTokens: 6_000
    });
    expect(detail.taskContract.objective).toBe(taskContract.objective);
    expect(detail.contextPack.sources).toHaveLength(1);
    expect(detail.execution).toMatchObject({ state: 'not_linked', artifactType: '开书资料' });
    expect(service.preview('admin', rolePrompt.assetKey, {
      assetId: rolePrompt.assetId,
      manifestId: manifest.manifestId
    })).toMatchObject({
      preview: {
        contextMode: 'historical',
        baseManifestId: manifest.manifestId,
        compiledPromptHash: manifest.compiledPromptHash,
        checks: expect.arrayContaining([expect.objectContaining({ key: 'runtimeCompilation', passed: true })])
      }
    });
    const countsBefore = service.summary() as { taskContractCount: number; contextPackCount: number; manifestCount: number };
    expect(service.verifyManifestRebuild(manifest.manifestId)).toMatchObject({
      manifestId: manifest.manifestId,
      matched: true,
      storedHash: manifest.compiledPromptHash,
      rebuiltHash: manifest.compiledPromptHash
    });
    expect(service.summary()).toMatchObject(countsBefore);
    expect(repository.runtimeBundleByTaskScope({
      ownerId: taskContract.ownerId, bookId: taskContract.bookId, taskId: taskContract.taskId
    })).toMatchObject({ taskContract, contextPack, manifest });
    expect(repository.runtimeBundleByTaskScope({
      ownerId: taskContract.ownerId, bookId: 'another-book', taskId: taskContract.taskId
    })).toBeNull();
    expect(() => service.saveRuntimeBundle({
      taskContract,
      contextPack: { ...contextPack, ownerId: 'other-owner' },
      manifest
    })).toThrow('范围不一致');
  });

  it('管理员API提供摘要、资产版本、草稿预览发布、历史恢复与清单只读入口', async () => {
    context = createTestContext('wenmi-v7-prompt-routes-');
    const app = await createServer(context.config, context.database);
    try {
      const cookie = await register(app, 'prompt-admin@example.com', '提示资产管理员', 'strong-pass-901');
      const summary = await app.inject({
        method: 'GET', url: '/api/v1/admin/v7/prompt-context/summary', headers: { ...BROWSER_HEADERS, cookie }
      });
      expect(summary.statusCode).toBe(200);
      expect(summary.json().data.assetKeyCount).toBe(V7_PROMPT_SOURCE_ASSETS.length);
      const unauthenticated = await app.inject({ method: 'GET', url: '/api/v1/admin/v7/prompt-context/assets', headers: BROWSER_HEADERS });
      expect(unauthenticated.statusCode).toBeGreaterThanOrEqual(400);

      const versions = await app.inject({
        method: 'GET', url: '/api/v1/admin/v7/prompt-context/assets/role.chief_editor/versions',
        headers: { ...BROWSER_HEADERS, cookie }
      });
      expect(versions.statusCode).toBe(200);
      const base = versions.json().data[0];
      const draftResponse = await app.inject({
        method: 'POST', url: '/api/v1/admin/v7/prompt-context/assets/role.chief_editor/drafts',
        headers: { ...BROWSER_HEADERS, cookie },
        payload: { expectedRevision: 1, basedOnAssetId: base.assetId, reason: '路由验证草稿' }
      });
      expect(draftResponse.statusCode).toBe(200);
      const draft = draftResponse.json().data;
      const preview = await app.inject({
        method: 'POST', url: '/api/v1/admin/v7/prompt-context/assets/role.chief_editor/preview',
        headers: { ...BROWSER_HEADERS, cookie }, payload: { assetId: draft.assetId }
      });
      expect(preview.statusCode).toBe(200);
      expect(preview.json().data.preview).toMatchObject({ contextMode: 'simulated' });
      expect(preview.json().data.preview.compiledPrompt).toContain('taskContract');
      const publish = await app.inject({
        method: 'POST', url: '/api/v1/admin/v7/prompt-context/assets/role.chief_editor/publish',
        headers: { ...BROWSER_HEADERS, cookie }, payload: { expectedRevision: 2, assetId: draft.assetId }
      });
      expect(publish.statusCode).toBe(200);
      const restore = await app.inject({
        method: 'POST', url: '/api/v1/admin/v7/prompt-context/assets/role.chief_editor/restore-draft',
        headers: { ...BROWSER_HEADERS, cookie }, payload: { expectedRevision: 3, sourceAssetId: base.assetId }
      });
      expect(restore.statusCode).toBe(200);
      expect(restore.json().data.version).toBe(3);
      const manifests = await app.inject({
        method: 'GET', url: '/api/v1/admin/v7/prompt-context/manifests', headers: { ...BROWSER_HEADERS, cookie }
      });
      expect(manifests.statusCode).toBe(200);
      expect(manifests.json().data).toEqual([]);

      const owner = context.database.prepare(`SELECT owner_id FROM user_accounts WHERE email_normalized=?`)
        .get('prompt-admin@example.com') as { owner_id: string };
      const repository = new V7PromptGovernanceRepository(context.database);
      const rolePrompt = repository.publishedAsset('role.chief_editor')!;
      const workstationPrompt = repository.publishedAsset('workstation.opening')!;
      const openingTaskId = 'opening-task-admin-trace';
      const requestId = 'opening-request-admin-trace';
      const bookId = `v7-prebook:${openingTaskId}`;
      const taskContract: V7TaskContract = {
        contractId: 'contract-opening-admin-trace', version: 1, ownerId: owner.owner_id, bookId,
        taskId: requestId, taskKind: 'opening_design', workstationKey: 'opening', operationMode: 'fresh',
        objective: '忠于作者想法整理开书资料。', mustPreserve: ['主角是张三'], allowedChanges: ['补全未确定字段'],
        forbiddenChanges: ['不得改换主角'], successCriteria: ['字段一致且完整'], outputContract: { type: 'opening_package' },
        selectedSkillKeys: [],
        authorInstructionVersion: null, basedOnTaskId: null, createdAt: NOW
      };
      const contextContent = { stageTaskPayload: '张三穿越北宋，遇到岳飞并改变乱世。' };
      const contextPack: V7ContextPackTrace = {
        contextPackId: 'context-opening-admin-trace', ownerId: owner.owner_id, bookId, taskId: requestId,
        policyVersion: 'opening-v1', tokenBudget: 4000, estimatedTokens: 30,
        sources: [{
          ownerId: owner.owner_id, bookId,
          sourceKey: 'author-idea', sourceType: 'author_source', sourceId: openingTaskId, sourceVersion: '1',
          authority: 'author_source', decision: 'included', reason: '作者本轮明确输入',
          contentHash: sha256(contextContent.stageTaskPayload), estimatedTokens: 20
        }],
        content: contextContent, contentHash: sha256(stableStringify(contextContent)), createdAt: NOW
      };
      const manifest = compilePromptManifest({
        manifestId: 'manifest-opening-admin-trace', memberKey: 'chief-kimi-k3', modelProfileKey: 'kimi-k3',
        ...modelBindingForProfile('kimi-k3'), maxOutputTokens: 6_000,
        governanceRevision: 1, temperature: .24, rolePrompt, workstationPrompt, genreProfile: null, skills: [],
        taskContract, contextPack, allowedTools: [], createdAt: NOW
      });
      context.database.prepare(`INSERT INTO v7_opening_agent_tasks(
        task_id,owner_id,idempotency_key,request_hash,idea_text,idea_version,idea_hash,status,phase,state_json,
        created_at,updated_at
      ) VALUES(?,?,?,?,?,1,?,'working','chief_design',NULL,?,?)`).run(
        openingTaskId, owner.owner_id, 'opening-admin-trace-key', sha256('opening-admin-trace-request'),
        contextContent.stageTaskPayload, sha256(contextContent.stageTaskPayload), NOW, NOW
      );
      context.database.prepare(`INSERT INTO v7_opening_agent_model_calls(
        request_id,owner_id,task_id,node_key,member_key,provider,model_id,plan,state,prompt_hash,reserved_tokens,
        governance_revision,temperature,task_contract_json,context_pack_json,prompt_manifest_json,
        started_at,created_at,updated_at
      ) VALUES(?,?,?,?,?,?,?,'agent','working',?,8000,?,?,?,?,?,?,?,?)`).run(
        requestId, owner.owner_id, openingTaskId, 'opening_package_design', manifest.memberKey,
        manifest.provider, manifest.modelId, manifest.compiledPromptHash, manifest.governanceRevision,
        manifest.temperature, JSON.stringify(taskContract), JSON.stringify(contextPack), JSON.stringify(manifest), NOW, NOW, NOW
      );

      const summaryWithPrebook = await app.inject({
        method: 'GET', url: '/api/v1/admin/v7/prompt-context/summary', headers: { ...BROWSER_HEADERS, cookie }
      });
      expect(summaryWithPrebook.json().data).toMatchObject({ manifestCount: 1, prebookPromptBundleCount: 1 });

      const prebookList = await app.inject({
        method: 'GET', url: `/api/v1/admin/v7/prompt-context/manifests?taskId=${openingTaskId}`,
        headers: { ...BROWSER_HEADERS, cookie }
      });
      expect(prebookList.statusCode).toBe(200);
      expect(prebookList.json().data).toEqual([expect.objectContaining({
        manifestId: manifest.manifestId, openingTaskId, taskId: requestId, storageKind: 'prebook_model_call',
        execution: expect.objectContaining({ state: 'working' })
      })]);
      const prebookDetail = await app.inject({
        method: 'GET', url: `/api/v1/admin/v7/prompt-context/manifests/${manifest.manifestId}`,
        headers: { ...BROWSER_HEADERS, cookie }
      });
      expect(prebookDetail.statusCode).toBe(200);
      expect(prebookDetail.json().data).toMatchObject({
        manifest: {
          manifestId: manifest.manifestId,
          compiledPromptHash: manifest.compiledPromptHash,
          provider: manifest.provider,
          modelId: manifest.modelId,
          plan: manifest.plan,
          maxOutputTokens: manifest.maxOutputTokens
        },
        taskContract: { contractId: taskContract.contractId, objective: taskContract.objective },
        contextPack: { contextPackId: contextPack.contextPackId, content: contextContent },
        execution: expect.objectContaining({ state: 'working', artifactType: '开书资料' }),
        storage: { kind: 'prebook_model_call', requestId, openingTaskId, embeddedSnapshot: true }
      });

      const rebuild = await app.inject({
        method: 'POST', url: `/api/v1/admin/v7/prompt-context/manifests/${manifest.manifestId}/verify-rebuild`,
        headers: { ...BROWSER_HEADERS, cookie }, payload: {}
      });
      expect(rebuild.statusCode).toBe(200);
      expect(rebuild.json().data).toMatchObject({
        manifestId: manifest.manifestId, matched: true,
        storedHash: manifest.compiledPromptHash, rebuiltHash: manifest.compiledPromptHash
      });

      context.database.prepare(`UPDATE v7_opening_agent_model_calls
        SET state='failed',failure_message='模型超时',completed_at=?,updated_at=? WHERE request_id=?`)
        .run(NOW, NOW, requestId);
      const failedDetail = await app.inject({
        method: 'GET', url: `/api/v1/admin/v7/prompt-context/manifests/${manifest.manifestId}`,
        headers: { ...BROWSER_HEADERS, cookie }
      });
      expect(failedDetail.json().data.execution).toMatchObject({
        state: 'failed', artifactType: '开书资料'
      });
      expect(failedDetail.json().data.execution.summary).toContain('对不起，这次开书资料没有完成');

      context.database.prepare(`UPDATE v7_opening_agent_model_calls
        SET state='succeeded',failure_message=NULL,completed_at=?,updated_at=? WHERE request_id=?`)
        .run(NOW, NOW, requestId);
      const succeededDetail = await app.inject({
        method: 'GET', url: `/api/v1/admin/v7/prompt-context/manifests/${manifest.manifestId}`,
        headers: { ...BROWSER_HEADERS, cookie }
      });
      expect(succeededDetail.json().data.execution).toMatchObject({
        state: 'succeeded', artifactType: '开书资料',
        summary: '开书资料已经完成并保存，可在对应创作页面查看。'
      });

      const governance = await app.inject({
        method: 'GET', url: '/api/v1/admin/v7/agent-governance', headers: { ...BROWSER_HEADERS, cookie }
      });
      expect(governance.statusCode).toBe(200);
      const governanceData = governance.json().data as {
        revision: number;
        roles: Array<{ members: Array<{ memberKey: string }> }>;
      };
      const memberKey = governanceData.roles.flatMap((role) => role.members)[0]!.memberKey;
      const permanentPromptUpdate = await app.inject({
        method: 'PATCH', url: `/api/v1/admin/v7/opening-agent/members/${memberKey}`,
        headers: { ...BROWSER_HEADERS, cookie },
        payload: { expectedRevision: governanceData.revision, promptInstruction: '永久改变这个成员的写作倾向。' }
      });
      expect(permanentPromptUpdate.statusCode).toBe(400);
      expect(JSON.stringify(permanentPromptUpdate.json())).toContain('成员不再保存永久补充提示');
    } finally {
      await app.close();
    }
  });
});

const NOW = '2026-08-28T00:00:00.000Z';

async function register(
  app: Awaited<ReturnType<typeof createServer>>,
  email: string,
  displayName: string,
  password: string
): Promise<string> {
  const response = await app.inject({
    method: 'POST', url: '/api/v1/auth/register', headers: BROWSER_HEADERS,
    payload: { email, password, displayName }
  });
  expect(response.statusCode).toBe(200);
  const raw = response.headers['set-cookie'];
  return String(Array.isArray(raw) ? raw[0] : raw).split(';', 1)[0]!;
}
