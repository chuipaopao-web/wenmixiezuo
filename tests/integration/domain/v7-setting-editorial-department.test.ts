import { afterEach, describe, expect, it } from 'vitest';
import { ModelAdapterError, type ModelAdapter, type ModelRequest, type ModelResult } from '../../../apps/api/src/infrastructure/models/model-adapter.js';
import type { ModelPurpose } from '../../../apps/api/src/infrastructure/models/model-runtime-config.js';
import type { V7OpeningModelAdapterResolver } from '../../../apps/api/src/infrastructure/models/v7-opening-agent-model-gateway.js';
import { createServer } from '../../../apps/api/src/http/v7-server.js';
import { V7PlanningSourceCompiler } from '../../../apps/api/src/application/planning/v7-planning-source-compiler.js';
import { settingChangeImpact } from '../../../apps/api/src/infrastructure/db/repositories/setting-change-impact.js';
import {continuitySources,continuitySourceHash,continuityHash} from '../../../apps/api/src/application/books/setting-continuity.js';
import { V7SettingLedgerReader } from '../../../apps/api/src/application/books/v7-setting-ledger-reader.js';
import { V7SettingEditorialRepository } from '../../../apps/api/src/infrastructure/db/repositories/v7-setting-editorial-repository.js';
import { V7_SETTING_CATALOG, V7_SETTING_MEMBERS, validateSettingEditorialRoster } from '@wenmi/v7-backend';
import { createTestContext as createBaseTestContext, FixedClock, SequenceIds, type TestContext } from '../../helpers/test-context.js';

function createTestContext(prefix?: string): TestContext {
  const context = createBaseTestContext(prefix);
  // These tests inject an in-memory model resolver; enable both credential gates without a live key.
  context.config.modelRuntime.endpoints.coding.apiKey = 'fixture-only-no-network';
  context.config.modelRuntime.endpoints.agent.apiKey = 'fixture-only-no-network';
  return context;
}

const HEADERS = { host: '127.0.0.1:43111', origin: 'http://127.0.0.1:43110', 'sec-fetch-site': 'same-site', 'content-type': 'application/json' };
let context: TestContext | undefined;
afterEach(() => { context?.close(); context = undefined; });

describe('V7设定编辑部', () => {
  it('无冲突的旧辅助字段仍交现有主编合并，完整来源保留且不凭索引改写', async () => {
    context = createTestContext('r173-integrated-');
    const base = new SettingResolver(false);
    const oldRule = { level: 'topic', statement: '加急公文走驿站。', scope: '官用驿路',
      conditions: ['持合法驿券'], costs: ['征用马匹'], exceptions: ['战乱封路停递'], objects: ['驿站'] };
    const merged = '官用驿路凭合法驿券传递加急公文，沿途征用马匹；战乱封路停递。';
    let mergeCalls = 0;
    const resolver: V7OpeningModelAdapterResolver = { resolve(provider, modelId, purpose) {
      const adapter = base.resolve(provider, modelId, purpose);
      return { ...adapter, generate: async (request, signal) => {
        const stage = settingStagePrompt(request.prompt);
        let output: string | undefined;
        if (stage.includes('v7_setting_group_design_v1')) {
          const draft = JSON.parse(groupedSettingOutput(stage));
          draft.items[0].rules = [oldRule];
          output = JSON.stringify(draft);
        } else if (stage.includes('v7_setting_batch_final_review_patch_v1')) {
          mergeCalls++;
          const payload = JSON.parse(stage);
          expect(payload.affectedItems[0].rules).toEqual([oldRule]);
          expect(payload.affectedItems[0].currentContent).toBeUndefined();
          output = JSON.stringify({ patches: [{ itemKey: 'world-stage',
            rules: [{ level: 'topic', statement: merged, scope: '', conditions: [], costs: [], exceptions: [], objects: [] }],
            summary: '合并重复表达，条件和例外不变', contextSummary: '官用驿路', issues: [], suggestions: [] }] });
        } else if (stage.includes('v7_setting_batch_final_review_v1')) {
          output = JSON.stringify({ verdict: 'pass', summary: '无事实冲突', conflicts: [], unifiedDecisions: [], patches: [] });
        }
        return output === undefined ? adapter.generate(request, signal)
          : { provider, modelId, output, inputTokens: 80, outputTokens: 160, cashCostCny: 0, state: 'succeeded' };
      } };
    } };
    const app = await createServer(context.config, context.database, { v7OpeningModelAdapters: resolver });
    try {
      const cookie = await register(app, 'r173@example.com', '合并作者', 'strong-pass-173');
      const bookId = await createBook(app, cookie, '驿路规则', 'r173-book', '历史脑洞');
      const seed = await app.inject({ method: 'POST', url: `/api/v1/v7/books/${bookId}/setting-batches`,
        headers: { ...HEADERS, cookie }, payload: { selectedItemKeys: ['world-stage'], designMemberKey: 'planner-deepseek-v4-pro',
          customItems: [], authorNotes: {}, idempotencyKey: 'r173-seed' } });
      expect((await pollBatch(app, cookie, bookId, seed.json().data.batchId)).status).toBe('awaiting_author');
      const original = context.database.prepare('SELECT version_id,content_json FROM v7_setting_item_versions WHERE book_id=?').all(bookId);
      const start = await app.inject({ method: 'POST', url: `/api/v1/v7/books/${bookId}/setting-final-reviews`,
        headers: { ...HEADERS, cookie }, payload: { idempotencyKey: 'r173-merge' } });
      expect(start.statusCode, start.body).toBe(200);
      expect(await pollFinalReview(app, cookie, bookId)).toMatchObject({ status: 'ready' });
      expect(mergeCalls).toBe(1);
      for (const row of original) expect(context.database.prepare('SELECT version_id,content_json FROM v7_setting_item_versions WHERE version_id=?').get(row.version_id as string)).toEqual(row);
      const department = await app.inject({ method: 'GET', url: `/api/v1/v7/books/${bookId}/setting-department`, headers: { ...HEADERS, cookie } });
      expect(JSON.stringify(department.json().data)).toContain(merged);
    } finally { await app.close(); }
  });
  it('采用变更须核对当前来源，作者规则取舍不能绕过正文冲突，历史版本不变',async()=>{
    context=createTestContext('r164-confirm-');
    const app=await createServer(context.config,context.database,{v7OpeningModelAdapters:new SettingResolver(false)});
    try {
      const cookie=await register(app,'rule-change@example.test','变更测试','rule-change-password');
      const bookId=await createBook(app,cookie,'规则变更','r164-confirm-book','历史脑洞');
      const url=`/api/v1/v7/books/${bookId}`;
      const created=await app.inject({method:'POST',url:url+'/setting-batches',headers:{...HEADERS,cookie},payload:{selectedItemKeys:['world-stage'],idempotencyKey:'r164-confirm'}});
      const batch=await pollBatch(app,cookie,bookId,created.json().data.batchId);
      const accepted=await app.inject({method:'POST',url:url+'/setting-items/world-stage/confirm',headers:{...HEADERS,cookie},payload:{expectedRevision:batch.items[0].revision}});
      expect(accepted.statusCode,accepted.body).toBe(200);
      const ownerId=String(context.database.prepare('SELECT owner_id FROM books WHERE book_id=?').get(bookId)!.owner_id);
      const repo=new V7SettingEditorialRepository(context.database);
      const old=repo.confirmedVersions(ownerId,bookId)[0]!;
      const data=JSON.parse(old.content_json);data.finalContent='新制度规定持证者才能入城。';
      data.continuity={sourceHash:'stale',candidateHash:continuityHash(data.finalContent),change:'fact',checkedSources:2,mergedVersionIds:[],
        findings:[{sourceId:old.version_id,label:'旧规则',kind:'actual',problem:'正文冲突',suggestion:'修改候选'}]};
      const outputId=String(context.database.prepare('SELECT source_output_id FROM v7_setting_item_versions WHERE version_id=?').get(old.version_id)!.source_output_id);
      repo.saveCandidate({versionId:'r164-changed',ownerId,bookId,item:V7_SETTING_CATALOG.find(i=>i.key==='world-stage')!,contentJson:JSON.stringify(data),outputId,batchId:created.json().data.batchId,createdBy:'author',now:'2026-09-09T00:00:00Z',expectedRevision:accepted.json().data.revision});
      const current=Number(context.database.prepare('SELECT revision FROM v7_setting_items WHERE book_id=? AND item_key=?').get(bookId,'world-stage')!.revision);
      const confirm=()=>app.inject({method:'POST',url:url+'/setting-items/world-stage/confirm',headers:{...HEADERS,cookie},payload:{expectedRevision:current,acceptRuleChanges:true}});
      expect((await confirm()).statusCode).toBe(409);
      data.continuity.sourceHash=continuitySourceHash(continuitySources(context.database,ownerId,bookId,'world-stage',false));
      context.database.prepare('UPDATE v7_setting_item_versions SET content_json=? WHERE version_id=?').run(JSON.stringify(data),'r164-changed');
      expect((await confirm()).statusCode).toBe(409);
      data.continuity.findings[0].kind='setting';
      context.database.prepare('UPDATE v7_setting_item_versions SET content_json=? WHERE version_id=?').run(JSON.stringify(data),'r164-changed');
      const done=await confirm();expect(done.statusCode,done.body).toBe(200);
      expect(context.database.prepare('SELECT content_json FROM v7_setting_item_versions WHERE version_id=?').get(old.version_id)!.content_json).toBe(old.content_json);
      expect(JSON.parse(repo.confirmedVersions(ownerId,bookId)[0]!.content_json).authorRuleDecision).toBe('adopt_changed_rules');
    }finally{await app.close();}
  });
  it('必要设定已被开书资料覆盖时可继续，缺失、跨用户或过期分类不能绕过准备', async () => {
    context = createTestContext('r164-covered-');
    const app = await createServer(context.config, context.database, { v7OpeningModelAdapters: new SettingResolver(false) });
    try {
      const cookie = await register(app, 'covered@example.test', '覆盖测试', 'covered-test-password');
      const bookId = await createBook(app, cookie, '已有完整资料', 'r164-covered-book', '历史脑洞');
      const owner = context.database.prepare('SELECT owner_id FROM books WHERE book_id=?').get(bookId) as { owner_id: string };
      const reader = new V7SettingLedgerReader(context.database);
      const input = { ownerId: owner.owner_id, bookId, openingVersion: 1, settings: [] };
      expect(() => reader.readCurrent(input)).toThrow('必要设定');
      const created = await app.inject({ method: 'POST', url: `/api/v1/v7/books/${bookId}/setting-recommendations`, headers: { ...HEADERS, cookie }, payload: {} });
      const result = await pollRecommendation(app, cookie, bookId, created.json().data.taskId);
      expect(result.status).toBe('ready');
      const classification = { requiredKeys: [], suggestedKeys: [], coveredKeys: ['world-stage'],
        excludedKeys: V7_SETTING_CATALOG.filter((item) => item.key !== 'world-stage').map((item) => item.key), summary: '必要规则已有依据' };
      context.database.prepare('UPDATE v7_setting_batches SET selected_items_json=? WHERE batch_id=?')
        .run(JSON.stringify({ taskKind: 'catalog_recommendation', result: classification }), result.taskId);
      expect(reader.readCurrent(input).content.summary).toContain('正式开书资料覆盖');
      expect(reader.readCurrent(input).projections).toEqual([]);
      expect(() => reader.readCurrent({ ...input, openingVersion: 2 })).toThrow('必要设定');
      expect(() => reader.readCurrent({ ...input, ownerId: 'other-user' })).toThrow('必要设定');
      classification.excludedKeys.pop();
      context.database.prepare('UPDATE v7_setting_batches SET selected_items_json=? WHERE batch_id=?')
        .run(JSON.stringify({ taskKind: 'catalog_recommendation', result: classification }), result.taskId);
      expect(() => reader.readCurrent(input)).toThrow('必要设定');
    } finally { await app.close(); }
  });

  it('新规则经过设计、保存和页面读取仍保留完整条件，正文与事实同源', async () => {
    context = createTestContext('r164-rules-');
    const delegate = new SettingResolver(false);
    const resolver: V7OpeningModelAdapterResolver = { resolve(provider, modelId, purpose) {
      const adapter = delegate.resolve(provider, modelId, purpose);
      return { ...adapter, generate: async (request, signal) => {
        const stage = settingStagePrompt(request.prompt);
        if (stage.includes('v7_setting_batch_final_review_v1')) return successfulModelResult(provider, modelId,
          JSON.stringify({ verdict: 'pass', summary: '现有规则一致', unifiedDecisions: [], conflicts: [], patches: [] }));
        if (!stage.includes('v7_setting_group_design_v1')) return adapter.generate(request, signal);
        const output = JSON.parse(groupedSettingOutput(stage));
        for (const item of output.items) {
          item.rules = [{ level: 'global', statement: '本书没有超自然力量。', scope: '全书',
            conditions: [], costs: [], exceptions: ['传闻和人物误解不能当作事实'], objects: [] }];
          item.content = '系统不会采用的冲突副本：主角能施法。';
          item.factEntries = ['主角能施法'];
        }
        return successfulModelResult(provider, modelId, JSON.stringify(output));
      }};
    }};
    const app = await createServer(context.config, context.database, { v7OpeningModelAdapters: resolver });
    try {
      const cookie = await register(app, 'canonical-rules@example.test', '规则作者', 'rules-test-password');
      const bookId = await createBook(app, cookie, '规则验证', 'r164-rule-book', '历史脑洞');
      const response = await app.inject({ method: 'POST', url: `/api/v1/v7/books/${bookId}/setting-batches`,
        headers: { ...HEADERS, cookie }, payload: { selectedItemKeys: ['world-stage'], designMemberKey: 'planner-deepseek-v4-pro', idempotencyKey: 'r164-rule-batch' } });
      expect(response.statusCode, response.body).toBe(200);
      const batch = await pollBatch(app, cookie, bookId, response.json().data.batchId);
      expect(batch.status).toBe('awaiting_author');
      expect(batch.items[0].content).toContain('传闻和人物误解不能当作事实');
      expect(batch.items[0].content).not.toContain('主角能施法');
      const versions = context.database.prepare('SELECT content_json FROM v7_setting_item_versions WHERE book_id=?').all(bookId) as Array<{content_json: string}>;
      expect(versions.length).toBeGreaterThan(0);
      const saved = JSON.parse(versions.at(-1)!.content_json);
      expect(saved.rules[0].level).toBe('global');
      expect(saved.finalContent).toBe(saved.factEntries.join('\n\n'));
      const confirmed = await app.inject({ method: 'POST', url: `/api/v1/v7/books/${bookId}/setting-items/world-stage/confirm`,
        headers: { ...HEADERS, cookie }, payload: { expectedRevision: batch.items[0].revision } });
      expect(confirmed.statusCode, confirmed.body).toBe(200);
      const owner = context.database.prepare('SELECT owner_id FROM books WHERE book_id=?').get(bookId) as {owner_id: string};
      const formal = new V7SettingEditorialRepository(context.database).confirmedVersions(owner.owner_id, bookId)[0]!;
      context.database.prepare(`INSERT INTO v7_planning_tree_versions
        (tree_version_id,owner_id,book_id,tree_kind,scope_id,revision,lifecycle,schema_version,content_json,content_hash,source_refs_json,created_by,created_at)
        VALUES (?,?,?,'book',?,1,'confirmed','v7-planning-tree-v1',?,?,?,'author',?)`).run(
        'rule-impact-tree', owner.owner_id, bookId, bookId, JSON.stringify({title:'全书方向'}), 'a'.repeat(64),
        JSON.stringify([{sourceKind:'setting',sourceId:formal.version_id,version:String(formal.revision)}]), '2026-09-08T00:00:00Z');
      expect(settingChangeImpact(context.database, owner.owner_id, bookId, 'world-stage').planning).toEqual([{kind:'book',name:'全书方向'}]);
      expect(settingChangeImpact(context.database, 'another-owner', bookId, 'world-stage').planning).toEqual([]);
    } finally { await app.close(); }
  });
  it.each(['repair', 'reject'] as const)('来源身份明确且矛盾通过结论走既有%s路径，不污染正式设定', async mode => {
    context=createTestContext('r154-'+mode+'-');
    const delegate=new SettingResolver(false);let calls=0;const prompts:string[]=[];
    const resolver:V7OpeningModelAdapterResolver={resolve(provider,modelId,purpose){
      const adapter=delegate.resolve(provider,modelId,purpose);
      return {...adapter,generate:async(request,signal)=>{
        const stage=settingStagePrompt(request.prompt);
        if(!stage.includes('v7_setting_batch_final_review_v1'))return adapter.generate(request,signal);
        calls++;prompts.push(stage);
        const repaired=mode==='repair'&&stage.includes('上次结果：');
        return successfulModelResult(provider,modelId,JSON.stringify({verdict:repaired?'needs_author':'pass',summary:repaired?'功效尚需确认。':'检查通过。',unifiedDecisions:[],conflicts:[],patches:[{
          itemKey:'history',finalContent:'该候选办法的实际功效还没有可靠依据，需要作者决定是否作为虚构规则采用。',summary:'保留待决定问题。',contextSummary:'功效尚待确认。',factEntries:['该候选办法的实际功效还没有可靠依据。'],issues:[{problem:'功效未经核实',impact:'可能影响设定成立',suggestion:'核实或明确为虚构规则'}],suggestions:[]
        }]}));
      }};
    }};
    const app=await createServer(context.config,context.database,{v7OpeningModelAdapters:resolver});
    try{
      const cookie=await register(app,'r154-'+mode+'@example.test','审查验收','fixture-pass-154');
      const bookId=await createBook(app,cookie,'审查验收','r154-book-'+mode,'历史脑洞');const url=`/api/v1/v7/books/${bookId}`;
      const seeded=await app.inject({method:'POST',url:url+'/setting-batches',headers:{...HEADERS,cookie},payload:{selectedItemKeys:['world-stage','history'],idempotencyKey:'r154-seed-'+mode}});
      await pollBatch(app,cookie,bookId,seeded.json().data.batchId);
      const department=await app.inject({method:'GET',url:url+'/setting-department',headers:{...HEADERS,cookie}});
      const world=department.json().data.confirmedItems.find((item:{itemKey:string})=>item.itemKey==='world-stage');
      const accepted=await app.inject({method:'POST',url:url+'/setting-items/world-stage/confirm',headers:{...HEADERS,cookie},payload:{expectedRevision:world.revision}});
      expect(accepted.statusCode,accepted.body).toBe(200);
      const before=context.database.prepare('SELECT * FROM v7_setting_item_versions WHERE book_id=? AND status=\'confirmed\' ORDER BY version_id').all(bookId);
      const currentBefore=context.database.prepare('SELECT * FROM v7_setting_items WHERE book_id=? ORDER BY item_key').all(bookId);
      const requested=await app.inject({method:'POST',url:url+'/setting-final-reviews',headers:{...HEADERS,cookie},payload:{idempotencyKey:'r154-review-'+mode}});
      expect(requested.statusCode,requested.body).toBe(200);
      const result=await pollFinalReview(app,cookie,bookId);
      const payload=JSON.parse(prompts[0]!);
      expect(payload.currentSettingCandidates.find((item:{itemKey:string})=>item.itemKey==='world-stage').authority).toBe('confirmed');
      expect(payload.currentSettingCandidates.find((item:{itemKey:string})=>item.itemKey==='history').authority).toBe('candidate');
      if(mode==='repair'){
        expect(calls).toBe(2);expect(result.status).toBe('ready');expect(result.result.verdict).toBe('needs_author');
        const current=context.database.prepare('SELECT state FROM v7_setting_items WHERE book_id=? AND item_key=?').get(bookId,'history');
        expect(current?.state).toBe('candidate');
        const view=(await app.inject({method:'GET',url:url+'/setting-department',headers:{...HEADERS,cookie}})).json().data.confirmedItems.find((item:{itemKey:string})=>item.itemKey==='history');
        expect(view.state).toBe('needs_author');expect(view.issues).toHaveLength(1);
      }else{
        expect(result.status).toBe('failed');expect(calls).toBeGreaterThanOrEqual(2);
        expect(context.database.prepare('SELECT * FROM v7_setting_items WHERE book_id=? ORDER BY item_key').all(bookId)).toEqual(currentBefore);
      }
      expect(context.database.prepare('SELECT * FROM v7_setting_item_versions WHERE book_id=? AND status=\'confirmed\' ORDER BY version_id').all(bookId)).toEqual(before);
    }finally{await app.close();}
  });
  it('已知失败恢复采用新尝试，保留原设定与历史调用并防重', async () => {
    context=createTestContext('r147-recovery-');
    const delegate=new SettingResolver(false);let failing=true;
    const purposes:ModelPurpose[]=[];
    const resolver:V7OpeningModelAdapterResolver={resolve(provider,modelId,purpose){
      const adapter=delegate.resolve(provider,modelId,purpose);
      return {...adapter,generate:async(request,signal)=>{
        if(settingStagePrompt(request.prompt).includes('v7_setting_batch_final_review_v1')){
          purposes.push(purpose);
          if(failing)throw new Error('known rejected fixture');
          return successfulModelResult(provider,modelId,JSON.stringify({verdict:'pass',summary:'核对通过',unifiedDecisions:[],conflicts:[],patches:[]}));
        }
        return adapter.generate(request,signal);
      }};
    }};
    const app=await createServer(context.config,context.database,{v7OpeningModelAdapters:resolver});
    try{
      const cookie=await register(app,'r147-recovery@example.test','恢复验收','fixture-pass-147');
      const bookId=await createBook(app,cookie,'恢复验收','r147-recovery-book','历史脑洞');
      const url=`/api/v1/v7/books/${bookId}`;
      const seed=await app.inject({method:'POST',url:url+'/setting-batches',headers:{...HEADERS,cookie},payload:{selectedItemKeys:['world-stage'],idempotencyKey:'seed-147'}});
      await pollBatch(app,cookie,bookId,seed.json().data.batchId);
      const requested=await app.inject({method:'POST',url:url+'/setting-final-reviews',headers:{...HEADERS,cookie},payload:{idempotencyKey:'review-147'}});
      const oldId=requested.json().data.taskId;
      expect((await pollFinalReview(app,cookie,bookId)).status).toBe('failed');
      const old=context.database.prepare('SELECT * FROM v7_setting_batches WHERE batch_id=?').get(oldId);
      const items=context.database.prepare('SELECT * FROM v7_setting_items WHERE book_id=?').all(bookId);
      failing=false;
      const retry=await app.inject({method:'POST',url:url+`/setting-final-reviews/${oldId}/retry`,headers:{...HEADERS,cookie},payload:{}});
      expect(retry.statusCode,retry.body).toBe(200);
      expect(retry.json().data.taskId).not.toBe(oldId);
      expect((await pollFinalReview(app,cookie,bookId)).status).toBe('ready');
      const replay=await app.inject({method:'POST',url:url+`/setting-final-reviews/${oldId}/retry`,headers:{...HEADERS,cookie},payload:{}});
      expect(replay.json().data.taskId).toBe(retry.json().data.taskId);
      expect(context.database.prepare('SELECT * FROM v7_setting_batches WHERE batch_id=?').get(oldId)).toEqual(old);
      expect(context.database.prepare('SELECT * FROM v7_setting_items WHERE book_id=?').all(bookId)).toEqual(items);
      expect(purposes.every(p=>p==='novel_reviewer')).toBe(true);
    }finally{await app.close();}
  });
  it.each(['normal', 'handoff', 'repair', 'unknown', 'patch', 'review_handoff'] as const)('精练设定 %s：同人统筹、草案接续与自动独立审查', async (mode) => {
    context = createTestContext('wenmi-r139-setting-');
    const delegate = new SettingResolver(false);
    const calls: Array<{member: string; model: string; prompt: string}> = [];
    let first = true;
    const resolver: V7OpeningModelAdapterResolver = { resolve(provider, modelId, purpose) {
      const adapter = delegate.resolve(provider, modelId, purpose);
      return { provider, modelId, generate: async (request, signal) => {
        const prompt = settingStagePrompt(request.prompt);
        calls.push({member: request.agentId, model: modelId, prompt});
        if (prompt.includes('v7_setting_group_design_v1')) {
          if (first && mode === 'unknown') { first = false; throw new ModelAdapterError('probe unknown', 'technical_failure', true, 504, true); }
          if (first && mode === 'handoff') { first = false; throw new Error('probe known failure'); }
          const value = JSON.parse(groupedSettingOutput(prompt));
          for (const item of value.items) {
            item.content += '渡船每次最多12人，夜间停航；只有官署急令可破例。';
            item.factEntries.push('渡船每次最多12人，夜间停航；只有官署急令可破例。');
            if (first && mode === 'repair') item.content += '超出技术容量。'.repeat(1800);
          }
          first = false;
          return {provider, modelId, output: JSON.stringify(value), inputTokens: 100, outputTokens: 100, cashCostCny: 0, state: 'succeeded'};
        }
        if (mode === 'review_handoff' && prompt.includes('v7_setting_batch_final_review_v1') && calls.filter(call => call.prompt.includes('v7_setting_batch_final_review_v1')).length === 1) throw new Error('审查成员已知失败');
        if (prompt.includes('v7_setting_batch_final_review_v1')) return {
          provider, modelId, output: JSON.stringify({verdict: 'pass', summary: '渡船人数、禁航条件和例外一致。', unifiedDecisions: [], conflicts: [], patches: mode === 'patch' ? [{itemKey:'world-stage', finalContent:'渡船每次最多12人，夜间停航；只有官署急令可破例。渡口使用铜钱。', summary:'统一货币。', contextSummary:'人数与夜航规则保持不变，使用铜钱。', factEntries:['渡船每次最多12人，夜间停航；只有官署急令可破例。','渡口使用铜钱。'], issues:[], suggestions:[]}] : []}),
          inputTokens: 100, outputTokens: 100, cashCostCny: 0, state: 'succeeded'
        };
        return adapter.generate(request, signal);
      }};
    }};
    const app = await createServer(context.config, context.database, {v7OpeningModelAdapters: resolver});
    try {
      const cookie = await register(app, 'r139-' + mode + '@example.test', '设定验收作者', 'strong-pass-r139');
      const bookId = await createBook(app, cookie, '江城渡船', 'r139-book-' + mode, '历史脑洞');
      const url = '/api/v1/v7/books/' + bookId;
      const created = await app.inject({method: 'POST', url: url + '/setting-batches', headers: {...HEADERS, cookie},
        payload: {selectedItemKeys: ['world-stage', 'governance'], designMemberKey: 'planner-deepseek-v4-pro', idempotencyKey: 'r139-batch-' + mode}});
      expect(created.statusCode, created.body).toBe(200);
      const batchId = created.json().data.batchId;
      const completed = await pollBatch(app, cookie, bookId, batchId);
      const designCalls = calls.filter(call => call.prompt.includes('v7_setting_group_design_v1'));
      if (mode === 'unknown') {
        expect(completed.status).toBe('partially_failed');
        expect(designCalls).toHaveLength(1);
        expect(completed.retryable).toBe(false);
        expect(calls.some(call => call.prompt.includes('v7_setting_batch_final_review_v1'))).toBe(false);
        return;
      }
      expect(completed.status, JSON.stringify(completed)).toBe('awaiting_author');
      expect(completed.leadMemberKey).toBe('planner-deepseek-v4-pro');
      expect(designCalls).toHaveLength(['normal','patch','review_handoff'].includes(mode) ? 2 : 3);
      const deliveredCalls = ['normal','patch','review_handoff'].includes(mode) ? designCalls : designCalls.slice(1);
      expect(new Set(deliveredCalls.map(call => call.member)).size).toBe(1);
      expect(deliveredCalls[1]!.prompt).toContain('当前待确认草案');
      expect(deliveredCalls[1]!.prompt).toContain('渡船每次最多12人，夜间停航；只有官署急令可破例。');
      expect(completed.items.every((item: {content: string; state: string}) => item.content.length <= 600 && item.state === 'needs_author')).toBe(true);
      const reviewed = await pollFinalReview(app, cookie, bookId);
      expect(reviewed.status, JSON.stringify(reviewed)).toBe('ready');
      const reviewCalls = calls.filter(call => call.prompt.includes('v7_setting_batch_final_review_v1'));
      expect(reviewCalls).toHaveLength(mode === 'review_handoff' ? 2 : 1);
      expect(reviewed.member.memberKey).toBe(reviewCalls.at(-1)!.member);
      const reviewState = context.database.prepare('SELECT custom_items_json FROM v7_setting_batches WHERE batch_id=?').get(reviewed.taskId) as {custom_items_json:string};
      expect(JSON.parse(reviewState.custom_items_json).attemptedMemberKeys).toHaveLength(reviewCalls.length);
      expect(JSON.parse(reviewCalls[0]!.prompt).outputSchema.factLedger).toBeUndefined();
      expect(JSON.parse(reviewCalls[0]!.prompt).delivery).toContain('不要重新抄写');
      const storedReview = context.database.prepare("SELECT content_json FROM v7_setting_outputs WHERE book_id=? AND item_key='__batch_final_review__' ORDER BY created_at DESC LIMIT 1").get(bookId) as {content_json:string};
      const ledger = JSON.parse(storedReview.content_json).factLedger as Array<{facts:string[]}>;
      expect(ledger.every(entry => entry.facts.includes('渡船每次最多12人，夜间停航；只有官署急令可破例。'))).toBe(true);
      if (mode === 'patch') expect(ledger.some(entry => entry.facts.includes('渡口使用铜钱。'))).toBe(true);
      expect(deliveredCalls.map(call => call.model)).not.toContain(reviewCalls[0]!.model);
      const count = calls.length;
      await app.inject({method:'GET', url: url + '/setting-batches/' + batchId, headers:{...HEADERS, cookie}});
      expect(calls).toHaveLength(count);
      const rows = context.database.prepare('SELECT context_manifest_json FROM v7_setting_item_jobs WHERE batch_id=?').all(batchId) as Array<{context_manifest_json:string}>;
      expect(rows.every(row => JSON.parse(row.context_manifest_json).characterCount <= 12000)).toBe(true);
    } finally { await app.close(); }
  });

  it.each([740, 3000])('旧长草案每条%s字时选择完整相关事实，保留原文并完成新设定', async (draftLength) => {
    context = createTestContext('wenmi-r139-context-');
    const delegate = new SettingResolver(false);
    let selectionCalls = 0;
    const resolver: V7OpeningModelAdapterResolver = {resolve(provider, modelId, purpose) {
      const adapter = delegate.resolve(provider, modelId, purpose);
      return {provider, modelId, generate: async (request, signal) => {
        if (request.prompt.includes('【可选事实】')) {
          selectionCalls++;
          const selectedFactIds = request.prompt.includes('旧草案0：') ? ['0:0'] : [];
          return {provider, modelId, output: JSON.stringify({selectedFactIds,blocked:false}), inputTokens:100, outputTokens:20, cashCostCny:0, state:'succeeded'};
        }
        return adapter.generate(request, signal);
      }};
    }};
    const app = await createServer(context.config, context.database, {v7OpeningModelAdapters:resolver});
    try {
      const cookie = await register(app, 'r139-context@example.test', '上下文作者', 'strong-pass-139');
      const bookId = await createBook(app,cookie,'草案接续','r139-context-book','历史脑洞');
      const ownerId = (context.database.prepare('SELECT owner_id FROM books WHERE book_id=?').get(bookId) as {owner_id:string}).owner_id;
      for (let index=0; index<20; index++) {
        const key='r139-draft-'+index, version='r139-version-'+index;
        context.database.prepare(`INSERT INTO v7_setting_item_versions (version_id,owner_id,book_id,item_key,revision,status,content_json,created_by,created_at)
          VALUES (?,?,?,?,1,'candidate',?,'author','2026-01-01T00:00:00.000Z')`).run(version,ownerId,bookId,key,JSON.stringify({
            finalContent: ('渡船最多12人，夜间停航；官署急令例外。旧草案'+index+'：').padEnd(draftLength,'详'),
            contextSummary:'渡船人数与夜间禁航规则。',factEntries:['渡船最多12人，夜间停航；官署急令例外。']
          }));
        context.database.prepare(`INSERT INTO v7_setting_items (owner_id,book_id,item_key,item_label,group_title,item_prompt,state,active_version_id,revision,updated_at)
          VALUES (?,?,?,?,'草案','保留完整规则','needs_author',?,1,'2026-01-01T00:00:00.000Z')`).run(ownerId,bookId,key,'待确认规则'+index,version);
      }
      const original=context.database.prepare('SELECT version_id,content_json FROM v7_setting_item_versions WHERE book_id=?').all(bookId);
      const created=await app.inject({method:'POST',url:'/api/v1/v7/books/'+bookId+'/setting-batches',headers:{...HEADERS,cookie},
        payload:{selectedItemKeys:['world-stage'],designMemberKey:'planner-deepseek-v4-pro',idempotencyKey:'r139-context-batch'}});
      expect(created.statusCode,created.body).toBe(200);
      const completed=await pollBatch(app,cookie,bookId,created.json().data.batchId);
      expect(completed.status,JSON.stringify(completed)).toBe('awaiting_author');
      if (draftLength === 740) expect(selectionCalls).toBe(1);
      else expect(selectionCalls).toBeGreaterThan(1);
      const prompt=delegate.prompts.find(prompt=>prompt.includes('v7_setting_group_design_v1'))!;
      expect(prompt).toContain('渡船最多12人，夜间停航；官署急令例外。');
      expect(prompt).not.toContain('旧草案19');
      expect((await pollFinalReview(app,cookie,bookId)).status).toBe('ready');
      for (const row of original as Array<{version_id:string;content_json:string}>) expect(context.database.prepare('SELECT content_json FROM v7_setting_item_versions WHERE version_id=?').get(row.version_id)).toEqual({content_json:row.content_json});
    } finally {await app.close();}
  });

  it('资料保存后新设定任务读取新版本，确认设定与旧任务冻结版本保持可追溯', async () => {
    context = createTestContext('wenmi-r138-information-setting-');
    const resolver = new SettingResolver(false);
    const app = await createServer(context.config, context.database, { v7OpeningModelAdapters: resolver });
    try {
      const cookie = await register(app, 'r138@example.test', '资料设定作者', 'strong-pass-r138');
      const bookId = await createBook(app, cookie, '资料设定接入', 'r138-book-0001', '历史脑洞');
      const url = `/api/v1/v7/books/${bookId}`;
      const first = await app.inject({ method: 'POST', url: `${url}/setting-batches`, headers: { ...HEADERS, cookie }, payload: { selectedItemKeys: ['world-stage'], idempotencyKey: 'r138-first-0001' } });
      expect(first.statusCode).toBe(200);
      const firstId = first.json().data.batchId as string;
      const completed = await pollBatch(app, cookie, bookId, firstId);
      const candidate = completed.items.find((item: {itemKey:string}) => item.itemKey === 'world-stage');
      const accepted = await app.inject({ method: 'POST', url: `${url}/setting-items/world-stage/confirm`, headers: { ...HEADERS, cookie }, payload: { expectedRevision: candidate.revision } });
      expect(accepted.statusCode).toBe(200);
      const frozen = context.database.prepare('SELECT manifest_id,compiled_prompt_hash FROM v7_prompt_manifests WHERE book_id=? ORDER BY manifest_id').all(bookId) as Array<{manifest_id:string;compiled_prompt_hash:string}>;
      expect(frozen.length).toBeGreaterThan(0);
      const profile = (await app.inject({ method: 'GET', url: `${url}/book-profile`, headers: { ...HEADERS, cookie } })).json().data;
      const boundary = '作者本轮边界：城中没有传送术';
      const revised = await app.inject({ method: 'PUT', url: `${url}/book-profile`, headers: { ...HEADERS, cookie }, payload: { expectedVersion: profile.version, title: '新资料设定接入', openingBlueprint: { ...profile.openingBlueprint, mustFollow: [...profile.mustFollow, boundary] } } });
      expect(revised.statusCode).toBe(200);
      expect(revised.json().data.version).toBe(profile.version + 1);
      const refreshed = await app.inject({ method: 'GET', url: `${url}/book-profile`, headers: { ...HEADERS, cookie } });
      expect(refreshed.json().data).toMatchObject({ title: '新资料设定接入', version: profile.version + 1, mustFollow: expect.arrayContaining([boundary]) });
      const callOffset = resolver.prompts.length;
      const second = await app.inject({ method: 'POST', url: `${url}/setting-batches`, headers: { ...HEADERS, cookie }, payload: { selectedItemKeys: ['governance'], idempotencyKey: 'r138-second-0001' } });
      expect(second.statusCode).toBe(200);
      const secondId = second.json().data.batchId as string;
      expect((await pollBatch(app, cookie, bookId, secondId)).status).toBe('awaiting_author');
      expect(resolver.prompts.slice(callOffset).join('\n')).toContain(boundary);
      expect(context.database.prepare('SELECT opening_version FROM v7_setting_batches WHERE batch_id=?').get(firstId)).toEqual({ opening_version: profile.version });
      expect(context.database.prepare('SELECT opening_version FROM v7_setting_batches WHERE batch_id=?').get(secondId)).toEqual({ opening_version: profile.version + 1 });
      for (const row of frozen) expect(context.database.prepare('SELECT compiled_prompt_hash FROM v7_prompt_manifests WHERE manifest_id=?').get(row.manifest_id)).toEqual({ compiled_prompt_hash: row.compiled_prompt_hash });
      const department = (await app.inject({ method: 'GET', url: `${url}/setting-department`, headers: { ...HEADERS, cookie } })).json().data;
      expect(department.confirmedItems.find((item: {itemKey:string}) => item.itemKey === 'world-stage')).toMatchObject({ state: 'confirmed', revision: accepted.json().data.revision });
      const sources = context.database.prepare(`SELECT s.source_type,s.source_version FROM v7_context_source_traces s JOIN v7_context_pack_traces p ON p.context_pack_id=s.context_pack_id WHERE p.book_id=? AND s.source_type='confirmed_setting'`).all(bookId);
      expect(sources.length).toBeGreaterThan(0);
    } finally { await app.close(); }
  });

  it('固定三名强模型主编、三名强模型副编和三名强模型策划，Kimi K3只走Agent Plan', () => {
    expect(validateSettingEditorialRoster()).toEqual([]);
    expect(V7_SETTING_MEMBERS.filter((member) => member.roleKey === 'chief_editor')).toHaveLength(3);
    expect(V7_SETTING_MEMBERS.filter((member) => member.roleKey === 'deputy_editor')).toHaveLength(3);
    expect(V7_SETTING_MEMBERS.filter((member) => member.roleKey === 'screenwriter')).toHaveLength(3);
    expect(V7_SETTING_MEMBERS.find((member) => member.model.modelId === 'kimi-k3')?.model.plan).toBe('agent');
  });

  it('三国书由主编完整理解后推荐，读取页面不暗中调用，同一开书版本只调用一次', async () => {
    context = createTestContext('wenmi-v7-setting-recommendation-');
    context.config.modelRuntime.endpoints.coding.apiKey = 'test-coding-plan-key';
    const app = await createServer(context.config, context.database, { v7OpeningModelAdapters: new SettingResolver(false) });
    try {
      const cookie = await register(app, 'setting-recommendation@example.com', '推荐测试作者', 'strong-pass-123');
      const bookId = await createBook(app, cookie, '三国设定测试', 'recommendation-book-0001', '历史脑洞', {
        tags: ['历史', '古代', '权谋', '爽文', '智商在线', '种田', '热血', '逆袭'],
        mustFollow: ['不得引入玄幻、修仙、系统等超现实元素']
      });
      const department = await app.inject({ method: 'GET', url: `/api/v1/v7/books/${bookId}/setting-department`, headers: { host: HEADERS.host, cookie } });
      expect(department.statusCode).toBe(200);
      expect(department.json().data.recommendation).toBeNull();
      expect(department.json().data.catalog.some((item: { key: string }) => item.key === 'history')).toBe(true);
      expect(department.json().data.catalog.some((item: { key: string }) => item.key === 'game-entry')).toBe(true);
      expect(context.database.prepare(`SELECT COUNT(*) AS count FROM v7_setting_model_calls WHERE book_id=? AND node_key='catalog_recommendation'`).get(bookId)).toEqual({ count: 0 });

      const created = await app.inject({ method: 'POST', url: `/api/v1/v7/books/${bookId}/setting-recommendations`, headers: { ...HEADERS, cookie }, payload: {} });
      expect(created.statusCode).toBe(200);
      const completed = await pollRecommendation(app, cookie, bookId, created.json().data.taskId as string);
      const internalFailure = context.database.prepare(`SELECT internal_reason FROM v7_setting_member_events
        WHERE book_id=? AND event_type='leave' ORDER BY created_at DESC LIMIT 1`).get(bookId);
      expect(completed.status, `${JSON.stringify(completed)}\n${JSON.stringify(internalFailure)}`).toBe('ready');
      expect(completed.result.requiredKeys).toContain('history');
      expect(completed.result.requiredKeys).not.toContain('game-entry');
      expect(completed.result.requiredKeys).not.toContain('cultivation');
      expect(completed.result.excludedKeys).toEqual(expect.arrayContaining(['game-entry', 'levels']));
      expect(completed.retryable).toBe(false);
      const repeated = await app.inject({ method: 'POST', url: `/api/v1/v7/books/${bookId}/setting-recommendations`, headers: { ...HEADERS, cookie }, payload: {} });
      expect(repeated.statusCode).toBe(200);
      expect(repeated.json().data.taskId).toBe(completed.taskId);
      expect(context.database.prepare(`SELECT COUNT(*) AS count FROM v7_setting_model_calls WHERE book_id=? AND node_key='catalog_recommendation'`).get(bookId)).toEqual({ count: 1 });
      const refreshed = await app.inject({ method: 'GET', url: `/api/v1/v7/books/${bookId}/setting-department`, headers: { host: HEADERS.host, cookie } });
      expect(refreshed.json().data.recommendation.taskId).toBe(completed.taskId);
      expect(refreshed.json().data.recommendedKeys).toEqual(completed.result.requiredKeys);
      const genreProfile = context.database.prepare(`SELECT primary_genre_key,supporting_genre_keys_json,status,source_book_version
        FROM v7_book_genre_profiles WHERE book_id=? AND status='active'`).get(bookId) as {
          primary_genre_key: string;
          supporting_genre_keys_json: string;
          status: string;
          source_book_version: number;
        };
      expect(genreProfile).toMatchObject({ primary_genre_key: 'history', status: 'active', source_book_version: 1 });
      expect(JSON.parse(genreProfile.supporting_genre_keys_json)).not.toEqual(expect.arrayContaining(['game_sports', 'fantasy', 'xianxia']));
      expect(context.database.prepare(`SELECT COUNT(*) AS count FROM v7_setting_model_calls
        WHERE book_id=? AND node_key='genre_profile'`).get(bookId)).toEqual({ count: 1 });
      expect(context.database.prepare(`SELECT member_key FROM v7_setting_model_calls
        WHERE book_id=? AND node_key='genre_profile'`).get(bookId)).toEqual({ member_key: 'deputy-deepseek-v4-pro' });

      // 提示词/解析合同升级后，旧清单必须保留为审计，但作者再次点击
      // 应创建新任务；不能因为开书版本没变而永远复用过期结果。
      context.database.prepare(`UPDATE v7_setting_batches SET request_hash=?,idempotency_key=? WHERE batch_id=?`)
        .run('0'.repeat(64), 'setting-recommendation-legacy-contract', completed.taskId);
      const stale = await app.inject({ method: 'GET', url: `/api/v1/v7/books/${bookId}/setting-department`, headers: { host: HEADERS.host, cookie } });
      expect(stale.statusCode).toBe(200);
      expect(stale.json().data.recommendation).toMatchObject({ taskId: completed.taskId, status: 'failed', retryable: false });
      const rebuilt = await app.inject({ method: 'POST', url: `/api/v1/v7/books/${bookId}/setting-recommendations`, headers: { ...HEADERS, cookie }, payload: {} });
      expect(rebuilt.statusCode).toBe(200);
      expect(rebuilt.json().data.taskId).not.toBe(completed.taskId);
      const rebuiltCompleted = await pollRecommendation(app, cookie, bookId, rebuilt.json().data.taskId as string);
      expect(rebuiltCompleted.status).toBe('ready');
      expect(context.database.prepare(`SELECT COUNT(*) AS count FROM v7_setting_model_calls WHERE book_id=? AND node_key='catalog_recommendation'`).get(bookId)).toEqual({ count: 2 });
    } finally { await app.close(); }
  });

  it('融合题材不会由系统直接定性，而由副编一次语义整理并形成书级档案', async () => {
    context = createTestContext('wenmi-v7-setting-genre-semantic-');
    context.config.modelRuntime.endpoints.coding.apiKey = 'test-coding-plan-key';
    const app = await createServer(context.config, context.database, { v7OpeningModelAdapters: new SettingResolver(false) });
    try {
      const cookie = await register(app, 'setting-genre-semantic@example.com', '题材语义作者', 'strong-pass-123');
      const bookId = await createBook(app, cookie, '古代职场探案', 'genre-semantic-book-0001', '历史脑洞', {
        tags: ['权谋', '悬疑', '成长'],
        mustFollow: ['不出现超凡力量和游戏系统']
      });
      const created = await app.inject({
        method: 'POST', url: `/api/v1/v7/books/${bookId}/setting-recommendations`,
        headers: { ...HEADERS, cookie }, payload: {}
      });
      expect(created.statusCode).toBe(200);
      const completed = await pollRecommendation(app, cookie, bookId, created.json().data.taskId as string);
      expect(completed.status).toBe('ready');
      expect(context.database.prepare(`SELECT primary_genre_key,status FROM v7_book_genre_profiles
        WHERE book_id=? AND status='active'`).get(bookId)).toEqual({ primary_genre_key: 'history', status: 'active' });
      expect(context.database.prepare(`SELECT COUNT(*) AS count FROM v7_setting_model_calls
        WHERE book_id=? AND node_key='genre_profile'`).get(bookId)).toEqual({ count: 1 });
    } finally { await app.close(); }
  });

  it('主编整理失败会如实保存，作者明确重试时沿用冻结任务并发起新的执行请求', async () => {
    context = createTestContext('wenmi-v7-setting-recommendation-failed-');
    context.config.modelRuntime.endpoints.coding.apiKey = 'test-coding-plan-key';
    const resolver = new SettingResolver(false, true);
    const app = await createServer(context.config, context.database, { v7OpeningModelAdapters: resolver });
    try {
      const cookie = await register(app, 'setting-recommendation-failed@example.com', '失败测试作者', 'strong-pass-123');
      const bookId = await createBook(app, cookie, '三国失败测试', 'recommendation-failed-book-0001', '历史脑洞');
      const created = await app.inject({ method: 'POST', url: `/api/v1/v7/books/${bookId}/setting-recommendations`, headers: { ...HEADERS, cookie }, payload: {} });
      expect(created.statusCode).toBe(200);
      const failed = await pollRecommendation(app, cookie, bookId, created.json().data.taskId as string);
      expect(failed.status).toBe('failed');
      expect(failed.retryable).toBe(true);
      expect(failed.result).toBeNull();
      const currentFailed = await app.inject({
        method: 'GET', url: `/api/v1/v7/books/${bookId}/setting-recommendations/current`, headers: { host: HEADERS.host, cookie }
      });
      expect(currentFailed.statusCode).toBe(200);
      expect(currentFailed.json().data.taskId).toBe(failed.taskId);
      expect(currentFailed.json().data.status).toBe('failed');
      const repeated = await app.inject({ method: 'POST', url: `/api/v1/v7/books/${bookId}/setting-recommendations`, headers: { ...HEADERS, cookie }, payload: {} });
      expect(repeated.statusCode).toBe(200);
      expect(repeated.json().data.taskId).toBe(failed.taskId);
      expect(resolver.recommendationAttempts).toBe(1);
      expect(context.database.prepare(`SELECT COUNT(*) AS count FROM v7_setting_model_calls WHERE book_id=? AND node_key='catalog_recommendation'`).get(bookId)).toEqual({ count: 1 });
      resolver.failRecommendation = false;
      const resumed = await app.inject({
        method: 'POST', url: `/api/v1/v7/books/${bookId}/setting-recommendations/retry`,
        headers: { ...HEADERS, cookie }, payload: {}
      });
      expect(resumed.statusCode, resumed.body).toBe(200);
      expect(['queued', 'working']).toContain(resumed.json().data.status);
      const completed = await pollRecommendation(app, cookie, bookId, failed.taskId);
      expect(completed.status).toBe('ready');
      expect(resolver.recommendationAttempts).toBe(2);
      const calls = context.database.prepare(`SELECT request_id,prompt_hash,state FROM v7_setting_model_calls
        WHERE book_id=? AND node_key='catalog_recommendation' ORDER BY started_at,request_id`).all(bookId) as Array<{
          request_id: string; prompt_hash: string; state: string;
        }>;
      expect(calls.map((call) => call.state)).toEqual(['failed', 'succeeded']);
      expect(new Set(calls.map((call) => call.request_id)).size).toBe(2);
      expect(new Set(calls.map((call) => call.prompt_hash)).size).toBe(1);
    } finally { await app.close(); }
  });

  it('设定清单主输出结构损坏时只调用一次repair并完成原任务', async () => {
    context = createTestContext('wenmi-v7-setting-recommendation-repair-');
    context.config.modelRuntime.endpoints.coding.apiKey = 'test-coding-plan-key';
    const resolver = new StructureRecoveryResolver();
    resolver.invalidRecommendationMain = true;
    const app = await createServer(context.config, context.database, { v7OpeningModelAdapters: resolver });
    try {
      const cookie = await register(app, 'setting-recommendation-repair@example.com', '清单修复作者', 'strong-pass-123');
      const bookId = await createBook(app, cookie, '设定清单结构修复', 'recommendation-repair-book-0001', '历史脑洞');
      const created = await app.inject({
        method: 'POST', url: `/api/v1/v7/books/${bookId}/setting-recommendations`, headers: { ...HEADERS, cookie }, payload: {}
      });
      expect(created.statusCode, created.body).toBe(200);
      const taskId = created.json().data.taskId as string;
      const completed = await pollRecommendation(app, cookie, bookId, taskId);
      expect(completed).toMatchObject({ taskId, status: 'ready', retryable: false });
      expect(resolver.recommendationMainCalls).toBe(1);
      expect(resolver.recommendationRepairCalls).toBe(1);
      const calls = context.database.prepare(`SELECT node_key,state FROM v7_setting_model_calls
        WHERE book_id=? AND batch_id=? AND node_key IN ('catalog_recommendation','catalog_recommendation_repair')
        ORDER BY request_id`).all(bookId, taskId);
      expect(calls).toHaveLength(2);
      expect(calls).toEqual(expect.arrayContaining([
        { node_key: 'catalog_recommendation', state: 'succeeded' },
        { node_key: 'catalog_recommendation_repair', state: 'succeeded' }
      ]));
    } finally { await app.close(); }
  });

  it('设定清单repair已知失败后沿用原任务续跑，且不重新调用已成功主输出', async () => {
    context = createTestContext('wenmi-v7-setting-recommendation-repair-retry-');
    context.config.modelRuntime.endpoints.coding.apiKey = 'test-coding-plan-key';
    const resolver = new StructureRecoveryResolver();
    resolver.invalidRecommendationMain = true;
    resolver.failRecommendationRepair = true;
    const app = await createServer(context.config, context.database, { v7OpeningModelAdapters: resolver });
    try {
      const cookie = await register(app, 'setting-recommendation-repair-retry@example.com', '清单续修作者', 'strong-pass-123');
      const bookId = await createBook(app, cookie, '设定清单续修', 'recommendation-repair-retry-book-0001', '历史脑洞');
      const created = await app.inject({
        method: 'POST', url: `/api/v1/v7/books/${bookId}/setting-recommendations`, headers: { ...HEADERS, cookie }, payload: {}
      });
      const taskId = created.json().data.taskId as string;
      const failed = await pollRecommendation(app, cookie, bookId, taskId);
      expect(failed).toMatchObject({ taskId, status: 'failed', retryable: true, restartable: false });
      expect(resolver.recommendationMainCalls).toBe(1);
      expect(resolver.recommendationRepairCalls).toBe(1);

      resolver.failRecommendationRepair = false;
      const retried = await app.inject({
        method: 'POST', url: `/api/v1/v7/books/${bookId}/setting-recommendations/${taskId}/retry`,
        headers: { ...HEADERS, cookie }, payload: {}
      });
      expect(retried.statusCode, retried.body).toBe(200);
      expect(retried.json().data.taskId).toBe(taskId);
      const completed = await pollRecommendation(app, cookie, bookId, taskId);
      expect(completed).toMatchObject({ taskId, status: 'ready', retryable: false });
      expect(resolver.recommendationMainCalls).toBe(1);
      expect(resolver.recommendationRepairCalls).toBe(2);
      const calls = context.database.prepare(`SELECT node_key,state FROM v7_setting_model_calls
        WHERE book_id=? AND batch_id=? AND node_key IN ('catalog_recommendation','catalog_recommendation_repair')
        ORDER BY request_id`).all(bookId, taskId);
      expect(calls).toHaveLength(3);
      expect(calls).toEqual(expect.arrayContaining([
        { node_key: 'catalog_recommendation', state: 'succeeded' },
        { node_key: 'catalog_recommendation_repair', state: 'failed' },
        { node_key: 'catalog_recommendation_repair', state: 'succeeded' }
      ]));
    } finally { await app.close(); }
  });

  it('设定清单会员额度前置失败不伪造成主编请假，补额度后沿用原任务完成', async () => {
    context = createTestContext('wenmi-v7-setting-recommendation-quota-');
    context.config.modelRuntime.endpoints.coding.apiKey = 'test-coding-plan-key';
    const resolver = new SettingResolver(false);
    const app = await createServer(context.config, context.database, { v7OpeningModelAdapters: resolver });
    try {
      await register(app, 'setting-recommendation-quota-admin@example.com', '清单额度管理员', 'strong-pass-926');
      const cookie = await register(app, 'setting-recommendation-quota@example.com', '清单额度作者', 'strong-pass-927');
      const bookId = await createBook(app, cookie, '设定清单额度恢复', 'recommendation-quota-book', '历史脑洞');
      const owner = context.database.prepare('SELECT owner_id FROM books WHERE book_id=?').get(bookId) as { owner_id: string };
      context.database.prepare('UPDATE user_memberships SET token_quota=1 WHERE owner_id=?').run(owner.owner_id);
      const created = await app.inject({
        method: 'POST', url: `/api/v1/v7/books/${bookId}/setting-recommendations`, headers: { ...HEADERS, cookie }, payload: {}
      });
      expect(created.statusCode, created.body).toBe(200);
      const taskId = created.json().data.taskId as string;
      const failed = await pollRecommendation(app, cookie, bookId, taskId);
      expect(context.database.prepare(`SELECT error_code,failure_stage,retry_safety FROM v7_setting_batches
        WHERE owner_id=? AND book_id=? AND batch_id=?`).get(owner.owner_id, bookId, taskId)).toEqual({
        error_code: 'MEMBERSHIP_QUOTA_EXHAUSTED', failure_stage: 'pre_dispatch', retry_safety: 'safe_after_precondition'
      });
      expect(failed).toMatchObject({ taskId, status: 'failed', retryable: true, restartable: false });
      expect(context.database.prepare(`SELECT COUNT(*) AS count FROM v7_setting_member_events
        WHERE owner_id=? AND book_id=? AND batch_id=? AND event_type IN ('leave','handoff')`).get(
        owner.owner_id, bookId, taskId
      )).toEqual({ count: 0 });

      context.database.prepare('UPDATE user_memberships SET token_quota=500000 WHERE owner_id=?').run(owner.owner_id);
      const retried = await app.inject({
        method: 'POST', url: `/api/v1/v7/books/${bookId}/setting-recommendations/${taskId}/retry`,
        headers: { ...HEADERS, cookie }, payload: {}
      });
      expect(retried.statusCode, retried.body).toBe(200);
      expect(retried.json().data.taskId).toBe(taskId);
      expect((await pollRecommendation(app, cookie, bookId, taskId)).status).toBe('ready');
      expect(context.database.prepare(`SELECT error_code,failure_stage,retry_safety FROM v7_setting_batches
        WHERE owner_id=? AND book_id=? AND batch_id=?`).get(owner.owner_id, bookId, taskId)).toEqual({
        error_code: null, failure_stage: null, retry_safety: null
      });
      expect(context.database.prepare(`SELECT COUNT(*) AS count FROM v7_setting_member_events
        WHERE owner_id=? AND book_id=? AND batch_id=? AND event_type IN ('leave','handoff')`).get(
        owner.owner_id, bookId, taskId
      )).toEqual({ count: 0 });
    } finally { await app.close(); }
  });

  it('设定清单结果未知时只允许刷新核对，不把未知调用盲目重发', async () => {
    context = createTestContext('wenmi-v7-setting-recommendation-unknown-');
    context.config.modelRuntime.endpoints.coding.apiKey = 'test-coding-plan-key';
    const resolver = new SettingResolver(false, true, true);
    const app = await createServer(context.config, context.database, { v7OpeningModelAdapters: resolver });
    try {
      const cookie = await register(app, 'setting-recommendation-unknown@example.com', '未知清单作者', 'strong-pass-123');
      const bookId = await createBook(app, cookie, '未知清单测试', 'recommendation-unknown-book-0001', '历史脑洞');
      const created = await app.inject({
        method: 'POST', url: `/api/v1/v7/books/${bookId}/setting-recommendations`, headers: { ...HEADERS, cookie }, payload: {}
      });
      const failed = await pollRecommendation(app, cookie, bookId, created.json().data.taskId as string);
      expect(failed).toMatchObject({ status: 'failed', retryable: false });
      expect(failed.statusText).toMatch(/结果(?:还不能|暂时无法)确认/u);
      const callsBefore = resolver.recommendationAttempts;
      const retried = await app.inject({
        method: 'POST', url: `/api/v1/v7/books/${bookId}/setting-recommendations/retry`,
        headers: { ...HEADERS, cookie }, payload: {}
      });
      expect(retried.statusCode).toBe(409);
      expect(JSON.stringify(retried.json())).toMatch(/不能盲目重试/u);
      expect(resolver.recommendationAttempts).toBe(callsBefore);
    } finally { await app.close(); }
  });

  it('按书隔离、失败请假交接、幂等恢复、主编审核和作者确认形成不可变版本', async () => {
    context = createTestContext('wenmi-v7-setting-');
    const resolver = new SettingResolver(true);
    const app = await createServer(context.config, context.database, { v7OpeningModelAdapters: resolver });
    try {
      const cookie = await register(app, 'setting-author@example.com', '设定作者', 'strong-pass-123');
      const other = await register(app, 'setting-other@example.com', '另一作者', 'strong-pass-456');
      const firstBook = await createBook(app, cookie, '三国设定测试', 'history-book-0001', '历史脑洞');
      const secondBook = await createBook(app, cookie, '星际设定测试', 'scifi-book-0001', '科幻末世');

      const department = await app.inject({ method: 'GET', url: `/api/v1/v7/books/${firstBook}/setting-department`, headers: { host: HEADERS.host, cookie } });
      expect(department.statusCode).toBe(200);
      expect(department.json().data.catalog.some((item: { key: string }) => item.key === 'history')).toBe(true);
      expect(department.json().data.members).toHaveLength(13);
      expect(JSON.stringify(department.json().data.members)).not.toMatch(/modelId|provider|凭据|失败|timeout/iu);

      const payload = { selectedItemKeys: ['world-stage', 'history'], customItems: [], authorNotes: {}, idempotencyKey: 'setting-batch-0001' };
      const created = await app.inject({ method: 'POST', url: `/api/v1/v7/books/${firstBook}/setting-batches`, headers: { ...HEADERS, cookie }, payload });
      expect(created.statusCode).toBe(200);
      const batchId = created.json().data.batchId as string;
      const completed = await pollBatch(app, cookie, firstBook, batchId);
      expect(completed.status).toBe('awaiting_author');
      expect(completed.progress).toEqual({ completed: 2, total: 2, percent: 100 });
      expect(completed.items.every((item: { content: string | null }) => typeof item.content === 'string')).toBe(true);
      expect(completed.members.some((member: { statusText: string }) => /请假|交接/u.test(member.statusText))).toBe(true);
      expect(resolver.prompts.join('\n')).toContain('东汉末年');
      expect(resolver.prompts.join('\n')).not.toContain('主角处于社会底层');
      expect(resolver.prompts.join('\n')).not.toContain('危机中醒来');
      expect(context.database.prepare(`SELECT COUNT(*) AS count FROM v7_setting_member_events WHERE owner_id=(SELECT owner_id FROM books WHERE book_id=?) AND book_id=? AND event_type='handoff'`).get(firstBook, firstBook)).toEqual({ count: 2 });
      expect(context.database.prepare(`SELECT COUNT(*) AS count FROM v7_setting_item_jobs WHERE book_id=? AND context_hash IS NOT NULL`).get(firstBook)).toEqual({ count: 2 });
      const settingSources = context.database.prepare(`SELECT DISTINCT s.owner_id AS ownerId,s.book_id AS bookId,
        s.source_type AS sourceType,s.authority,s.decision
        FROM v7_context_source_traces s
        JOIN v7_context_pack_traces p ON p.context_pack_id=s.context_pack_id
        JOIN v7_task_contracts c ON c.task_id=p.task_id AND c.owner_id=p.owner_id AND c.book_id=p.book_id
        WHERE p.book_id=? AND c.task_kind IN ('planning_context','setting_design','setting_review')`).all(firstBook) as Array<{
          ownerId: string; bookId: string; sourceType: string; authority: string; decision: string;
        }>;
      expect(settingSources.every((source) => source.bookId === firstBook && source.decision === 'included')).toBe(true);
      expect(settingSources.map((source) => source.sourceType)).toEqual(expect.arrayContaining(['opening_profile', 'catalog_contract']));
      expect(settingSources.find((source) => source.sourceType === 'opening_profile')).toEqual(expect.objectContaining({ authority: 'confirmed' }));

      const repeated = await app.inject({ method: 'POST', url: `/api/v1/v7/books/${firstBook}/setting-batches`, headers: { ...HEADERS, cookie }, payload });
      expect(repeated.statusCode).toBe(200);
      expect(repeated.json().data.batchId).toBe(batchId);
      const callCount = (context.database.prepare(`SELECT COUNT(*) AS count FROM v7_setting_model_calls WHERE book_id=?`).get(firstBook) as { count: number }).count;
      // 同类两项在四项上限内合并；幂等请求不再次派发模型调用。
      expect(callCount).toBe(2);

      const firstItem = completed.items.find((item: { itemKey: string }) => item.itemKey === 'world-stage');
      const confirmed = await app.inject({ method: 'POST', url: `/api/v1/v7/books/${firstBook}/setting-items/world-stage/confirm`, headers: { ...HEADERS, cookie }, payload: { expectedRevision: firstItem.revision } });
      expect(confirmed.statusCode).toBe(200);
      expect(confirmed.json().data.state).toBe('confirmed');
      expect(context.database.prepare(`SELECT status,COUNT(*) AS count FROM v7_setting_item_versions WHERE book_id=? AND item_key='world-stage' GROUP BY status ORDER BY status`).all(firstBook)).toEqual([
        { status: 'candidate', count: 1 }, { status: 'confirmed', count: 1 }
      ]);

      const sourceBeforeAuthorRevision = context.database.prepare(`SELECT o.request_id AS taskId
        FROM v7_setting_items i
        JOIN v7_setting_item_versions v ON v.version_id=i.active_version_id AND v.owner_id=i.owner_id AND v.book_id=i.book_id
        JOIN v7_setting_outputs o ON o.output_id=v.source_output_id AND o.owner_id=i.owner_id AND o.book_id=i.book_id
        WHERE i.book_id=? AND i.item_key='world-stage'`).get(firstBook) as { taskId: string };
      const revised = await app.inject({ method: 'POST', url: `/api/v1/v7/books/${firstBook}/setting-items/world-stage/revisions`, headers: { ...HEADERS, cookie }, payload: { content: '这是作者修改后的世界舞台，新版本保留旧版，不原地覆盖。', idempotencyKey: 'setting-author-revision-0001' } });
      expect(revised.statusCode).toBe(200);
      const revisionBatchId = revised.json().data.batchId as string;
      expect(['queued', 'working']).toContain(revised.json().data.status);
      const revisedReady = await pollBatch(app, cookie, firstBook, revisionBatchId);
      expect(revisedReady.status).toBe('awaiting_author');
      expect(revisedReady.items.find((item: { itemKey: string }) => item.itemKey === 'world-stage')?.state)
        .toBe('needs_author');
      const settingOwner = context.database.prepare('SELECT owner_id FROM books WHERE book_id=?').get(firstBook) as {owner_id: string};
      const formalWhileEditing = new V7SettingEditorialRepository(context.database).confirmedVersions(settingOwner.owner_id, firstBook)
        .find((entry) => entry.item_key === 'world-stage');
      expect(formalWhileEditing).toBeDefined();
      expect(formalWhileEditing!.revision).toBeLessThan(revisedReady.items.find((item: {itemKey: string}) => item.itemKey === 'world-stage').revision);
      expect(formalWhileEditing!.content_json).not.toContain('这是作者修改后的世界舞台');
      expect(context.database.prepare(`SELECT operation_mode AS operationMode,based_on_task_id AS basedOnTaskId,
        author_instruction_version AS authorInstructionVersion FROM v7_task_contracts
        WHERE book_id=? AND task_id=?`).get(firstBook, `${revisionBatchId}-world-stage-chief`)).toEqual({
        operationMode: 'revise', basedOnTaskId: sourceBeforeAuthorRevision.taskId, authorInstructionVersion: 1
      });
      expect(context.database.prepare(`SELECT COUNT(*) AS count FROM v7_setting_item_versions WHERE book_id=? AND item_key='world-stage'`).get(firstBook)).toEqual({ count: 3 });
      expect(context.database.prepare(`SELECT COUNT(*) AS count FROM v7_setting_model_calls WHERE book_id=? AND node_key IN ('chief','chief_repair')`).get(firstBook)).toEqual({ count: 2 });
      const repeatedRevision = await app.inject({ method: 'POST', url: `/api/v1/v7/books/${firstBook}/setting-items/world-stage/revisions`, headers: { ...HEADERS, cookie }, payload: { content: '这是作者修改后的世界舞台，新版本保留旧版，不原地覆盖。', idempotencyKey: 'setting-author-revision-0001' } });
      expect(repeatedRevision.statusCode).toBe(200);
      expect(repeatedRevision.json().data.batchId).toBe(revisionBatchId);
      expect(context.database.prepare(`SELECT COUNT(*) AS count FROM v7_setting_item_versions WHERE book_id=? AND item_key='world-stage'`).get(firstBook)).toEqual({ count: 3 });
      const conflictingRevision = await app.inject({ method: 'POST', url: `/api/v1/v7/books/${firstBook}/setting-items/world-stage/revisions`, headers: { ...HEADERS, cookie }, payload: { content: '同一操作编号不能悄悄换成另一份作者修改稿。', idempotencyKey: 'setting-author-revision-0001' } });
      expect(conflictingRevision.statusCode).toBe(409);
      expect(context.database.prepare(`SELECT COUNT(*) AS count FROM v7_setting_item_versions WHERE book_id=? AND item_key='world-stage'`).get(firstBook)).toEqual({ count: 3 });
      const afterRevisionDepartment = await app.inject({ method: 'GET', url: `/api/v1/v7/books/${firstBook}/setting-department`, headers: { host: HEADERS.host, cookie } });
      expect(afterRevisionDepartment.statusCode).toBe(200);
      expect(afterRevisionDepartment.json().data.activeBatch.batchId).toBe(revisionBatchId);
      expect(afterRevisionDepartment.json().data.activeBatch.progress).toEqual({ completed: 1, total: 1, percent: 100 });

      const tooMany = await app.inject({ method: 'POST', url: `/api/v1/v7/books/${firstBook}/setting-items/world-stage/redesigns`, headers: { ...HEADERS, cookie }, payload: { memberKeys: ['planner-deepseek-v4-pro', 'planner-glm-5-3', 'planner-deepseek-v4-flash', 'planner-kimi-k3'], idempotencyKey: 'setting-redesign-too-many' } });
      expect(tooMany.statusCode).toBe(400);
      const redesigned = await app.inject({ method: 'POST', url: `/api/v1/v7/books/${firstBook}/setting-items/world-stage/redesigns`, headers: { ...HEADERS, cookie }, payload: { memberKeys: ['planner-deepseek-v4-pro', 'planner-glm-5-3', 'planner-kimi-k3'], authorNote: '增强历史质感，但保持大白话。', idempotencyKey: 'setting-redesign-0001' } });
      expect(redesigned.statusCode).toBe(200);
      const redesignTaskId = redesigned.json().data.taskId as string;
      expect(['queued', 'working']).toContain(redesigned.json().data.status);
      const currentRedesign = await app.inject({ method: 'GET', url: `/api/v1/v7/books/${firstBook}/setting-items/world-stage/redesigns/current`, headers: { host: HEADERS.host, cookie } });
      expect(currentRedesign.statusCode).toBe(200);
      expect(currentRedesign.json().data.taskId).toBe(redesignTaskId);
      const redesignedReady = await pollRedesign(app, cookie, firstBook, 'world-stage', redesignTaskId);
      expect(redesignedReady.status).toBe('ready');
      expect(redesignedReady.candidates).toHaveLength(3);
      const redesignCalls = (context.database.prepare(`SELECT COUNT(*) AS count FROM v7_setting_model_calls
        WHERE book_id=? AND batch_id=?`).get(firstBook, redesignTaskId) as { count: number }).count;
      const repeatedRedesign = await app.inject({ method: 'POST', url: `/api/v1/v7/books/${firstBook}/setting-items/world-stage/redesigns`, headers: { ...HEADERS, cookie }, payload: { memberKeys: ['planner-deepseek-v4-pro', 'planner-glm-5-3', 'planner-kimi-k3'], authorNote: '增强历史质感，但保持大白话。', idempotencyKey: 'setting-redesign-0001' } });
      expect(repeatedRedesign.statusCode).toBe(200);
      expect(repeatedRedesign.json().data).toMatchObject({ taskId: redesignTaskId, status: 'ready' });
      expect(context.database.prepare(`SELECT COUNT(*) AS count FROM v7_setting_model_calls
        WHERE book_id=? AND batch_id=?`).get(firstBook, redesignTaskId)).toEqual({ count: redesignCalls });
      const conflictingRedesign = await app.inject({ method: 'POST', url: `/api/v1/v7/books/${firstBook}/setting-items/world-stage/redesigns`, headers: { ...HEADERS, cookie }, payload: { memberKeys: ['planner-deepseek-v4-pro'], authorNote: '换了完整请求却复用了同一操作编号。', idempotencyKey: 'setting-redesign-0001' } });
      expect(conflictingRedesign.statusCode).toBe(409);
      const sourceBeforeRedesign = context.database.prepare(`SELECT o.request_id AS taskId
        FROM v7_setting_items i
        JOIN v7_setting_item_versions v ON v.version_id=i.active_version_id AND v.owner_id=i.owner_id AND v.book_id=i.book_id
        JOIN v7_setting_outputs o ON o.output_id=v.source_output_id AND o.owner_id=i.owner_id AND o.book_id=i.book_id
        WHERE i.book_id=? AND i.item_key='world-stage'`).get(firstBook) as { taskId: string };
      const redesignContracts = context.database.prepare(`SELECT operation_mode AS operationMode,
        based_on_task_id AS basedOnTaskId,author_instruction_version AS authorInstructionVersion
        FROM v7_task_contracts WHERE book_id=? AND task_id LIKE '%-redesign-%' ORDER BY task_id`).all(firstBook);
      expect(redesignContracts).toHaveLength(3);
      expect(redesignContracts).toEqual(redesignContracts.map(() => ({
        operationMode: 'revise', basedOnTaskId: sourceBeforeRedesign.taskId, authorInstructionVersion: null
      })));
      const fused = await app.inject({ method: 'POST', url: `/api/v1/v7/books/${firstBook}/setting-items/world-stage/fusions`, headers: { ...HEADERS, cookie }, payload: { outputIds: redesignedReady.candidates.map((candidate: { outputId: string }) => candidate.outputId), authorNote: '融合三份方案的优点。', idempotencyKey: 'setting-fusion-0001' } });
      expect(fused.statusCode).toBe(200);
      const fusionBatchId = fused.json().data.batchId as string;
      expect(['queued', 'working']).toContain(fused.json().data.status);
      const fusedReady = await pollBatch(app, cookie, firstBook, fusionBatchId);
      expect(fusedReady.status).toBe('awaiting_author');
      expect(fusedReady.items.find((item: { itemKey: string }) => item.itemKey === 'world-stage')?.content).toContain('东汉末年');
      const conflictingFusion = await app.inject({ method: 'POST', url: `/api/v1/v7/books/${firstBook}/setting-items/world-stage/fusions`, headers: { ...HEADERS, cookie }, payload: { outputIds: redesignedReady.candidates.slice(0, 2).map((candidate: { outputId: string }) => candidate.outputId), authorNote: '同一操作编号换了候选集。', idempotencyKey: 'setting-fusion-0001' } });
      expect(conflictingFusion.statusCode).toBe(409);

      const secondDepartment = await app.inject({ method: 'GET', url: `/api/v1/v7/books/${secondBook}/setting-department`, headers: { host: HEADERS.host, cookie } });
      expect(secondDepartment.statusCode).toBe(200);
      expect(secondDepartment.json().data.confirmedItems).toEqual([]);
      expect(secondDepartment.json().data.catalog.some((item: { key: string }) => item.key === 'civilization')).toBe(true);

      const crossOwner = await app.inject({ method: 'GET', url: `/api/v1/v7/books/${firstBook}/setting-department`, headers: { host: HEADERS.host, cookie: other } });
      expect(crossOwner.statusCode).toBe(404);
      expect(resolver.temperatures).not.toContain(0.16);
      expect(resolver.temperatures).toContain(0.62);
      expect(resolver.temperatures).toContain(0.25);
    } finally { await app.close(); }
  });

  it('重新设计全部已知失败时持久化终态，且可轮询并安全续跑', async () => {
    context = createTestContext('wenmi-v7-setting-redesign-terminal-');
    const resolver = new SettingResolver(false);
    const app = await createServer(context.config, context.database, { v7OpeningModelAdapters: resolver });
    try {
      const cookie = await register(app, 'setting-redesign-terminal@example.com', '重设计恢复作者', 'strong-pass-909');
      const bookId = await createBook(app, cookie, '重设计终态测试', 'setting-redesign-terminal-book', '历史脑洞');
      const owner = context.database.prepare('SELECT owner_id FROM books WHERE book_id=?').get(bookId) as { owner_id: string };
      const created = await app.inject({
        method: 'POST', url: `/api/v1/v7/books/${bookId}/setting-batches`, headers: { ...HEADERS, cookie },
        payload: { selectedItemKeys: ['world-stage'], customItems: [], authorNotes: {}, idempotencyKey: 'setting-redesign-seed-0001' }
      });
      const seed = await pollBatch(app, cookie, bookId, created.json().data.batchId as string);
      expect(seed.status).toBe('awaiting_author');

      resolver.failAllCalls = true;
      const failed = await app.inject({
        method: 'POST', url: `/api/v1/v7/books/${bookId}/setting-items/world-stage/redesigns`,
        headers: { ...HEADERS, cookie },
        payload: { memberKeys: ['planner-deepseek-v4-pro'], authorNote: '强化时代质感。', idempotencyKey: 'setting-redesign-terminal-0001' }
      });
      expect(failed.statusCode).toBe(200);
      const taskId = failed.json().data.taskId as string;
      const failedView = await pollRedesign(app, cookie, bookId, 'world-stage', taskId);
      expect(failedView).toMatchObject({ status: 'failed', retryable: true, failedMemberKeys: ['planner-deepseek-v4-pro'] });
      expect(context.database.prepare(`SELECT status,error_code,failure_stage,retry_safety FROM v7_setting_batches
        WHERE owner_id=? AND book_id=? AND idempotency_key='redesign-setting-redesign-terminal-0001'`).get(
        owner.owner_id, bookId
      )).toEqual({
        status: 'partially_failed',
        error_code: 'MODEL_REQUEST_REJECTED',
        failure_stage: 'in_dispatch',
        retry_safety: 'technical_retry'
      });
      expect(context.database.prepare(`SELECT COUNT(*) AS count FROM v7_setting_batches batch
        WHERE owner_id=? AND book_id=? AND status='working' AND NOT EXISTS (
          SELECT 1 FROM v7_setting_item_jobs job WHERE job.batch_id=batch.batch_id
      )`).get(owner.owner_id, bookId)).toEqual({ count: 0 });

      const current = await app.inject({
        method: 'GET', url: `/api/v1/v7/books/${bookId}/setting-items/world-stage/redesigns/current`,
        headers: { host: HEADERS.host, cookie }
      });
      expect(current.statusCode).toBe(200);
      expect(current.json().data).toMatchObject({ taskId, status: 'failed', retryable: true });

      resolver.failAllCalls = false;
      const recovered = await app.inject({
        method: 'POST', url: `/api/v1/v7/books/${bookId}/setting-items/world-stage/redesigns/${taskId}/retry`,
        headers: { ...HEADERS, cookie }, payload: {}
      });
      expect(recovered.statusCode, recovered.body).toBe(200);
      expect(['queued', 'working']).toContain(recovered.json().data.status);
      const recoveredView = await pollRedesign(app, cookie, bookId, 'world-stage', taskId);
      expect(recoveredView).toMatchObject({ status: 'ready', retryable: false, failedMemberKeys: [] });
      expect(recoveredView.candidates).toHaveLength(1);
      expect(context.database.prepare(`SELECT status FROM v7_setting_batches
        WHERE owner_id=? AND book_id=? AND idempotency_key='redesign-setting-redesign-terminal-0001'`).get(
        owner.owner_id, bookId
      )).toEqual({ status: 'awaiting_author' });
    } finally { await app.close(); }
  });

  it('重新设计部分失败时保留成功方案，单选复审和多选融合都能消费原任务', async () => {
    context = createTestContext('wenmi-v7-setting-redesign-partial-');
    const resolver = new SettingResolver(false);
    const app = await createServer(context.config, context.database, { v7OpeningModelAdapters: resolver });
    try {
      const cookie = await register(app, 'setting-redesign-partial@example.com', '部分方案作者', 'strong-pass-919');
      const bookId = await createBook(app, cookie, '部分方案恢复测试', 'setting-redesign-partial-book', '历史脑洞');
      const seedResponse = await app.inject({
        method: 'POST', url: `/api/v1/v7/books/${bookId}/setting-batches`, headers: { ...HEADERS, cookie },
        payload: { selectedItemKeys: ['world-stage'], customItems: [], authorNotes: {}, idempotencyKey: 'setting-redesign-partial-seed' }
      });
      expect(seedResponse.statusCode).toBe(200);
      expect((await pollBatch(app, cookie, bookId, seedResponse.json().data.batchId as string)).status).toBe('awaiting_author');

      resolver.failMemberKey = 'planner-kimi-k3';
      const firstRedesign = await app.inject({
        method: 'POST', url: `/api/v1/v7/books/${bookId}/setting-items/world-stage/redesigns`, headers: { ...HEADERS, cookie },
        payload: {
          memberKeys: ['planner-deepseek-v4-pro', 'planner-glm-5-3', 'planner-kimi-k3'],
          authorNote: '保留两份成功方案。', idempotencyKey: 'setting-redesign-partial-one'
        }
      });
      expect(firstRedesign.statusCode).toBe(200);
      const firstTaskId = firstRedesign.json().data.taskId as string;
      const firstPartial = await pollRedesign(app, cookie, bookId, 'world-stage', firstTaskId);
      expect(firstPartial).toMatchObject({ status: 'failed', retryable: true, failedMemberKeys: ['planner-kimi-k3'] });
      expect(firstPartial.candidates).toHaveLength(2);
      const firstFailedCalls = context.database.prepare(`SELECT COUNT(*) AS count FROM v7_setting_model_calls
        WHERE book_id=? AND batch_id=? AND member_key='planner-kimi-k3'`).get(bookId, firstTaskId);
      const chosen = firstPartial.candidates[0] as { outputId: string; proposal: { content: string } };
      const review = await app.inject({
        method: 'POST', url: `/api/v1/v7/books/${bookId}/setting-items/world-stage/review-tasks`, headers: { ...HEADERS, cookie },
        payload: {
          content: chosen.proposal.content, instruction: '采用这份成功方案并交主编复审。',
          sourceRedesignTaskId: firstTaskId, sourceOutputId: chosen.outputId,
          idempotencyKey: 'setting-redesign-partial-review'
        }
      });
      expect(review.statusCode, review.body).toBe(200);
      const reviewBatchId = review.json().data.batchId as string;
      expect((await pollBatch(app, cookie, bookId, reviewBatchId)).status).toBe('awaiting_author');
      expect(context.database.prepare('SELECT status FROM v7_setting_batches WHERE batch_id=?').get(firstTaskId))
        .toEqual({ status: 'completed' });
      expect(context.database.prepare(`SELECT COUNT(*) AS count FROM v7_setting_model_calls
        WHERE book_id=? AND batch_id=? AND member_key='planner-kimi-k3'`).get(bookId, firstTaskId)).toEqual(firstFailedCalls);

      const replay = await app.inject({
        method: 'POST', url: `/api/v1/v7/books/${bookId}/setting-items/world-stage/review-tasks`, headers: { ...HEADERS, cookie },
        payload: {
          content: chosen.proposal.content, instruction: '采用这份成功方案并交主编复审。',
          sourceRedesignTaskId: firstTaskId, sourceOutputId: chosen.outputId,
          idempotencyKey: 'setting-redesign-partial-review'
        }
      });
      expect(replay.statusCode, replay.body).toBe(200);
      expect(replay.json().data.batchId).toBe(reviewBatchId);

      const secondRedesign = await app.inject({
        method: 'POST', url: `/api/v1/v7/books/${bookId}/setting-items/world-stage/redesigns`, headers: { ...HEADERS, cookie },
        payload: {
          memberKeys: ['planner-deepseek-v4-pro', 'planner-glm-5-3', 'planner-kimi-k3'],
          authorNote: '融合两份成功方案。', idempotencyKey: 'setting-redesign-partial-two'
        }
      });
      expect(secondRedesign.statusCode).toBe(200);
      const secondTaskId = secondRedesign.json().data.taskId as string;
      const secondPartial = await pollRedesign(app, cookie, bookId, 'world-stage', secondTaskId);
      expect(secondPartial.status).toBe('failed');
      expect(secondPartial.candidates).toHaveLength(2);
      const secondFailedCalls = context.database.prepare(`SELECT COUNT(*) AS count FROM v7_setting_model_calls
        WHERE book_id=? AND batch_id=? AND member_key='planner-kimi-k3'`).get(bookId, secondTaskId);
      const fusion = await app.inject({
        method: 'POST', url: `/api/v1/v7/books/${bookId}/setting-items/world-stage/fusions`, headers: { ...HEADERS, cookie },
        payload: {
          outputIds: secondPartial.candidates.map((candidate: { outputId: string }) => candidate.outputId),
          authorNote: '融合两份成功方案。', idempotencyKey: 'setting-redesign-partial-fusion'
        }
      });
      expect(fusion.statusCode, fusion.body).toBe(200);
      expect((await pollBatch(app, cookie, bookId, fusion.json().data.batchId as string)).status).toBe('awaiting_author');
      expect(context.database.prepare('SELECT status FROM v7_setting_batches WHERE batch_id=?').get(secondTaskId))
        .toEqual({ status: 'completed' });
      expect(context.database.prepare(`SELECT COUNT(*) AS count FROM v7_setting_model_calls
        WHERE book_id=? AND batch_id=? AND member_key='planner-kimi-k3'`).get(bookId, secondTaskId)).toEqual(secondFailedCalls);
    } finally { await app.close(); }
  });

  it('五项同类设定拆为4加1，尾项不并回前批且接续前批草案', async () => {
    context = createTestContext('wenmi-v7-setting-grouped-');
    const resolver = new SettingResolver(false);
    const app = await createServer(context.config, context.database, { v7OpeningModelAdapters: resolver });
    try {
      const cookie = await register(app, 'setting-grouped@example.com', '分组设定作者', 'strong-pass-907');
      const bookId = await createBook(app, cookie, '分组设定测试', 'grouped-setting-book-0001', '历史脑洞');
      const created = await app.inject({
        method: 'POST', url: `/api/v1/v7/books/${bookId}/setting-batches`, headers: { ...HEADERS, cookie },
        payload: {
          selectedItemKeys: ['world-stage', 'geography', 'hazards', 'civilization', 'history'],
          customItems: [], authorNotes: {}, designMemberKey: 'planner-deepseek-v4-pro', idempotencyKey: 'setting-grouped-batch-0001'
        }
      });
      expect(created.statusCode, created.body).toBe(200);
      const batchId = created.json().data.batchId as string;
      const completed = await pollBatch(app, cookie, bookId, batchId);
      expect(completed.status).toBe('awaiting_author');
      expect(completed.progress).toEqual({ completed: 5, total: 5, percent: 100 });
      expect(completed.items.every((item: { state: string; content: string | null }) => (
        item.state === 'needs_author' && typeof item.content === 'string' && item.content.length > 20
      ))).toBe(true);
      expect(context.database.prepare(`SELECT COUNT(*) AS count FROM v7_setting_model_calls
        WHERE book_id=? AND batch_id=? AND node_key='writer_group' AND state='succeeded'`).get(bookId, batchId)).toEqual({ count: 2 });
      expect(context.database.prepare(`SELECT COUNT(*) AS count FROM v7_setting_model_calls
        WHERE book_id=? AND batch_id=? AND node_key IN ('chief','chief_repair')`).get(bookId, batchId)).toEqual({ count: 0 });
      const contexts = context.database.prepare(`SELECT DISTINCT context_hash AS contextHash,context_manifest_json AS manifest
        FROM v7_setting_item_jobs WHERE book_id=? AND batch_id=?`).all(bookId, batchId) as Array<{ contextHash: string; manifest: string }>;
      expect(contexts).toHaveLength(2);
      expect(contexts.map((context) => JSON.parse(context.manifest).itemKeys.length).sort()).toEqual([1, 4]);
      for (const context of contexts) {
        const manifest = JSON.parse(context.manifest) as { characterCount: number; budgetChars: number; itemKeys: string[] };
        expect(manifest.itemKeys.length).toBeLessThanOrEqual(4);
        expect(manifest.characterCount).toBeLessThanOrEqual(manifest.budgetChars);
        expect(manifest.budgetChars).toBe(12_000);
      }
    } finally { await app.close(); }
  });

  it('管理员可以让设定成员请假和返岗，但每个岗位至少保留一名在岗成员', async () => {
    context = createTestContext('wenmi-v7-setting-admin-');
    const app = await createServer(context.config, context.database, { v7OpeningModelAdapters: new SettingResolver(false) });
    try {
      const admin = await register(app, 'setting-admin@example.com', '管理员', 'strong-pass-789');
      context.database.prepare(`UPDATE user_accounts SET role='admin' WHERE email_normalized='setting-admin@example.com'`).run();
      const members = await app.inject({ method: 'GET', url: '/api/v1/admin/v7/setting-agent/members', headers: { host: HEADERS.host, cookie: admin } });
      expect(members.statusCode).toBe(200);
      // GLM is suspended after a real timeout probe; use an admitted member to verify leave/return.
      const writer = members.json().data.find((member: { memberKey: string }) => member.memberKey === 'planner-kimi-k3');
      const leave = await app.inject({ method: 'PATCH', url: '/api/v1/admin/v7/setting-agent/members/planner-kimi-k3', headers: { ...HEADERS, cookie: admin }, payload: { expectedRevision: writer.revision, enabled: false } });
      expect(leave.statusCode).toBe(200);
      expect(leave.json().data.enabled).toBe(false);
      const back = await app.inject({ method: 'PATCH', url: '/api/v1/admin/v7/setting-agent/members/planner-kimi-k3', headers: { ...HEADERS, cookie: admin }, payload: { expectedRevision: leave.json().data.revision, enabled: true } });
      expect(back.statusCode).toBe(200);
      expect(back.json().data.enabled).toBe(true);
    } finally { await app.close(); }
  });

  it('全部条目完成后由主编执行一次可恢复的跨条目统一整理，而不是前端拼接提醒', async () => {
    context = createTestContext('wenmi-v7-setting-final-review-');
    const app = await createServer(context.config, context.database, { v7OpeningModelAdapters: new SettingResolver(false) });
    try {
      const cookie = await register(app, 'setting-final-review@example.com', '统一设定作者', 'strong-pass-901');
      const bookId = await createBook(app, cookie, '设定统一整理测试', 'final-review-book-0001', '历史脑洞');
      const created = await app.inject({
        method: 'POST', url: `/api/v1/v7/books/${bookId}/setting-batches`, headers: { ...HEADERS, cookie },
        payload: { selectedItemKeys: ['world-stage', 'history'], customItems: [], authorNotes: {}, idempotencyKey: 'final-review-items-0001' }
      });
      expect(created.statusCode).toBe(200);
      await pollBatch(app, cookie, bookId, created.json().data.batchId as string);

      const requested = await app.inject({
        method: 'POST', url: `/api/v1/v7/books/${bookId}/setting-final-reviews`, headers: { ...HEADERS, cookie },
        payload: { idempotencyKey: 'final-review-task-0001' }
      });
      expect(requested.statusCode, requested.body).toBe(200);
      const completed = await pollFinalReview(app, cookie, bookId);
      expect(completed.status).toBe('ready');
      expect(completed.result.summary).toContain('跨条目');
      expect(completed.result.unifiedDecisions).toHaveLength(1);
      expect(completed.result.patchedItemKeys).toEqual(['world-stage']);
      expect(context.database.prepare(`SELECT COUNT(*) AS count FROM v7_setting_model_calls
        WHERE book_id=? AND node_key='batch_final_review' AND state='succeeded'`).get(bookId)).toEqual({ count: 1 });
      const department = await app.inject({ method: 'GET', url: `/api/v1/v7/books/${bookId}/setting-department`, headers: { host: HEADERS.host, cookie } });
      expect(department.statusCode).toBe(200);
      expect(department.json().data.finalReview.taskId).toBe(completed.taskId);
      expect(department.json().data.finalReview.status).toBe('ready');
      const items=(department.json().data.confirmedItems as Array<{itemKey:string;revision:number;state:string}>)
        .filter(item=>item.state!=='confirmed').map(item=>({itemKey:item.itemKey,expectedRevision:item.revision}));
      const before=context.database.prepare('SELECT * FROM v7_setting_item_versions WHERE book_id=? ORDER BY version_id').all(bookId);
      const stale=await app.inject({method:'POST',url:`/api/v1/v7/books/${bookId}/setting-items/confirm-all`,headers:{...HEADERS,cookie},
        payload:{items:items.map((item,index)=>({...item,expectedRevision:item.expectedRevision+(index===items.length-1?1:0)}))}});
      expect(stale.statusCode).toBe(409);
      expect(context.database.prepare('SELECT * FROM v7_setting_item_versions WHERE book_id=? ORDER BY version_id').all(bookId)).toEqual(before);
      const confirmed=await app.inject({method:'POST',url:`/api/v1/v7/books/${bookId}/setting-items/confirm-all`,headers:{...HEADERS,cookie},payload:{items}});
      expect(confirmed.statusCode,confirmed.body).toBe(200);
      const ownerId = String((context.database.prepare('SELECT owner_id FROM books WHERE book_id=?')
        .get(bookId) as { owner_id: string }).owner_id);
      expect(() => new V7PlanningSourceCompiler(context!.database, new SequenceIds(), new FixedClock()).compile({
        ownerId,
        bookId,
        treeKind: 'book',
        scopeId: bookId,
        purpose: 'recipe_design'
      })).not.toThrow();
      const repeated = await app.inject({
        method: 'POST', url: `/api/v1/v7/books/${bookId}/setting-final-reviews`, headers: { ...HEADERS, cookie },
        payload: { idempotencyKey: 'final-review-task-0001' }
      });
      expect(repeated.statusCode, repeated.body).toBe(200);
      expect(repeated.json().data.taskId).toBe(completed.taskId);
      expect(context.database.prepare(`SELECT COUNT(*) AS count FROM v7_setting_model_calls
        WHERE book_id=? AND node_key='batch_final_review' AND state='succeeded'`).get(bookId)).toEqual({ count: 1 });
    } finally { await app.close(); }
  });

  it('统一整理期间作者确认了新版本时整批拒绝落地，不覆盖作者最新内容', async () => {
    context = createTestContext('wenmi-v7-setting-final-review-cas-');
    const resolver = new SettingResolver(false);
    let releaseReview!: () => void;
    resolver.finalReviewGate = new Promise<void>((resolve) => { releaseReview = resolve; });
    let notifyStarted!: () => void;
    const reviewStarted = new Promise<void>((resolve) => { notifyStarted = resolve; });
    resolver.finalReviewStarted = notifyStarted;
    const app = await createServer(context.config, context.database, { v7OpeningModelAdapters: resolver });
    try {
      const cookie = await register(app, 'setting-final-review-cas@example.com', '并发确认作者', 'strong-pass-920');
      const bookId = await createBook(app, cookie, '统一整理并发测试', 'final-review-cas-book', '历史脑洞');
      const seedResponse = await app.inject({
        method: 'POST', url: `/api/v1/v7/books/${bookId}/setting-batches`, headers: { ...HEADERS, cookie },
        payload: { selectedItemKeys: ['world-stage'], customItems: [], authorNotes: {}, idempotencyKey: 'final-review-cas-seed' }
      });
      const seed = await pollBatch(app, cookie, bookId, seedResponse.json().data.batchId as string);
      const world = seed.items.find((item: { itemKey: string }) => item.itemKey === 'world-stage') as { revision: number };
      const reviewResponse = await app.inject({
        method: 'POST', url: `/api/v1/v7/books/${bookId}/setting-final-reviews`, headers: { ...HEADERS, cookie },
        payload: { idempotencyKey: 'final-review-cas-task' }
      });
      expect(reviewResponse.statusCode).toBe(200);
      const taskId = reviewResponse.json().data.taskId as string;
      await reviewStarted;
      const confirmed = await app.inject({
        method: 'POST', url: `/api/v1/v7/books/${bookId}/setting-items/world-stage/confirm`, headers: { ...HEADERS, cookie },
        payload: { expectedRevision: world.revision }
      });
      expect(confirmed.statusCode, confirmed.body).toBe(200);
      releaseReview();
      await waitForStoredBatchStatus(context.database, taskId, 'partially_failed');

      expect(context.database.prepare(`SELECT status,error_code,failure_stage,retry_safety FROM v7_setting_batches
        WHERE batch_id=?`).get(taskId)).toEqual({
        status: 'partially_failed', error_code: 'BOOK_VERSION_CONFLICT',
        failure_stage: 'post_dispatch', retry_safety: 'manual_redesign'
      });
      expect(context.database.prepare(`SELECT COUNT(*) AS count FROM v7_setting_outputs WHERE batch_id=?`).get(taskId))
        .toEqual({ count: 0 });
      expect(context.database.prepare(`SELECT revision,state FROM v7_setting_items WHERE book_id=? AND item_key='world-stage'`).get(bookId))
        .toEqual({ revision: world.revision + 1, state: 'confirmed' });
    } finally { releaseReview?.(); await app.close(); }
  });

  it('统一整理本地提交失败时整批回滚，并复用已成功模型结果一次恢复', async () => {
    context = createTestContext('wenmi-v7-setting-final-review-atomic-');
    const resolver = new SettingResolver(false);
    resolver.finalReviewOutputOverride = JSON.stringify({
      verdict: 'pass', summary: '两项设定已经统一。', unifiedDecisions: [], conflicts: [],
      patches: [
        { itemKey: 'world-stage', finalContent: '统一后的世界舞台。', summary: '世界舞台已统一。', issues: [], suggestions: [] },
        { itemKey: 'history', finalContent: '统一后的历史基线。', summary: '历史基线已统一。', issues: [], suggestions: [] }
      ]
    });
    const app = await createServer(context.config, context.database, { v7OpeningModelAdapters: resolver });
    try {
      const cookie = await register(app, 'setting-final-review-atomic@example.com', '原子提交作者', 'strong-pass-921');
      const bookId = await createBook(app, cookie, '统一整理原子测试', 'final-review-atomic-book', '历史脑洞');
      const seedResponse = await app.inject({
        method: 'POST', url: `/api/v1/v7/books/${bookId}/setting-batches`, headers: { ...HEADERS, cookie },
        payload: {
          selectedItemKeys: ['world-stage', 'history'], customItems: [], authorNotes: {},
          idempotencyKey: 'final-review-atomic-seed'
        }
      });
      await pollBatch(app, cookie, bookId, seedResponse.json().data.batchId as string);
      context.database.exec(`CREATE TRIGGER fail_second_final_review_output
        BEFORE INSERT ON v7_setting_outputs
        WHEN NEW.item_key='history' AND NEW.kind='chief_review'
        BEGIN SELECT RAISE(ABORT,'simulated local commit failure'); END`);
      const reviewResponse = await app.inject({
        method: 'POST', url: `/api/v1/v7/books/${bookId}/setting-final-reviews`, headers: { ...HEADERS, cookie },
        payload: { idempotencyKey: 'final-review-atomic-task' }
      });
      expect(reviewResponse.statusCode).toBe(200);
      const taskId = reviewResponse.json().data.taskId as string;
      await waitForStoredBatchStatus(context.database, taskId, 'partially_failed');
      expect(context.database.prepare(`SELECT error_code,failure_stage,retry_safety FROM v7_setting_batches WHERE batch_id=?`).get(taskId))
        .toEqual({ error_code: 'OPERATION_INCOMPLETE', failure_stage: 'post_dispatch', retry_safety: 'technical_retry' });
      expect(context.database.prepare(`SELECT COUNT(*) AS count FROM v7_setting_outputs WHERE batch_id=?`).get(taskId))
        .toEqual({ count: 0 });
      expect(context.database.prepare(`SELECT COUNT(*) AS count FROM v7_setting_item_versions WHERE source_batch_id=?`).get(taskId))
        .toEqual({ count: 0 });
      expect(context.database.prepare(`SELECT COUNT(*) AS count FROM v7_setting_model_calls
        WHERE batch_id=? AND node_key='batch_final_review' AND state='succeeded'`).get(taskId)).toEqual({ count: 1 });

      context.database.exec('DROP TRIGGER fail_second_final_review_output');
      const retried = await app.inject({
        method: 'POST', url: `/api/v1/v7/books/${bookId}/setting-final-reviews/${taskId}/retry`,
        headers: { ...HEADERS, cookie }, payload: {}
      });
      expect(retried.statusCode, retried.body).toBe(200);
      const completed = await pollFinalReview(app, cookie, bookId);
      expect(completed.status).toBe('ready');
      expect(completed.result.patchedItemKeys).toEqual(['world-stage', 'history']);
      expect(context.database.prepare(`SELECT COUNT(*) AS count FROM v7_setting_item_versions WHERE source_batch_id=?`).get(taskId))
        .toEqual({ count: 2 });
      expect(context.database.prepare(`SELECT COUNT(*) AS count FROM v7_setting_model_calls
        WHERE batch_id=? AND node_key='batch_final_review' AND state='succeeded'`).get(taskId)).toEqual({ count: 1 });
    } finally {
      try { context.database.exec('DROP TRIGGER IF EXISTS fail_second_final_review_output'); } catch { /* 测试库关闭前尽力清理。 */ }
      await app.close();
    }
  });

  it('统一整理主输出结构损坏时只调用一次repair并完成原任务', async () => {
    context = createTestContext('wenmi-v7-setting-final-review-repair-');
    const resolver = new StructureRecoveryResolver();
    const app = await createServer(context.config, context.database, { v7OpeningModelAdapters: resolver });
    try {
      const cookie = await register(app, 'setting-final-review-repair@example.com', '总审修复作者', 'strong-pass-925');
      const bookId = await createBook(app, cookie, '统一整理结构修复', 'final-review-repair-book', '历史脑洞');
      const seed = await app.inject({
        method: 'POST', url: `/api/v1/v7/books/${bookId}/setting-batches`, headers: { ...HEADERS, cookie },
        payload: { selectedItemKeys: ['world-stage'], customItems: [], authorNotes: {}, idempotencyKey: 'final-review-repair-seed' }
      });
      expect((await pollBatch(app, cookie, bookId, seed.json().data.batchId as string)).status).toBe('awaiting_author');
      resolver.invalidFinalReviewMain = true;
      const requested = await app.inject({
        method: 'POST', url: `/api/v1/v7/books/${bookId}/setting-final-reviews`, headers: { ...HEADERS, cookie },
        payload: { idempotencyKey: 'final-review-repair-task' }
      });
      expect(requested.statusCode, requested.body).toBe(200);
      const taskId = requested.json().data.taskId as string;
      const completed = await pollFinalReview(app, cookie, bookId);
      expect(completed).toMatchObject({ taskId, status: 'ready', retryable: false });
      expect(resolver.finalReviewMainCalls).toBe(1);
      expect(resolver.finalReviewRepairCalls).toBe(1);
      const calls = context.database.prepare(`SELECT node_key,state FROM v7_setting_model_calls
        WHERE book_id=? AND batch_id=? AND node_key IN ('batch_final_review','batch_final_review_repair')
        ORDER BY request_id`).all(bookId, taskId);
      expect(calls).toHaveLength(2);
      expect(calls).toEqual(expect.arrayContaining([
        { node_key: 'batch_final_review', state: 'succeeded' },
        { node_key: 'batch_final_review_repair', state: 'succeeded' }
      ]));
    } finally { await app.close(); }
  });

  it('统一整理repair已知失败后沿用原任务续跑，且不重新调用已成功主输出', async () => {
    context = createTestContext('wenmi-v7-setting-final-review-repair-retry-');
    const resolver = new StructureRecoveryResolver();
    const app = await createServer(context.config, context.database, { v7OpeningModelAdapters: resolver });
    try {
      const cookie = await register(app, 'setting-final-review-repair-retry@example.com', '总审续修作者', 'strong-pass-926');
      const bookId = await createBook(app, cookie, '统一整理续修', 'final-review-repair-retry-book', '历史脑洞');
      const seed = await app.inject({
        method: 'POST', url: `/api/v1/v7/books/${bookId}/setting-batches`, headers: { ...HEADERS, cookie },
        payload: { selectedItemKeys: ['world-stage'], customItems: [], authorNotes: {}, idempotencyKey: 'final-review-repair-retry-seed' }
      });
      expect((await pollBatch(app, cookie, bookId, seed.json().data.batchId as string)).status).toBe('awaiting_author');
      resolver.invalidFinalReviewMain = true;
      resolver.failFinalReviewRepair = true;
      const requested = await app.inject({
        method: 'POST', url: `/api/v1/v7/books/${bookId}/setting-final-reviews`, headers: { ...HEADERS, cookie },
        payload: { idempotencyKey: 'final-review-repair-retry-task' }
      });
      const taskId = requested.json().data.taskId as string;
      const failed = await pollFinalReview(app, cookie, bookId);
      expect(failed).toMatchObject({ taskId, status: 'failed', retryable: true, restartable: false });
      expect(resolver.finalReviewMainCalls).toBe(3);
      expect(resolver.finalReviewRepairCalls).toBe(3);

      resolver.failFinalReviewRepair = false;
      const retried = await app.inject({
        method: 'POST', url: `/api/v1/v7/books/${bookId}/setting-final-reviews/${taskId}/retry`,
        headers: { ...HEADERS, cookie }, payload: {}
      });
      expect(retried.statusCode, retried.body).toBe(200);
      expect(retried.json().data.taskId).toBe(taskId);
      const completed = await pollFinalReview(app, cookie, bookId);
      expect(completed).toMatchObject({ taskId, status: 'ready', retryable: false });
      expect(resolver.finalReviewMainCalls).toBe(3);
      expect(resolver.finalReviewRepairCalls).toBe(4);
      expect(context.database.prepare(`SELECT COUNT(*) AS count FROM v7_setting_model_calls
        WHERE book_id=? AND batch_id=? AND node_key='batch_final_review'`).get(bookId, taskId)).toEqual({ count: 3 });
      const repairCalls = context.database.prepare(`SELECT state FROM v7_setting_model_calls
        WHERE book_id=? AND batch_id=? AND node_key='batch_final_review_repair' ORDER BY request_id`).all(bookId, taskId) as Array<{ state: string }>;
      expect(repairCalls).toHaveLength(4);
      expect(repairCalls.filter((call) => call.state === 'failed')).toHaveLength(3);
      expect(repairCalls.filter((call) => call.state === 'succeeded')).toHaveLength(1);
    } finally { await app.close(); }
  });

  it('统一整理会员额度前置失败不伪造成主编请假，补额度后沿用原任务完成', async () => {
    context = createTestContext('wenmi-v7-setting-final-review-quota-');
    const resolver = new SettingResolver(false);
    const app = await createServer(context.config, context.database, { v7OpeningModelAdapters: resolver });
    try {
      const administratorCookie = await register(app, 'setting-final-review-quota-admin@example.com', '总审额度管理员', 'strong-pass-927');
      const cookie = await register(app, 'setting-final-review-quota@example.com', '总审额度作者', 'strong-pass-928');
      const bookId = await createBook(app, cookie, '统一整理额度恢复', 'final-review-quota-book', '历史脑洞');
      const owner = context.database.prepare('SELECT owner_id FROM books WHERE book_id=?').get(bookId) as { owner_id: string };
      const seed = await app.inject({
        method: 'POST', url: `/api/v1/v7/books/${bookId}/setting-batches`, headers: { ...HEADERS, cookie },
        payload: { selectedItemKeys: ['world-stage'], customItems: [], authorNotes: {}, idempotencyKey: 'final-review-quota-seed' }
      });
      expect((await pollBatch(app, cookie, bookId, seed.json().data.batchId as string)).status).toBe('awaiting_author');
      context.database.prepare('UPDATE user_memberships SET token_quota=1 WHERE owner_id=?').run(owner.owner_id);
      const requested = await app.inject({
        method: 'POST', url: `/api/v1/v7/books/${bookId}/setting-final-reviews`, headers: { ...HEADERS, cookie },
        payload: { idempotencyKey: 'final-review-quota-task' }
      });
      expect(requested.statusCode, requested.body).toBe(200);
      const taskId = requested.json().data.taskId as string;
      const failed = await pollFinalReview(app, cookie, bookId);
      expect(failed).toMatchObject({ taskId, status: 'failed', retryable: true, restartable: false });
      expect(context.database.prepare(`SELECT error_code,failure_stage,retry_safety FROM v7_setting_batches
        WHERE owner_id=? AND book_id=? AND batch_id=?`).get(owner.owner_id, bookId, taskId)).toEqual({
        error_code: 'MEMBERSHIP_QUOTA_EXHAUSTED', failure_stage: 'pre_dispatch', retry_safety: 'safe_after_precondition'
      });
      expect(context.database.prepare(`SELECT COUNT(*) AS count FROM v7_setting_member_events
        WHERE owner_id=? AND book_id=? AND batch_id=? AND event_type IN ('leave','handoff')`).get(
        owner.owner_id, bookId, taskId
      )).toEqual({ count: 0 });
      const failedTasks = await app.inject({
        method: 'GET', url: '/api/v1/v7/setting-tasks?limit=50', headers: { host: HEADERS.host, cookie }
      });
      expect(failedTasks.statusCode, failedTasks.body).toBe(200);
      expect(failedTasks.json().data).toEqual([expect.objectContaining({
        taskId, bookId, bookTitle: '统一整理额度恢复', taskKind: 'batch_final_review',
        status: 'failed', retryable: true, restartable: false, progress: 100
      })]);
      expect(failedTasks.json().data[0]).not.toHaveProperty('errorCode');
      expect(failedTasks.json().data[0]).not.toHaveProperty('failureStage');
      const otherOwnerTasks = await app.inject({
        method: 'GET', url: '/api/v1/v7/setting-tasks?limit=50', headers: { host: HEADERS.host, cookie: administratorCookie }
      });
      expect(otherOwnerTasks.statusCode).toBe(200);
      expect(otherOwnerTasks.json().data).toEqual([]);

      context.database.prepare('UPDATE user_memberships SET token_quota=500000 WHERE owner_id=?').run(owner.owner_id);
      const retried = await app.inject({
        method: 'POST', url: `/api/v1/v7/books/${bookId}/setting-final-reviews/${taskId}/retry`,
        headers: { ...HEADERS, cookie }, payload: {}
      });
      expect(retried.statusCode, retried.body).toBe(200);
      expect(retried.json().data.taskId).toBe(taskId);
      expect((await pollFinalReview(app, cookie, bookId)).status).toBe('ready');
      const waitingTasks = await app.inject({
        method: 'GET', url: '/api/v1/v7/setting-tasks?limit=50', headers: { host: HEADERS.host, cookie }
      });
      expect(waitingTasks.json().data).toEqual([expect.objectContaining({ taskId, status: 'waiting_for_you' })]);
      const department = await app.inject({
        method: 'GET', url: `/api/v1/v7/books/${bookId}/setting-department`, headers: { host: HEADERS.host, cookie }
      });
      for (const item of department.json().data.confirmedItems as Array<{ itemKey: string; revision: number }>) {
        const confirmed = await app.inject({
          method: 'POST', url: `/api/v1/v7/books/${bookId}/setting-items/${item.itemKey}/confirm`,
          headers: { ...HEADERS, cookie }, payload: { expectedRevision: item.revision }
        });
        expect(confirmed.statusCode, confirmed.body).toBe(200);
      }
      const completedTasks = await app.inject({
        method: 'GET', url: '/api/v1/v7/setting-tasks?limit=50', headers: { host: HEADERS.host, cookie }
      });
      expect(completedTasks.json().data).toEqual([expect.objectContaining({
        taskId, status: 'completed', statusText: '统一整理已经完成，当前设定已经安全保存。'
      })]);
      expect(context.database.prepare(`SELECT error_code,failure_stage,retry_safety FROM v7_setting_batches
        WHERE owner_id=? AND book_id=? AND batch_id=?`).get(owner.owner_id, bookId, taskId)).toEqual({
        error_code: null, failure_stage: null, retry_safety: null
      });
      expect(context.database.prepare(`SELECT COUNT(*) AS count FROM v7_setting_member_events
        WHERE owner_id=? AND book_id=? AND batch_id=? AND event_type IN ('leave','handoff')`).get(
        owner.owner_id, bookId, taskId
      )).toEqual({ count: 0 });
    } finally { await app.close(); }
  });

  it('25项长设定的全书总审只读取分层语义索引，不把全部原文重新塞给主编', async () => {
    context = createTestContext('wenmi-v7-setting-final-review-layered-');
    const resolver = new SettingResolver(false);
    const app = await createServer(context.config, context.database, { v7OpeningModelAdapters: resolver });
    try {
      const cookie = await register(app, 'setting-layered-review@example.com', '分层总审作者', 'strong-pass-908');
      const bookId = await createBook(app, cookie, '大量设定总审测试', 'layered-final-review-book-0001', '历史脑洞');
      const ownerId = String((context.database.prepare('SELECT owner_id FROM books WHERE book_id=?')
        .get(bookId) as { owner_id: string }).owner_id);
      for (let index = 1; index <= 25; index += 1) {
        const itemKey = `layered-setting-${index}`;
        const versionId = `layered-setting-version-${index}`;
        context.database.prepare(`INSERT INTO v7_setting_item_versions
          (version_id,owner_id,book_id,item_key,revision,status,content_json,created_by,created_at)
          VALUES (?,?,?,?,1,'confirmed',?,'author','2026-01-01T00:00:00.000Z')`).run(
          versionId,
          ownerId,
          bookId,
          itemKey,
          JSON.stringify({
            finalContent: `原文标记${index}：`.padEnd(720, '详'),
            contextSummary: `第${index}项设定锁定人物身份、时代边界和行动规则。`,
            factEntries: [`第${index}项的身份与规则已经确认。`]
          })
        );
        context.database.prepare(`INSERT INTO v7_setting_items
          (owner_id,book_id,item_key,item_label,group_title,item_prompt,state,active_version_id,revision,updated_at)
          VALUES (?,?,?,?,?,'完成当前设定','confirmed',?,1,'2026-01-01T00:00:00.000Z')`).run(
          ownerId, bookId, itemKey, `长设定${index}`, `分组${Math.ceil(index / 5)}`, versionId
        );
      }
      const requested = await app.inject({
        method: 'POST', url: `/api/v1/v7/books/${bookId}/setting-final-reviews`, headers: { ...HEADERS, cookie },
        payload: { idempotencyKey: 'layered-final-review-task-0001' }
      });
      expect(requested.statusCode, requested.body).toBe(200);
      const completed = await pollFinalReview(app, cookie, bookId);
      expect(completed).toMatchObject({ status: 'ready', result: { verdict: 'pass' } });
      expect(completed.result.factLedger).toHaveLength(25);
      const reviewPrompt = resolver.prompts.map(settingStagePrompt)
        .find((prompt) => prompt.includes('v7_setting_batch_final_review_v1'))!;
      expect(reviewPrompt).toContain('layered_semantic_index');
      expect(reviewPrompt).not.toContain('原文标记1');
      expect(JSON.parse(reviewPrompt).currentSettingCandidates.every((item:{authority:string})=>item.authority==='confirmed')).toBe(true);
      expect(Array.from(reviewPrompt).length).toBeLessThanOrEqual(12_000);
      expect(context.database.prepare(`SELECT COUNT(*) AS count FROM v7_setting_model_calls
        WHERE book_id=? AND node_key='batch_final_review' AND state='succeeded'`).get(bookId)).toEqual({ count: 1 });
    } finally { await app.close(); }
  });

  it('语义索引仍超限时总审自动降到限长一句话索引，全部条目仍被逐一核对', async () => {
    context = createTestContext('wenmi-v7-setting-final-review-minimal-');
    const resolver = new SettingResolver(false);
    const app = await createServer(context.config, context.database, { v7OpeningModelAdapters: resolver });
    try {
      const cookie = await register(app, 'setting-minimal-review@example.com', '最小索引作者', 'strong-pass-910');
      const bookId = await createBook(app, cookie, '超大设定总审测试', 'minimal-final-review-book-0001', '历史脑洞');
      const ownerId = String((context.database.prepare('SELECT owner_id FROM books WHERE book_id=?')
        .get(bookId) as { owner_id: string }).owner_id);
      for (let index = 1; index <= 45; index += 1) {
        const itemKey = `minimal-setting-${index}`;
        const versionId = `minimal-setting-version-${index}`;
        context.database.prepare(`INSERT INTO v7_setting_item_versions
          (version_id,owner_id,book_id,item_key,revision,status,content_json,created_by,created_at)
          VALUES (?,?,?,?,1,'confirmed',?,'author','2026-01-01T00:00:00.000Z')`).run(
          versionId,
          ownerId,
          bookId,
          itemKey,
          JSON.stringify({
            finalContent: `原文标记${index}：`.padEnd(720, '详'),
            contextSummary: `第${index}项设定锁定人物身份、时代边界和行动规则。${'冗'.repeat(180)}`,
            factEntries: [`第${index}项的身份与规则已经确认。`]
          })
        );
        context.database.prepare(`INSERT INTO v7_setting_items
          (owner_id,book_id,item_key,item_label,group_title,item_prompt,state,active_version_id,revision,updated_at)
          VALUES (?,?,?,?,?,'完成当前设定','confirmed',?,1,'2026-01-01T00:00:00.000Z')`).run(
          ownerId, bookId, itemKey, `长设定${index}`, `分组${Math.ceil(index / 5)}`, versionId
        );
      }
      const requested = await app.inject({
        method: 'POST', url: `/api/v1/v7/books/${bookId}/setting-final-reviews`, headers: { ...HEADERS, cookie },
        payload: { idempotencyKey: 'minimal-final-review-task-0001' }
      });
      expect(requested.statusCode, requested.body).toBe(200);
      const completed = await pollFinalReview(app, cookie, bookId);
      expect(completed).toMatchObject({ status: 'ready', result: { verdict: 'pass' } });
      expect(completed.result.factLedger).toHaveLength(45);
      const reviewPrompt = resolver.prompts.map(settingStagePrompt)
        .find((prompt) => prompt.includes('v7_setting_batch_final_review_v1'))!;
      expect(reviewPrompt).toContain('layered_semantic_index');
      expect(reviewPrompt).toContain('一句话索引');
      expect(reviewPrompt).not.toContain('冗'.repeat(60));
      expect(JSON.parse(reviewPrompt).currentSettingCandidates.every((item:{authority:string})=>item.authority==='confirmed')).toBe(true);
      expect(Array.from(reviewPrompt).length).toBeLessThanOrEqual(12_000);
      expect(context.database.prepare(`SELECT COUNT(*) AS count FROM v7_setting_model_calls
        WHERE book_id=? AND node_key='batch_final_review' AND state='succeeded'`).get(bookId)).toEqual({ count: 1 });
    } finally { await app.close(); }
  });

  it('轻量总审发现跨条目冲突后分小包真正改回正文，而不是只在页面口头宣布统一', async () => {
    context = createTestContext('wenmi-v7-setting-final-review-patches-');
    const resolver = new SettingResolver(false);
    const app = await createServer(context.config, context.database, { v7OpeningModelAdapters: resolver });
    try {
      const cookie = await register(app, 'setting-patch-review@example.com', '冲突修订作者', 'strong-pass-909');
      const bookId = await createBook(app, cookie, '冲突设定总审测试', 'patch-final-review-book-0001', '历史脑洞');
      const ownerId = String((context.database.prepare('SELECT owner_id FROM books WHERE book_id=?')
        .get(bookId) as { owner_id: string }).owner_id);
      const oldNames = ['大靖', '大朔', '大宁', '大靖', '大朔', '大宁'];
      for (let index = 0; index < oldNames.length; index += 1) {
        const itemKey = `conflict-setting-${index + 1}`;
        const versionId = `conflict-setting-version-${index + 1}`;
        context.database.prepare(`INSERT INTO v7_setting_item_versions
          (version_id,owner_id,book_id,item_key,revision,status,content_json,created_by,created_at)
          VALUES (?,?,?,?,1,'confirmed',?,'author','2026-01-01T00:00:00.000Z')`).run(
          versionId,
          ownerId,
          bookId,
          itemKey,
          JSON.stringify({
            finalContent: `${oldNames[index]}的具体制度、交通和资源规则：`.padEnd(1_850, String(index + 1)),
            contextSummary: `冲突长设定${index + 1}当前使用${oldNames[index]}，规则必须保留。`,
            factEntries: [`冲突长设定${index + 1}当前使用${oldNames[index]}。`]
          })
        );
        context.database.prepare(`INSERT INTO v7_setting_items
          (owner_id,book_id,item_key,item_label,group_title,item_prompt,state,active_version_id,revision,updated_at)
          VALUES (?,?,?,?,?,'完成当前设定','confirmed',?,1,'2026-01-01T00:00:00.000Z')`).run(
          ownerId, bookId, itemKey, `冲突长设定${index + 1}`, '冲突分组', versionId
        );
      }
      const requested = await app.inject({
        method: 'POST', url: `/api/v1/v7/books/${bookId}/setting-final-reviews`, headers: { ...HEADERS, cookie },
        payload: { idempotencyKey: 'patch-final-review-task-0001' }
      });
      expect(requested.statusCode, requested.body).toBe(200);
      const completed = await pollFinalReview(app, cookie, bookId);
      expect(completed.status).toBe('ready');
      expect(completed.result.patchedItemKeys).toHaveLength(oldNames.length);
      const current = context.database.prepare(`SELECT v.content_json FROM v7_setting_items i
        JOIN v7_setting_item_versions v ON v.version_id=i.active_version_id
        WHERE i.owner_id=? AND i.book_id=? ORDER BY i.item_key`).all(ownerId, bookId) as Array<{ content_json: string }>;
      expect(current).toHaveLength(oldNames.length);
      for (const row of current) {
        const content = JSON.parse(row.content_json) as { finalContent: string };
        expect(content.finalContent).toContain('景朝');
        expect(content.finalContent).not.toMatch(/大靖|大朔|大宁/u);
      }
      const reviewPrompt = resolver.prompts.map(settingStagePrompt)
        .find((prompt) => prompt.includes('v7_setting_batch_final_review_v1'))!;
      expect(reviewPrompt).toContain('layered_semantic_index');
      const patchPrompts = resolver.prompts.map(settingStagePrompt)
        .filter((prompt) => prompt.includes('v7_setting_batch_final_review_patch_v1'));
      expect(patchPrompts.length).toBeGreaterThan(1);
      expect(patchPrompts.every((prompt) => Array.from(prompt).length <= 12_000)).toBe(true);
      expect(context.database.prepare(`SELECT COUNT(*) AS count FROM v7_setting_model_calls
        WHERE book_id=? AND node_key='batch_final_review_patch' AND state='succeeded'`).get(bookId)).toEqual({ count: patchPrompts.length });
    } finally { await app.close(); }
  });

  it('补充设计只为新增条目建工单，已有结果只作为资料且不会重做', async () => {
    context = createTestContext('wenmi-v7-setting-incremental-');
    const app = await createServer(context.config, context.database, { v7OpeningModelAdapters: new SettingResolver(false) });
    try {
      const cookie = await register(app, 'setting-incremental@example.com', '补充设定作者', 'strong-pass-902');
      const bookId = await createBook(app, cookie, '增量设定测试', 'incremental-book-0001', '历史脑洞');
      const first = await app.inject({
        method: 'POST', url: `/api/v1/v7/books/${bookId}/setting-batches`, headers: { ...HEADERS, cookie },
        payload: { selectedItemKeys: ['world-stage'], customItems: [], authorNotes: {}, idempotencyKey: 'incremental-first-0001' }
      });
      expect(first.statusCode).toBe(200);
      await pollBatch(app, cookie, bookId, first.json().data.batchId as string);
      const oldVersionCount = context.database.prepare(`SELECT COUNT(*) AS count FROM v7_setting_item_versions WHERE book_id=? AND item_key='world-stage'`).get(bookId);

      const supplement = await app.inject({
        method: 'POST', url: `/api/v1/v7/books/${bookId}/setting-batches`, headers: { ...HEADERS, cookie },
        payload: { selectedItemKeys: ['world-stage', 'history'], customItems: [], authorNotes: {}, idempotencyKey: 'incremental-second-0001' }
      });
      expect(supplement.statusCode).toBe(200);
      const completed = await pollBatch(app, cookie, bookId, supplement.json().data.batchId as string);
      expect(completed.progress).toEqual({ completed: 1, total: 1, percent: 100 });
      expect(completed.items.map((item: { itemKey: string }) => item.itemKey)).toEqual(['history']);
      expect(context.database.prepare(`SELECT COUNT(*) AS count FROM v7_setting_item_jobs WHERE book_id=? AND batch_id=?`).get(bookId, completed.batchId)).toEqual({ count: 1 });
      expect(context.database.prepare(`SELECT COUNT(*) AS count FROM v7_setting_item_versions WHERE book_id=? AND item_key='world-stage'`).get(bookId)).toEqual(oldVersionCount);

      const repeated = await app.inject({
        method: 'POST', url: `/api/v1/v7/books/${bookId}/setting-batches`, headers: { ...HEADERS, cookie },
        payload: { selectedItemKeys: ['world-stage', 'history'], customItems: [], authorNotes: {}, idempotencyKey: 'incremental-second-0001' }
      });
      expect(repeated.statusCode).toBe(200);
      expect(repeated.json().data.batchId).toBe(completed.batchId);
    } finally { await app.close(); }
  });

  it('不同操作编号不能为同一本书的同一设定同时创建在途工单', async () => {
    context = createTestContext('wenmi-v7-setting-active-item-guard-');
    const resolver = new BlockingSettingResolver();
    const app = await createServer(context.config, context.database, { v7OpeningModelAdapters: resolver });
    try {
      const cookie = await register(app, 'setting-active-item@example.com', '并发工单作者', 'strong-pass-910');
      const bookId = await createBook(app, cookie, '同条目并发测试', 'setting-active-item-book', '历史脑洞');
      const first = await app.inject({
        method: 'POST', url: `/api/v1/v7/books/${bookId}/setting-batches`, headers: { ...HEADERS, cookie },
        payload: { selectedItemKeys: ['world-stage'], customItems: [], authorNotes: {}, idempotencyKey: 'setting-active-item-first' }
      });
      expect(first.statusCode, first.body).toBe(200);
      const firstBatchId = first.json().data.batchId as string;
      await resolver.waitUntilWriterStarted();

      const competing = await app.inject({
        method: 'POST', url: `/api/v1/v7/books/${bookId}/setting-batches`, headers: { ...HEADERS, cookie },
        payload: { selectedItemKeys: ['world-stage'], customItems: [], authorNotes: {}, idempotencyKey: 'setting-active-item-second' }
      });
      expect(competing.statusCode, competing.body).toBe(409);
      expect(competing.body).toContain('TASK_ALREADY_RUNNING');
      expect(context.database.prepare(`SELECT COUNT(*) AS count FROM v7_setting_item_jobs
        WHERE book_id=? AND item_key='world-stage'`).get(bookId)).toEqual({ count: 1 });
      expect(context.database.prepare(`SELECT COUNT(*) AS count FROM v7_setting_batches
        WHERE book_id=? AND idempotency_key='setting-active-item-second'`).get(bookId)).toEqual({ count: 0 });

      resolver.releaseWriter();
      expect((await pollBatch(app, cookie, bookId, firstBatchId)).status).toBe('awaiting_author');
    } finally {
      resolver.releaseWriter();
      await app.close();
    }
  });

  it('旧执行器失去租约后只保留模型审计，不得覆盖新执行器已经确认的终态', async () => {
    context = createTestContext('wenmi-v7-setting-lease-fence-');
    const resolver = new BlockingSettingResolver();
    const app = await createServer(context.config, context.database, { v7OpeningModelAdapters: resolver });
    try {
      const cookie = await register(app, 'setting-lease-fence@example.com', '租约保护作者', 'strong-pass-925');
      const bookId = await createBook(app, cookie, '设定租约保护测试', 'setting-lease-fence-book', '历史脑洞');
      const owner = context.database.prepare('SELECT owner_id FROM books WHERE book_id=?').get(bookId) as { owner_id: string };
      const created = await app.inject({
        method: 'POST', url: `/api/v1/v7/books/${bookId}/setting-batches`, headers: { ...HEADERS, cookie },
        payload: {
          selectedItemKeys: ['game-entry', 'formula'], customItems: [], authorNotes: {},
          idempotencyKey: 'setting-lease-fence-batch'
        }
      });
      expect(created.statusCode, created.body).toBe(200);
      const batchId = created.json().data.batchId as string;
      await resolver.waitUntilWriterStarted();

      const settledAt = '2026-09-01T05:00:00.000Z';
      context.database.prepare(`UPDATE v7_setting_batches
        SET status='completed',lease_token='replacement-worker',lease_expires_at='2099-01-01T00:00:00.000Z',updated_at=?
        WHERE owner_id=? AND book_id=? AND batch_id=?`).run(settledAt, owner.owner_id, bookId, batchId);
      context.database.prepare(`UPDATE v7_setting_item_jobs
        SET state='confirmed',revision=7,active_output_id=NULL,updated_at=?
        WHERE owner_id=? AND book_id=? AND batch_id=?`).run(settledAt, owner.owner_id, bookId, batchId);
      const terminalBatch = context.database.prepare(`SELECT status,lease_token,lease_expires_at,updated_at
        FROM v7_setting_batches WHERE owner_id=? AND book_id=? AND batch_id=?`).get(owner.owner_id, bookId, batchId);
      const terminalJobs = context.database.prepare(`SELECT job_id,item_key,state,revision,active_output_id,updated_at
        FROM v7_setting_item_jobs WHERE owner_id=? AND book_id=? AND batch_id=? ORDER BY item_key`).all(
        owner.owner_id, bookId, batchId
      );
      const eventCount = context.database.prepare(`SELECT COUNT(*) AS count FROM v7_setting_member_events
        WHERE owner_id=? AND book_id=? AND batch_id=?`).get(owner.owner_id, bookId, batchId);
      const outputCheckpoint = context.database.prepare(`SELECT output_id,content_json FROM v7_setting_outputs
        WHERE owner_id=? AND book_id=? AND batch_id=? ORDER BY output_id`).all(owner.owner_id, bookId, batchId);
      const versionCheckpoint = context.database.prepare(`SELECT * FROM v7_setting_item_versions
        WHERE owner_id=? AND book_id=? AND source_batch_id=? ORDER BY version_id`).all(owner.owner_id, bookId, batchId);

      resolver.releaseWriter();
      for (let index = 0; index < 120; index += 1) {
        const stored = context.database.prepare(`SELECT state FROM v7_setting_model_calls
          WHERE owner_id=? AND book_id=? AND batch_id=? AND node_key='writer_group'
          ORDER BY started_at DESC LIMIT 1`).get(owner.owner_id, bookId, batchId) as { state: string } | undefined;
        if (stored?.state === 'succeeded') break;
        await new Promise((resolve) => setTimeout(resolve, 5));
      }
      await new Promise((resolve) => setTimeout(resolve, 10));
      expect(context.database.prepare(`SELECT state FROM v7_setting_model_calls
        WHERE owner_id=? AND book_id=? AND batch_id=? AND node_key='writer_group'
        ORDER BY started_at DESC LIMIT 1`).get(owner.owner_id, bookId, batchId)).toEqual({ state: 'succeeded' });

      expect(context.database.prepare(`SELECT status,lease_token,lease_expires_at,updated_at
        FROM v7_setting_batches WHERE owner_id=? AND book_id=? AND batch_id=?`).get(
        owner.owner_id, bookId, batchId
      )).toEqual(terminalBatch);
      expect(context.database.prepare(`SELECT job_id,item_key,state,revision,active_output_id,updated_at
        FROM v7_setting_item_jobs WHERE owner_id=? AND book_id=? AND batch_id=? ORDER BY item_key`).all(
        owner.owner_id, bookId, batchId
      )).toEqual(terminalJobs);
      expect(context.database.prepare(`SELECT output_id,content_json FROM v7_setting_outputs
        WHERE owner_id=? AND book_id=? AND batch_id=? ORDER BY output_id`).all(owner.owner_id, bookId, batchId)).toEqual(outputCheckpoint);
      expect(context.database.prepare(`SELECT * FROM v7_setting_item_versions
        WHERE owner_id=? AND book_id=? AND source_batch_id=? ORDER BY version_id`).all(owner.owner_id, bookId, batchId)).toEqual(versionCheckpoint);
      expect(context.database.prepare(`SELECT COUNT(*) AS count FROM v7_setting_member_events
        WHERE owner_id=? AND book_id=? AND batch_id=?`).get(owner.owner_id, bookId, batchId)).toEqual(eventCount);
    } finally {
      resolver.releaseWriter();
      await app.close();
    }
  });

  it('普通设定任务冻结创建时的不存在状态，执行期间形成的作者版本不会被晚到结果覆盖', async () => {
    context = createTestContext('wenmi-v7-setting-source-cas-');
    const resolver = new BlockingSettingResolver();
    const app = await createServer(context.config, context.database, { v7OpeningModelAdapters: resolver });
    try {
      const cookie = await register(app, 'setting-source-cas@example.com', '版本保护作者', 'strong-pass-911');
      const bookId = await createBook(app, cookie, '设定版本保护测试', 'setting-source-cas-book', '历史脑洞');
      const owner = context.database.prepare('SELECT owner_id FROM books WHERE book_id=?').get(bookId) as { owner_id: string };
      const created = await app.inject({
        method: 'POST', url: `/api/v1/v7/books/${bookId}/setting-batches`, headers: { ...HEADERS, cookie },
        payload: { selectedItemKeys: ['world-stage'], customItems: [], authorNotes: {}, idempotencyKey: 'setting-source-cas-task' }
      });
      expect(created.statusCode, created.body).toBe(200);
      const batchId = created.json().data.batchId as string;
      await resolver.waitUntilWriterStarted();
      const frozen = context.database.prepare(`SELECT context_manifest_json AS manifestJson FROM v7_setting_item_jobs
        WHERE owner_id=? AND book_id=? AND batch_id=? AND item_key='world-stage'`).get(
        owner.owner_id, bookId, batchId
      ) as { manifestJson: string };
      expect(JSON.parse(frozen.manifestJson)).toMatchObject({ sourceItemRevision: null });

      const authorVersionId = 'author-confirmed-during-setting-task';
      const authorContent = {
        verdict: 'pass',
        finalContent: '这是任务执行期间由作者确认的新世界设定，晚到的模型结果不得覆盖。',
        summary: '作者确认版本',
        issues: [],
        suggestions: []
      };
      context.database.prepare(`INSERT INTO v7_setting_item_versions
        (version_id,owner_id,book_id,item_key,revision,status,content_json,source_output_id,source_batch_id,created_by,created_at)
        VALUES (?,?,?,?,1,'confirmed',?,NULL,NULL,'author','2026-09-01T00:00:00.000Z')`).run(
        authorVersionId, owner.owner_id, bookId, 'world-stage', JSON.stringify(authorContent)
      );
      context.database.prepare(`INSERT INTO v7_setting_items
        (owner_id,book_id,item_key,item_label,group_title,item_prompt,state,active_version_id,revision,updated_at)
        VALUES (?,?,?,'世界与时代舞台','世界底座','建立世界舞台','confirmed',?,1,'2026-09-01T00:00:00.000Z')`).run(
        owner.owner_id, bookId, 'world-stage', authorVersionId
      );

      resolver.releaseWriter();
      const failed = await pollBatch(app, cookie, bookId, batchId);
      expect(failed.status).toBe('partially_failed');
      expect(context.database.prepare(`SELECT active_version_id AS activeVersionId,revision,state FROM v7_setting_items
        WHERE owner_id=? AND book_id=? AND item_key='world-stage'`).get(owner.owner_id, bookId)).toEqual({
        activeVersionId: authorVersionId,
        revision: 1,
        state: 'confirmed'
      });
      expect(context.database.prepare(`SELECT COUNT(*) AS count FROM v7_setting_item_versions
        WHERE owner_id=? AND book_id=? AND item_key='world-stage' AND source_batch_id=?`).get(
        owner.owner_id, bookId, batchId
      )).toEqual({ count: 0 });
      expect(context.database.prepare(`SELECT node_key AS nodeKey,COUNT(*) AS count FROM v7_setting_model_calls
        WHERE owner_id=? AND book_id=? AND batch_id=? AND node_key IN ('writer','chief')
        GROUP BY node_key ORDER BY node_key`).all(owner.owner_id, bookId, batchId)).toEqual([
        { nodeKey: 'chief', count: 1 },
        { nodeKey: 'writer', count: 1 }
      ]);
      expect(JSON.parse((context.database.prepare(`SELECT content_json AS contentJson FROM v7_setting_item_versions
        WHERE owner_id=? AND book_id=? AND version_id=?`).get(
        owner.owner_id, bookId, authorVersionId
      ) as { contentJson: string }).contentJson)).toEqual(authorContent);
    } finally {
      resolver.releaseWriter();
      await app.close();
    }
  });

  it('主编提醒和作者修改会创建可恢复的单条复审任务，不沿用旧审查', async () => {
    context = createTestContext('wenmi-v7-setting-review-task-');
    const resolver = new SettingResolver(false);
    const app = await createServer(context.config, context.database, { v7OpeningModelAdapters: resolver });
    try {
      const cookie = await register(app, 'setting-review-task@example.com', '复审任务作者', 'strong-pass-903');
      const bookId = await createBook(app, cookie, '设定复审任务测试', 'review-task-book-0001', '历史脑洞');
      const initial = await app.inject({
        method: 'POST', url: `/api/v1/v7/books/${bookId}/setting-batches`, headers: { ...HEADERS, cookie },
        payload: { selectedItemKeys: ['world-stage'], customItems: [], authorNotes: {}, idempotencyKey: 'review-task-initial-0001' }
      });
      expect(initial.statusCode).toBe(200);
      await pollBatch(app, cookie, bookId, initial.json().data.batchId as string);
      const versionsBefore = context.database.prepare(`SELECT COUNT(*) AS count FROM v7_setting_item_versions WHERE book_id=? AND item_key='world-stage'`).get(bookId);
      const sourceBeforeReviewTask = context.database.prepare(`SELECT o.request_id AS taskId
        FROM v7_setting_items i
        JOIN v7_setting_item_versions v ON v.version_id=i.active_version_id AND v.owner_id=i.owner_id AND v.book_id=i.book_id
        JOIN v7_setting_outputs o ON o.output_id=v.source_output_id AND o.owner_id=i.owner_id AND o.book_id=i.book_id
        WHERE i.book_id=? AND i.item_key='world-stage'`).get(bookId) as { taskId: string };

      const longAuthorDetail = '边城人口、驻军、粮道、存粮和驿传速度均按同一口径执行，不得恢复旧数值。'.repeat(24);
      const payload = {
        content: `作者修改后的世界舞台：东汉末年交通困难，主角必须依靠真实粮道推进计划。${longAuthorDetail}`,
        instruction: '只修正主编提醒的年代问题，其他内容保持不变。',
        idempotencyKey: 'setting-review-task-0001'
      };
      const created = await app.inject({
        method: 'POST', url: `/api/v1/v7/books/${bookId}/setting-items/world-stage/review-tasks`, headers: { ...HEADERS, cookie }, payload
      });
      expect(created.statusCode).toBe(200);
      expect(['queued', 'working']).toContain(created.json().data.status);
      const reviewBatchId = created.json().data.batchId as string;
      expect(context.database.prepare(`SELECT COUNT(*) AS count FROM v7_setting_item_jobs WHERE book_id=? AND batch_id=?`).get(bookId, reviewBatchId)).toEqual({ count: 1 });
      expect(String((context.database.prepare(`SELECT author_note FROM v7_setting_item_jobs WHERE book_id=? AND batch_id=?`).get(bookId, reviewBatchId) as { author_note: string }).author_note)).toContain(payload.content);
      expect(String((context.database.prepare(`SELECT author_note FROM v7_setting_item_jobs WHERE book_id=? AND batch_id=?`).get(bookId, reviewBatchId) as { author_note: string }).author_note).length).toBeGreaterThan(800);

      const completed = await pollBatch(app, cookie, bookId, reviewBatchId);
      expect(completed.status).toBe('awaiting_author');
      expect(completed.items).toHaveLength(1);
      expect(completed.items[0].state).toBe('needs_author');
      expect(['chief-deepseek-v4-pro', 'chief-glm-5-3', 'chief-kimi-k3']).toContain(completed.items[0].assignedMemberKey);
      expect(resolver.prompts.join('\n')).toContain(payload.content);
      expect(resolver.prompts.join('\n')).toContain(payload.instruction);
      expect(resolver.prompts.join('\n')).toContain('已经在finalContent修正的问题不得继续列入issues');
      expect(context.database.prepare(`SELECT COUNT(*) AS count FROM v7_setting_model_calls
        WHERE book_id=? AND batch_id=? AND node_key IN ('deputy','writer','writer_repair')`).get(bookId, reviewBatchId)).toEqual({ count: 0 });
      expect((context.database.prepare(`SELECT COUNT(*) AS count FROM v7_setting_model_calls
        WHERE book_id=? AND batch_id=? AND node_key IN ('chief','chief_repair')`).get(
        bookId,
        reviewBatchId
      ) as { count: number }).count).toBeGreaterThanOrEqual(1);
      const authorRevision = context.database.prepare(`SELECT content_json AS contentJson FROM v7_setting_outputs
        WHERE book_id=? AND batch_id=? AND item_key='world-stage' AND kind='author_revision'`).get(
        bookId,
        reviewBatchId
      ) as { contentJson: string };
      expect(JSON.parse(authorRevision.contentJson)).toMatchObject({ content: payload.content, instruction: payload.instruction });
      const reviewContracts = context.database.prepare(`SELECT task_id AS taskId,operation_mode AS operationMode,
        based_on_task_id AS basedOnTaskId,author_instruction_version AS authorInstructionVersion
        FROM v7_task_contracts WHERE book_id=? AND task_id LIKE ? ORDER BY task_id`).all(
        bookId,
        `${reviewBatchId}-world-stage-%`
      ) as Array<{ taskId: string; operationMode: string; basedOnTaskId: string | null; authorInstructionVersion: number | null }>;
      expect(reviewContracts.length).toBeGreaterThanOrEqual(1);
      const revisedContracts = reviewContracts.filter((contract) => contract.operationMode === 'revise');
      expect(revisedContracts.length).toBe(1);
      expect(revisedContracts).toEqual(revisedContracts.map((contract) => ({
        taskId: contract.taskId, operationMode: 'revise',
        basedOnTaskId: sourceBeforeReviewTask.taskId, authorInstructionVersion: 1
      })));
      const repairContracts = reviewContracts.filter((contract) => contract.operationMode === 'repair');
      expect(repairContracts.every((contract) => (
        contract.taskId === `${contract.basedOnTaskId}-repair` && contract.authorInstructionVersion === 1
      ))).toBe(true);
      expect(context.database.prepare(`SELECT COUNT(*) AS count FROM v7_setting_item_versions WHERE book_id=? AND item_key='world-stage'`).get(bookId)).toEqual({ count: (versionsBefore as { count: number }).count + 1 });

      const department = await app.inject({ method: 'GET', url: `/api/v1/v7/books/${bookId}/setting-department`, headers: { host: HEADERS.host, cookie } });
      expect(department.statusCode).toBe(200);
      expect(department.json().data.activeBatch.batchId).toBe(reviewBatchId);
      const repeated = await app.inject({
        method: 'POST', url: `/api/v1/v7/books/${bookId}/setting-items/world-stage/review-tasks`, headers: { ...HEADERS, cookie }, payload
      });
      expect(repeated.statusCode).toBe(200);
      expect(repeated.json().data.batchId).toBe(reviewBatchId);
      expect(context.database.prepare(`SELECT COUNT(*) AS count FROM v7_setting_item_jobs WHERE book_id=? AND batch_id=?`).get(bookId, reviewBatchId)).toEqual({ count: 1 });
    } finally { await app.close(); }
  });

  it('设定技术重试沿用首次冻结任务，只重跑失败主编并保留副编和编剧成果', async () => {
    context = createTestContext('wenmi-v7-setting-technical-retry-');
    const resolver = new RetrySettingResolver('known');
    const app = await createServer(context.config, context.database, { v7OpeningModelAdapters: resolver });
    try {
      const cookie = await register(app, 'setting-retry@example.com', '重试作者', 'strong-pass-905');
      const bookId = await createBook(app, cookie, '设定重试测试', 'setting-retry-book-0001', '历史脑洞');
      const created = await app.inject({
        method: 'POST', url: `/api/v1/v7/books/${bookId}/setting-batches`, headers: { ...HEADERS, cookie },
        payload: { selectedItemKeys: ['history'], customItems: [], authorNotes: {}, idempotencyKey: 'setting-retry-batch-0001' }
      });
      expect(created.statusCode).toBe(200);
      const batchId = created.json().data.batchId as string;
      expect((await pollBatch(app, cookie, bookId, batchId)).status).toBe('partially_failed');
      const before = { deputy: resolver.deputyCalls, writer: resolver.writerCalls, chief: resolver.chiefCalls };
      expect(before).toEqual({ deputy: 0, writer: 1, chief: 1 });

      resolver.allowChief = true;
      const retried = await app.inject({
        method: 'POST', url: `/api/v1/v7/books/${bookId}/setting-batches/${batchId}/retry`, headers: { ...HEADERS, cookie }, payload: {}
      });
      expect(retried.statusCode).toBe(200);
      expect((await pollBatch(app, cookie, bookId, batchId)).status).toBe('awaiting_author');
      expect(resolver.deputyCalls).toBe(before.deputy);
      expect(resolver.writerCalls).toBe(before.writer);
      expect(resolver.chiefCalls).toBe(before.chief + 1);
      expect(resolver.chiefPrompts[1]).toBe(resolver.chiefPrompts[0]);

      const ownerId = String((context.database.prepare('SELECT owner_id FROM books WHERE book_id=?').get(bookId) as { owner_id: string }).owner_id);
      const calls = context.database.prepare(`SELECT request_id,prompt_hash,state FROM v7_setting_model_calls
        WHERE owner_id=? AND book_id=? AND batch_id=? AND node_key='chief' ORDER BY started_at,request_id`).all(
        ownerId, bookId, batchId
      ) as Array<{ request_id: string; prompt_hash: string; state: string }>;
      expect(calls).toHaveLength(2);
      expect(calls.map((call) => call.state)).toEqual(['failed', 'succeeded']);
      expect(new Set(calls.map((call) => call.request_id)).size).toBe(2);
      expect(new Set(calls.map((call) => call.prompt_hash)).size).toBe(1);
      const manifest = context.database.prepare(`SELECT task_id,COUNT(*) AS count FROM v7_prompt_manifests
        WHERE owner_id=? AND book_id=? AND compiled_prompt_hash=? GROUP BY task_id`).get(
        ownerId, bookId, calls[0]!.prompt_hash
      ) as { task_id: string; count: number };
      expect(manifest.count).toBe(1);
      expect(calls.every((call) => call.request_id !== manifest.task_id)).toBe(true);
      expect(context.database.prepare(`SELECT COUNT(*) AS count FROM v7_setting_outputs
        WHERE owner_id=? AND book_id=? AND batch_id=? AND kind='writer_proposal'`).get(ownerId, bookId, batchId)).toEqual({ count: 1 });
    } finally { await app.close(); }
  });

  it('普通任务所有成员主输出和repair结构均无效时保留旧审计，并可重新发起新批次', async () => {
    context = createTestContext('wenmi-v7-setting-structural-restart-');
    const resolver = new StructureRecoveryResolver();
    resolver.invalidOrdinaryStructure = true;
    const app = await createServer(context.config, context.database, { v7OpeningModelAdapters: resolver });
    try {
      const cookie = await register(app, 'setting-structural-restart@example.com', '结构重开作者', 'strong-pass-924');
      const bookId = await createBook(app, cookie, '普通设定结构重开', 'setting-structural-restart-book', '历史脑洞');
      const created = await app.inject({
        method: 'POST', url: `/api/v1/v7/books/${bookId}/setting-batches`, headers: { ...HEADERS, cookie },
        payload: { selectedItemKeys: ['world-stage'], customItems: [], authorNotes: {}, idempotencyKey: 'setting-structural-old-batch' }
      });
      expect(created.statusCode, created.body).toBe(200);
      const oldBatchId = created.json().data.batchId as string;
      const failed = await pollBatch(app, cookie, bookId, oldBatchId);
      expect(failed).toMatchObject({ status: 'partially_failed', retryable: false, restartable: true });
      expect(resolver.ordinaryMembers.size).toBe(3);
      expect(resolver.ordinaryMainCalls).toBe(3);
      expect(resolver.ordinaryRepairCalls).toBe(3);
      const oldBatchAudit = context.database.prepare(`SELECT status,error_code,failure_stage,retry_safety,updated_at
        FROM v7_setting_batches WHERE book_id=? AND batch_id=?`).get(bookId, oldBatchId);
      expect(oldBatchAudit).toMatchObject({
        status: 'partially_failed', error_code: 'OPERATION_INCOMPLETE',
        failure_stage: 'post_dispatch', retry_safety: 'manual_redesign'
      });
      const oldCalls = context.database.prepare(`SELECT request_id,node_key,member_key,state,prompt_hash
        FROM v7_setting_model_calls WHERE book_id=? AND batch_id=? ORDER BY request_id`).all(bookId, oldBatchId);
      expect(oldCalls).toHaveLength(6);
      expect((oldCalls as Array<{ state: string }>).every((call) => call.state === 'succeeded')).toBe(true);
      const oldEventCount = context.database.prepare(`SELECT COUNT(*) AS count FROM v7_setting_member_events
        WHERE book_id=? AND batch_id=?`).get(bookId, oldBatchId);

      resolver.invalidOrdinaryStructure = false;
      const restarted = await app.inject({
        method: 'POST', url: `/api/v1/v7/books/${bookId}/setting-batches/${oldBatchId}/restart`,
        headers: { ...HEADERS, cookie }, payload: { idempotencyKey: 'setting-structural-new-batch' }
      });
      expect(restarted.statusCode, restarted.body).toBe(200);
      const newBatchId = restarted.json().data.batchId as string;
      expect(newBatchId).not.toBe(oldBatchId);
      const completed = await pollBatch(app, cookie, bookId, newBatchId);
      expect(completed).toMatchObject({ status: 'awaiting_author', retryable: false, restartable: false });
      expect(context.database.prepare(`SELECT status,error_code,failure_stage,retry_safety,updated_at
        FROM v7_setting_batches WHERE book_id=? AND batch_id=?`).get(bookId, oldBatchId)).toEqual(oldBatchAudit);
      expect(context.database.prepare(`SELECT request_id,node_key,member_key,state,prompt_hash
        FROM v7_setting_model_calls WHERE book_id=? AND batch_id=? ORDER BY request_id`).all(bookId, oldBatchId)).toEqual(oldCalls);
      expect(context.database.prepare(`SELECT COUNT(*) AS count FROM v7_setting_member_events
        WHERE book_id=? AND batch_id=?`).get(bookId, oldBatchId)).toEqual(oldEventCount);
    } finally { await app.close(); }
  });

  it('会员算力在分组间不足时保留成功项、不伪造成成员失败，条件恢复后只续跑未发送项', async () => {
    context = createTestContext('wenmi-v7-setting-membership-recovery-');
    const delegate = new SettingResolver(false);
    let quotaOwner = '';
    let exhausted = false;
    const resolver: V7OpeningModelAdapterResolver = { resolve(provider, modelId, purpose) {
      const adapter = delegate.resolve(provider, modelId, purpose);
      return { provider, modelId, generate: async (request, signal) => {
        const result = await adapter.generate(request, signal);
        if (!exhausted && quotaOwner && settingStagePrompt(request.prompt).includes('v7_setting_group_design_v1')) {
          exhausted = true;
          context!.database.prepare('UPDATE user_memberships SET token_quota=1000 WHERE owner_id=?').run(quotaOwner);
        }
        return result;
      }};
    }};
    const app = await createServer(context.config, context.database, { v7OpeningModelAdapters: resolver });
    try {
      await register(app, 'setting-membership-admin@example.com', '额度测试管理员', 'strong-pass-907');
      const cookie = await register(app, 'setting-membership-recovery@example.com', '额度恢复作者', 'strong-pass-908');
      const bookId = await createBook(app, cookie, '额度恢复测试', 'setting-membership-recovery-book', '历史脑洞');
      const owner = context.database.prepare('SELECT owner_id FROM books WHERE book_id=?').get(bookId) as { owner_id: string };
      // 入场额度足够；模拟首项返回时其他任务用完额度，下一项发送前应阻断。
      quotaOwner = owner.owner_id;
      context.database.prepare('UPDATE user_memberships SET token_quota=200000 WHERE owner_id=?').run(owner.owner_id);
      const selectedItemKeys = ['world-stage', 'geography', 'hazards', 'civilization', 'history', 'governance', 'class'];
      const created = await app.inject({
        method: 'POST', url: `/api/v1/v7/books/${bookId}/setting-batches`, headers: { ...HEADERS, cookie },
        payload: { selectedItemKeys, customItems: [], authorNotes: {}, designMemberKey: 'planner-deepseek-v4-pro', idempotencyKey: 'setting-membership-batch-0001' }
      });
      expect(created.statusCode, created.body).toBe(200);
      const batchId = created.json().data.batchId as string;
      const failed = await pollBatch(app, cookie, bookId, batchId);
      expect(failed.status).toBe('partially_failed');
      expect(failed.statusText).toMatch(/剩余算力不足/u);
      expect(failed.progress.completed).toBeGreaterThan(0);
      expect(failed.progress.completed).toBeLessThan(selectedItemKeys.length);
      const checkpointCount = (context.database.prepare(`SELECT COUNT(*) AS count FROM v7_setting_outputs
        WHERE owner_id=? AND book_id=? AND batch_id=? AND kind='writer_proposal'`).get(
        owner.owner_id, bookId, batchId
      ) as { count: number }).count;
      expect(checkpointCount).toBe(failed.progress.completed);
      expect(context.database.prepare(`SELECT error_code,failure_stage,retry_safety FROM v7_setting_batches
        WHERE owner_id=? AND book_id=? AND batch_id=?`).get(owner.owner_id, bookId, batchId)).toEqual({
        error_code: 'MEMBERSHIP_QUOTA_EXHAUSTED',
        failure_stage: 'pre_dispatch',
        retry_safety: 'safe_after_precondition'
      });
      expect(context.database.prepare(`SELECT COUNT(*) AS count FROM v7_setting_member_events
        WHERE owner_id=? AND book_id=? AND batch_id=? AND event_type IN ('leave','handoff')`).get(
        owner.owner_id, bookId, batchId
      )).toEqual({ count: 0 });

      const preservedJobs = context.database.prepare(`SELECT job_id,item_key,state,active_output_id,attempt_count,revision,updated_at
        FROM v7_setting_item_jobs WHERE owner_id=? AND book_id=? AND batch_id=? AND state='needs_author'
        ORDER BY item_key`).all(owner.owner_id, bookId, batchId);
      const preservedOutputs = context.database.prepare(`SELECT output_id,item_key,request_id
        FROM v7_setting_outputs WHERE owner_id=? AND book_id=? AND batch_id=? AND kind='writer_proposal'
        ORDER BY item_key,output_id`).all(owner.owner_id, bookId, batchId);
      expect(preservedJobs).not.toHaveLength(0);
      expect(context.database.prepare(`SELECT COUNT(*) AS count FROM v7_setting_model_calls
        WHERE owner_id=? AND book_id=? AND batch_id=? AND state IN ('working','unknown')`).get(
        owner.owner_id, bookId, batchId
      )).toEqual({ count: 0 });
      context.database.prepare(`UPDATE v7_setting_batches SET error_code=NULL,failure_stage=NULL,retry_safety=NULL
        WHERE owner_id=? AND book_id=? AND batch_id=?`).run(owner.owner_id, bookId, batchId);
      const legacyMemberKey = String((preservedJobs[0] as { active_output_id: string }).active_output_id === null
        ? 'planner-deepseek-v4-pro'
        : (context.database.prepare(`SELECT member_key FROM v7_setting_outputs
            WHERE owner_id=? AND book_id=? AND output_id=?`).get(
              owner.owner_id, bookId, (preservedJobs[0] as { active_output_id: string }).active_output_id
            ) as { member_key: string }).member_key);
      context.database.prepare(`INSERT INTO v7_setting_member_events
        (event_id,owner_id,book_id,batch_id,item_key,member_key,event_type,handoff_to_member_key,public_message,internal_reason,created_at)
        VALUES ('legacy-membership-leave',?,?,?,?,?,'leave',NULL,'旧版误记为请假',?,?)`).run(
        owner.owner_id, bookId, batchId, 'game-entry', legacyMemberKey,
        '召集AI团队需使用算力，本期剩余算力值不足以继续这一步，请续费后继续。',
        '2026-08-31T00:00:00.000Z'
      );
      const legacyView = await app.inject({
        method: 'GET', url: `/api/v1/v7/books/${bookId}/setting-batches/${batchId}`,
        headers: { host: HEADERS.host, cookie }
      });
      expect(legacyView.statusCode).toBe(200);
      expect(legacyView.json().data).toMatchObject({ retryable: true, restartable: false });
      expect(legacyView.json().data.members.every((member: { presence: string }) => member.presence !== 'leave')).toBe(true);

      context.database.prepare('UPDATE user_memberships SET token_quota=1 WHERE owner_id=?').run(owner.owner_id);
      const stillBlocked = await app.inject({
        method: 'POST', url: `/api/v1/v7/books/${bookId}/setting-batches/${batchId}/retry`,
        headers: { ...HEADERS, cookie }, payload: {}
      });
      expect(stillBlocked.statusCode).toBe(403);
      expect(JSON.stringify(stillBlocked.json())).toMatch(/剩余.*不足/u);
      expect((await pollBatch(app, cookie, bookId, batchId)).progress.completed).toBe(checkpointCount);

      context.database.prepare('UPDATE user_memberships SET token_quota=500000 WHERE owner_id=?').run(owner.owner_id);
      const resumed = await app.inject({
        method: 'POST', url: `/api/v1/v7/books/${bookId}/setting-batches/${batchId}/retry`,
        headers: { ...HEADERS, cookie }, payload: {}
      });
      expect(resumed.statusCode, resumed.body).toBe(200);
      const completed = await pollBatch(app, cookie, bookId, batchId);
      expect(completed.status).toBe('awaiting_author');
      expect(completed.progress.completed).toBe(selectedItemKeys.length);
      expect(context.database.prepare(`SELECT COUNT(*) AS count FROM v7_setting_outputs
        WHERE owner_id=? AND book_id=? AND batch_id=? AND kind='writer_proposal'`).get(
        owner.owner_id, bookId, batchId
      )).toEqual({ count: selectedItemKeys.length });
      expect(context.database.prepare(`SELECT error_code,failure_stage,retry_safety FROM v7_setting_batches
        WHERE owner_id=? AND book_id=? AND batch_id=?`).get(owner.owner_id, bookId, batchId)).toEqual({
        error_code: null, failure_stage: null, retry_safety: null
      });
      expect(context.database.prepare(`SELECT job_id,item_key,state,active_output_id,attempt_count,revision,updated_at
        FROM v7_setting_item_jobs WHERE owner_id=? AND book_id=? AND batch_id=? AND item_key IN (${
          preservedJobs.map(() => '?').join(',')
        }) ORDER BY item_key`).all(
        owner.owner_id, bookId, batchId,
        ...preservedJobs.map((job) => (job as { item_key: string }).item_key)
      )).toEqual(preservedJobs);
      expect(context.database.prepare(`SELECT output_id,item_key,request_id
        FROM v7_setting_outputs WHERE owner_id=? AND book_id=? AND batch_id=? AND kind='writer_proposal'
          AND item_key IN (${preservedJobs.map(() => '?').join(',')})
        ORDER BY item_key,output_id`).all(
        owner.owner_id, bookId, batchId,
        ...preservedJobs.map((job) => (job as { item_key: string }).item_key)
      )).toEqual(preservedOutputs);
      expect(context.database.prepare(`SELECT COUNT(*) AS count FROM v7_setting_member_events
        WHERE owner_id=? AND book_id=? AND batch_id=? AND event_type IN ('leave','handoff')
          AND internal_reason LIKE '%剩余算力%'`).get(
        owner.owner_id, bookId, batchId
      )).toEqual({ count: 1 });
    } finally { await app.close(); }
  });

  it('结果未知的设定调用禁止盲目技术重试', async () => {
    context = createTestContext('wenmi-v7-setting-unknown-retry-');
    const resolver = new RetrySettingResolver('unknown');
    const app = await createServer(context.config, context.database, { v7OpeningModelAdapters: resolver });
    try {
      const cookie = await register(app, 'setting-unknown@example.com', '未知结果作者', 'strong-pass-906');
      const bookId = await createBook(app, cookie, '未知结果测试', 'setting-unknown-book-0001', '历史脑洞');
      const created = await app.inject({
        method: 'POST', url: `/api/v1/v7/books/${bookId}/setting-batches`, headers: { ...HEADERS, cookie },
        payload: { selectedItemKeys: ['history'], customItems: [], authorNotes: {}, idempotencyKey: 'setting-unknown-batch-0001' }
      });
      const batchId = created.json().data.batchId as string;
      expect((await pollBatch(app, cookie, bookId, batchId)).status).toBe('partially_failed');
      const callsBefore = resolver.totalCalls;
      const retried = await app.inject({
        method: 'POST', url: `/api/v1/v7/books/${bookId}/setting-batches/${batchId}/retry`, headers: { ...HEADERS, cookie }, payload: {}
      });
      expect(retried.statusCode).toBe(409);
      expect(JSON.stringify(retried.json())).toMatch(/不能盲目重试/u);
      expect(resolver.totalCalls).toBe(callsBefore);
    } finally { await app.close(); }
  });

  it('旧模型或损坏名册的设定任务只保留结果，不回退当前名册继续调用', async () => {
    context = createTestContext('wenmi-v7-setting-retired-roster-');
    const resolver = new SettingResolver(false);
    const app = await createServer(context.config, context.database, { v7OpeningModelAdapters: resolver });
    try {
      const cookie = await register(app, 'setting-retired-roster@example.com', '旧任务作者', 'strong-pass-907');
      const bookId = await createBook(app, cookie, '旧设定任务测试', 'setting-retired-roster-book-0001', '历史脑洞');
      const owner = context.database.prepare('SELECT owner_id FROM books WHERE book_id=?').get(bookId) as { owner_id: string };
      const roster = V7_SETTING_MEMBERS.map((member) => ({ ...member, model: { ...member.model } }));
      roster[0] = { ...roster[0]!, model: { ...roster[0]!.model, modelId: 'glm-5.2' } };
      const item = V7_SETTING_CATALOG.find((candidate) => candidate.key === 'history')!;
      const repository = new V7SettingEditorialRepository(context.database);
      repository.createBatchWithJobs({
        batch: {
          batchId: 'retired-setting-batch', ownerId: owner.owner_id, bookId,
          idempotencyKey: 'retired-setting-key', requestHash: 'a'.repeat(64),
          selectedItemsJson: JSON.stringify([item.key]), customItemsJson: '[]',
          openingVersion: 1, openingHash: 'b'.repeat(64), rosterJson: JSON.stringify(roster),
          now: '2026-08-25T00:00:00.000Z'
        },
        jobs: [{ jobId: 'retired-setting-job', item, authorNote: '' }]
      });
      const callsBefore = resolver.prompts.length;

      const opened = await app.inject({
        method: 'GET', url: `/api/v1/v7/books/${bookId}/setting-batches/retired-setting-batch`,
        headers: { ...HEADERS, cookie }
      });
      expect(opened.statusCode).toBe(200);
      const failed = await pollBatch(app, cookie, bookId, 'retired-setting-batch');
      expect(failed.status).toBe('partially_failed');
      expect(resolver.prompts).toHaveLength(callsBefore);
      expect(context.database.prepare(`SELECT COUNT(*) AS count FROM v7_setting_outputs
        WHERE owner_id=? AND book_id=? AND batch_id='retired-setting-batch'`).get(owner.owner_id, bookId))
        .toEqual({ count: 0 });

      const retried = await app.inject({
        method: 'POST', url: `/api/v1/v7/books/${bookId}/setting-batches/retired-setting-batch/retry`,
        headers: { ...HEADERS, cookie }, payload: {}
      });
      expect(retried.statusCode).toBe(409);
      expect(JSON.stringify(retried.json())).toMatch(/历史设定任务/u);
      expect(resolver.prompts).toHaveLength(callsBefore);
    } finally { await app.close(); }
  });

  it('长批次续约后，旧租约时点不能被页面轮询重复接管', async () => {
    context = createTestContext('wenmi-v7-setting-lease-');
    const app = await createServer(context.config, context.database, { v7OpeningModelAdapters: new SettingResolver(false) });
    try {
      const cookie = await register(app, 'setting-lease@example.com', '租约作者', 'strong-pass-901');
      const bookId = await createBook(app, cookie, '长批次设定测试', 'lease-book-0001', '历史脑洞');
      const owner = context.database.prepare('SELECT owner_id FROM books WHERE book_id=?').get(bookId) as { owner_id: string };
      context.database.prepare(`INSERT INTO v7_setting_batches
        (batch_id,owner_id,book_id,idempotency_key,request_hash,status,selected_items_json,custom_items_json,opening_version,opening_hash,roster_json,created_at,updated_at)
        VALUES ('lease-batch',?,?,'lease-key',?,'queued','[]','[]',1,?,'[]',?,?)`)
        .run(owner.owner_id, bookId, 'a'.repeat(64), 'b'.repeat(64), '2026-08-25T00:00:00.000Z', '2026-08-25T00:00:00.000Z');
      const repository = new V7SettingEditorialRepository(context.database);
      expect(repository.claimBatch({
        ownerId: owner.owner_id, bookId, batchId: 'lease-batch', token: 'worker-a',
        leaseExpiresAt: '2026-08-25T00:02:00.000Z', now: '2026-08-25T00:00:00.000Z'
      })).toBe(true);
      expect(repository.renewBatchLease({
        ownerId: owner.owner_id, bookId, batchId: 'lease-batch', token: 'worker-a',
        leaseExpiresAt: '2026-08-25T00:18:00.000Z', now: '2026-08-25T00:03:00.000Z'
      })).toBe(true);
      expect(repository.claimBatch({
        ownerId: owner.owner_id, bookId, batchId: 'lease-batch', token: 'worker-b',
        leaseExpiresAt: '2026-08-25T00:20:00.000Z', now: '2026-08-25T00:04:00.000Z'
      })).toBe(false);
    } finally { await app.close(); }
  });
});

class SettingResolver implements V7OpeningModelAdapterResolver {
  public readonly temperatures: Array<number | undefined> = [];
  public readonly prompts: string[] = [];
  public recommendationAttempts = 0;
  public failAllCalls = false;
  public failMemberKey: string | null = null;
  public finalReviewGate: Promise<void> | null = null;
  public finalReviewStarted: (() => void) | null = null;
  public finalReviewOutputOverride: string | null = null;
  private failedWriterOne = false;
  public constructor(
    private readonly failFirstWriter: boolean,
    public failRecommendation = false,
    private readonly recommendationOutcomeUnknown = false
  ) {}
  public resolve(provider: string, modelId: string, _purpose: ModelPurpose): ModelAdapter {
    return { provider, modelId, generate: async (request: ModelRequest): Promise<ModelResult> => {
      this.temperatures.push(request.temperature);
      this.prompts.push(request.prompt);
      if (this.failAllCalls) throw new Error('模拟当前设定成员均未完成');
      if (this.failMemberKey === request.agentId) throw new Error('模拟指定成员本轮没有完成');
      if (request.prompt.includes('v7_setting_batch_final_review_v1')) {
        this.finalReviewStarted?.();
        if (this.finalReviewGate !== null) await this.finalReviewGate;
      }
      if (this.failFirstWriter && request.agentId === 'planner-deepseek-v4-pro' && !this.failedWriterOne) { this.failedWriterOne = true; throw new Error('模拟成员临时请假'); }
      if (request.prompt.includes('只判断后续设定阶段应该准备哪些条目')) {
        this.recommendationAttempts += 1;
        if (this.failRecommendation) {
          if (this.recommendationOutcomeUnknown) {
            throw new ModelAdapterError('模拟设定清单结果未知', 'technical_failure', true, 504, true);
          }
          throw new Error('模拟主编本轮请假');
        }
      }
      const stagePrompt = settingStagePrompt(request.prompt);
      const output = request.prompt.includes('你是设定连续性审查员')
        ? JSON.stringify({change:'wording',covered:true,conflicts:[]})
        : stagePrompt.includes('v7_setting_group_design_v1')
        ? groupedSettingOutput(stagePrompt)
        : stagePrompt.includes('v7_setting_batch_final_review_patch_v1')
        ? batchFinalReviewPatchOutput(stagePrompt)
        : request.prompt.includes('v7_setting_batch_final_review_v1')
        ? this.finalReviewOutputOverride ?? batchFinalReviewOutput(stagePrompt)
        : request.prompt.includes('v7_compile_book_genre_profile_v1')
        ? JSON.stringify({
            primaryGenreKey: 'history',
            supportingGenreKeys: [],
            publicLabel: '历史穿越',
            workingIdentity: '以历史时代约束为主体，让现代人的选择在真实制度、交通与资源限制下改变局面。',
            primaryPromise: '主角在可信的历史边界内从底层逐步立足。',
            supportingFunctions: [{ genreKey: 'history', functions: ['穿越只提供视角差异，不提供万能答案。'] }],
            writingPriorities: ['人物行动符合时代条件', '成长有持续代价'],
            authenticityChecks: ['年代、交通、军政与物资必须互相一致'],
            avoidPatterns: ['现代知识无成本碾压', '真实人物集体降智'],
            conflictResolutions: []
          })
        : request.prompt.includes('只判断后续设定阶段应该准备哪些条目')
          ? recommendationOutput()
        : request.prompt.includes('你是副编')
        ? JSON.stringify({ verifiedFacts: ['东汉末年制度存在地域差异'], uncertainPoints: ['具体年月需要作者确定'], usableBoundaries: ['不伪造史实'], translationForWriter: '把史实作为边界，不照抄百科。' })
        : request.prompt.includes('你是设计成员')
          ? JSON.stringify({ content: '东汉末年秩序松动，地方军政力量逐渐上升。主角所在地区交通、粮食和户籍都受战乱限制，历史事实作为边界，允许人物与局部事件合理架空。', designRationale: '保持三国代入感，同时给原创剧情留下空间。', storyConsequences: ['分卷设计必须考虑粮道和身份'], dependencies: ['开书时代背景'], risks: ['具体起始年份需作者确认'] })
          : request.prompt.includes('候选：') || request.prompt.includes('上次输出存在空字段')
            ? JSON.stringify({ verdict: 'pass', finalContent: '东汉末年秩序松动，地方军政力量逐渐上升。主角所在地区交通、粮食和户籍都受战乱限制；历史事实作为边界，人物和局部事件可在因果合理的前提下架空。', summary: '与开书资料一致，可供后续蓝图和分卷使用。', issues: [], suggestions: ['确定首卷所在州郡时再补地名细节'] })
            : JSON.stringify({ verdict: 'pass', finalContent: '', summary: '字段偶发缺失，系统应自动修复。', issues: [], suggestions: [] });
      return { provider, modelId, output, inputTokens: 80, outputTokens: 160, cashCostCny: 0, state: 'succeeded' };
    }};
  }
}

class StructureRecoveryResolver implements V7OpeningModelAdapterResolver {
  private readonly delegate = new SettingResolver(false);
  public invalidOrdinaryStructure = false;
  public invalidRecommendationMain = false;
  public failRecommendationRepair = false;
  public invalidFinalReviewMain = false;
  public failFinalReviewRepair = false;
  public ordinaryMainCalls = 0;
  public ordinaryRepairCalls = 0;
  public readonly ordinaryMembers = new Set<string>();
  public recommendationMainCalls = 0;
  public recommendationRepairCalls = 0;
  public finalReviewMainCalls = 0;
  public finalReviewRepairCalls = 0;

  public resolve(provider: string, modelId: string, purpose: ModelPurpose): ModelAdapter {
    const adapter = this.delegate.resolve(provider, modelId, purpose);
    return {
      provider,
      modelId,
      generate: async (request, signal) => {
        const stagePrompt = settingStagePrompt(request.prompt);
        const completePrompt = `${stagePrompt}\n${request.prompt}`;
        if (completePrompt.includes('只判断后续设定阶段应该准备哪些条目')) {
          const repair = completePrompt.includes('上次结果已经保留，但JSON结构没有通过合同校验');
          if (repair) {
            this.recommendationRepairCalls += 1;
            if (this.failRecommendationRepair) throw new Error('模拟设定清单repair已知失败');
            return successfulModelResult(provider, modelId, recommendationOutput());
          }
          if (this.invalidRecommendationMain) {
            this.recommendationMainCalls += 1;
            return successfulModelResult(provider, modelId, '{invalid-recommendation-json');
          }
        }
        if (completePrompt.includes('v7_setting_batch_final_review_v1')) {
          const repair = completePrompt.includes('上次统一整理结果已经保留');
          if (repair) {
            this.finalReviewRepairCalls += 1;
            if (this.failFinalReviewRepair) throw new Error('模拟统一整理repair已知失败');
            return successfulModelResult(provider, modelId, JSON.stringify({
              verdict: 'pass', summary: '统一整理结构已经修复。', unifiedDecisions: [], conflicts: [], patches: []
            }));
          }
          if (this.invalidFinalReviewMain) {
            this.finalReviewMainCalls += 1;
            return successfulModelResult(provider, modelId, '{invalid-final-review-json');
          }
        }
        if (this.invalidOrdinaryStructure && completePrompt.includes('你是设计成员')) {
          const repair = completePrompt.includes('上次格式不合格');
          this.ordinaryMembers.add(request.agentId);
          if (repair) this.ordinaryRepairCalls += 1;
          else this.ordinaryMainCalls += 1;
          return successfulModelResult(provider, modelId, '{invalid-setting-json');
        }
        return adapter.generate(request, signal);
      }
    };
  }
}

function successfulModelResult(provider: string, modelId: string, output: string): ModelResult {
  return { provider, modelId, output, inputTokens: 80, outputTokens: 160, cashCostCny: 0, state: 'succeeded' };
}

class BlockingSettingResolver implements V7OpeningModelAdapterResolver {
  private readonly delegate = new SettingResolver(false);
  private readonly writerStarted: Promise<void>;
  private readonly writerGate: Promise<void>;
  private resolveWriterStarted: (() => void) | null = null;
  private resolveWriterGate: (() => void) | null = null;
  private writerBlocked = false;
  private writerReleased = false;

  public constructor() {
    this.writerStarted = new Promise((resolve) => { this.resolveWriterStarted = resolve; });
    this.writerGate = new Promise((resolve) => { this.resolveWriterGate = resolve; });
  }

  public waitUntilWriterStarted(): Promise<void> {
    return this.writerStarted;
  }

  public releaseWriter(): void {
    this.writerReleased = true;
    this.resolveWriterGate?.();
    this.resolveWriterGate = null;
  }

  public resolve(provider: string, modelId: string, purpose: ModelPurpose): ModelAdapter {
    const adapter = this.delegate.resolve(provider, modelId, purpose);
    return {
      provider,
      modelId,
      generate: async (request, signal) => {
        if (!this.writerBlocked && (request.prompt.includes('你是设计成员') || request.prompt.includes('你是本组设计成员'))) {
          this.writerBlocked = true;
          this.resolveWriterStarted?.();
          this.resolveWriterStarted = null;
          if (!this.writerReleased) await this.writerGate;
        }
        return adapter.generate(request, signal);
      }
    };
  }
}

function batchFinalReviewOutput(prompt: string): string {
  const payload = JSON.parse(prompt) as {
    reviewInputMode?: string;
    currentSettingCandidates?: Array<{ itemKey: string; label: string; groupTitle: string; contextSummary?: string }>;
  };
  if (payload.reviewInputMode !== 'layered_semantic_index') {
    return JSON.stringify({
      verdict: 'pass',
      summary: '全部设定已经跨条目核对，机构和时代称呼统一。',
      unifiedDecisions: [{ topic: '时代称呼', decision: '统一使用东汉末年', reason: '与正式开书资料一致' }],
      conflicts: [],
      patches: [{
        itemKey: 'world-stage',
        finalContent: '东汉末年的州郡、驿道与粮道互相制约，统一使用同一套时代称呼。',
        summary: '统一世界舞台中的时代称呼。',
        issues: [],
        suggestions: []
      }]
    });
  }
  const items = payload.currentSettingCandidates ?? [];
  const groups = new Map<string, string[]>();
  for (const item of items) groups.set(item.groupTitle, [...(groups.get(item.groupTitle) ?? []), item.itemKey]);
  if (items.some((item) => item.label.startsWith('冲突长设定'))) {
    return JSON.stringify({
      verdict: 'needs_author',
      summary: '发现国号冲突，正在按统一决定修回受影响条目。',
      contextSummary: '全书统一使用景朝，其他既有规则保持不变。',
      factLedger: items.map((item) => ({ itemKey: item.itemKey, label: item.label, facts: [item.contextSummary ?? item.label] })),
      groupSummaries: [...groups].map(([groupTitle, itemKeys]) => ({ groupTitle, summary: `${groupTitle}需要统一国号。`, itemKeys })),
      unifiedDecisions: [{ topic: '王朝国号', decision: '全书统一使用景朝', reason: '正式开书资料采用景朝' }],
      conflicts: [{ itemKeys: items.map((item) => item.itemKey), problem: '同一本书出现多个国号', decision: '全部改为景朝', impact: '不统一会污染后续规划' }],
      patches: []
    });
  }
  return JSON.stringify({
    verdict: 'pass',
    summary: '大量设定已经按分组轻量核对完成。',
    contextSummary: '人物、时代、规则和禁项已经按分组统一，后续只按任务回查相关条目。',
    factLedger: items.map((item) => ({
      itemKey: item.itemKey,
      label: item.label,
      facts: [item.contextSummary ?? `${item.label}沿用当前确认版本。`]
    })),
    groupSummaries: [...groups].map(([groupTitle, itemKeys]) => ({
      groupTitle,
      summary: `${groupTitle}已经统一关键边界。`,
      itemKeys
    })),
    unifiedDecisions: [],
    conflicts: [],
    patches: []
  });
}

function batchFinalReviewPatchOutput(prompt: string): string {
  const payload = JSON.parse(prompt) as {
    affectedItems?: Array<{ itemKey: string; label: string; currentContent: string; existingIssues?: unknown[] }>;
  };
  return JSON.stringify({
    patches: (payload.affectedItems ?? []).map((item) => ({
      itemKey: item.itemKey,
      finalContent: `景朝统一设定：${item.currentContent.replaceAll('大靖', '景朝').replaceAll('大朔', '景朝').replaceAll('大宁', '景朝')}`.slice(0, 2_000),
      summary: `${item.label}已经统一使用景朝。`,
      contextSummary: `${item.label}统一使用景朝，原有规则保持不变。`,
      factEntries: [`${item.label}使用景朝国号。`],
      issues: Array.isArray(item.existingIssues) ? item.existingIssues : [],
      suggestions: []
    }))
  });
}

function groupedSettingOutput(prompt: string): string {
  const match = prompt.match(/【本组要完成的设定】(\[[^\n]+\])/u);
  if (match?.[1] === undefined) throw new Error('测试分组提示缺少条目合同');
  const items = JSON.parse(match[1]) as Array<{ itemKey: string; label: string }>;
  return JSON.stringify({
    items: items.map((item) => ({
      itemKey: item.itemKey,
      content: `${item.label}以东汉末年的真实社会条件为边界，人物行动必须服从交通、粮食、身份与制度限制，并给后续剧情保留明确可追溯的因果空间。`,
      designRationale: `先把${item.label}的硬边界立稳，避免后续规划凭空增加能力或条件。`,
      contextSummary: `${item.label}遵守东汉末年交通、粮食、身份和制度边界。`,
      factEntries: [`${item.label}必须服从东汉末年的交通、粮食、身份与制度限制。`],
      storyConsequences: ['卷和链设计必须检查现实条件'],
      dependencies: ['正式开书资料'],
      risks: [],
      selfReview: { verdict: 'pass', summary: `${item.label}与正式开书资料一致。`, issues: [], suggestions: [] }
    }))
  });
}

class RetrySettingResolver implements V7OpeningModelAdapterResolver {
  public allowChief = false;
  public totalCalls = 0;
  public deputyCalls = 0;
  public writerCalls = 0;
  public chiefCalls = 0;
  public readonly chiefPrompts: string[] = [];
  public constructor(private readonly failure: 'known' | 'unknown') {}
  public resolve(provider: string, modelId: string, _purpose: ModelPurpose): ModelAdapter {
    return { provider, modelId, generate: async (request: ModelRequest): Promise<ModelResult> => {
      this.totalCalls += 1;
      const prompt = settingStagePrompt(request.prompt);
      let output: string;
      if (prompt.includes('你是副编')) {
        this.deputyCalls += 1;
        output = JSON.stringify({ verifiedFacts: ['东汉末年制度存在地域差异'], uncertainPoints: [], usableBoundaries: ['不伪造史实'], translationForWriter: '把史实作为创作边界。' });
      } else if (prompt.includes('你是设计成员')) {
        this.writerCalls += 1;
        output = JSON.stringify({ content: '东汉末年交通、军政和粮道彼此制约，人物只能在可信时代边界内行动。', designRationale: '让后续冲突有真实条件。', storyConsequences: ['行动必须考虑粮道'], dependencies: ['开书时代'], risks: [] });
      } else {
        this.chiefCalls += 1;
        this.chiefPrompts.push(request.prompt);
        if (!this.allowChief) {
          if (this.failure === 'unknown') throw new ModelAdapterError('模拟结果未知', 'technical_failure', true, 504, true);
          throw new Error('模拟主编已知失败');
        }
        output = JSON.stringify({ verdict: 'pass', finalContent: '东汉末年交通、军政和粮道彼此制约，人物只能在可信时代边界内行动。', summary: '时代边界完整。', issues: [], suggestions: [] });
      }
      return { provider, modelId, output, inputTokens: 80, outputTokens: 160, cashCostCny: 0, state: 'succeeded' };
    }};
  }
}

function settingStagePrompt(compiledPrompt: string): string {
  try {
    const value = JSON.parse(compiledPrompt) as { contextPack?: { content?: { stageTaskPayload?: unknown } } };
    const payload = value.contextPack?.content?.stageTaskPayload;
    if (typeof payload === 'string') return payload;
    if (payload !== undefined) return JSON.stringify(payload);
  } catch { /* 兼容未编译的测试提示。 */ }
  return compiledPrompt;
}

function recommendationOutput(): string {
  const requiredKeys = ['world-stage', 'governance', 'history', 'military'];
  const suggestedKeys: string[] = [];
  const used = new Set([...requiredKeys, ...suggestedKeys]);
  return JSON.stringify({
    requiredKeys,
    suggestedKeys,
    excludedKeys: V7_SETTING_CATALOG.map((item) => item.key).filter((key) => !used.has(key)),
    summary: '这是写实三国穿越文，先准备时代、社会规则、历史边界和军政关系；游戏与超凡设定暂时不用。'
  });
}

async function register(app: Awaited<ReturnType<typeof createServer>>, email: string, displayName: string, password: string): Promise<string> {
  const response = await app.inject({ method: 'POST', url: '/api/v1/auth/register', headers: HEADERS, payload: { email, password, displayName } });
  expect(response.statusCode).toBe(200);
  const raw = response.headers['set-cookie']; return String(Array.isArray(raw) ? raw[0] : raw).split(';', 1)[0]!;
}

async function createBook(
  app: Awaited<ReturnType<typeof createServer>>,
  cookie: string,
  title: string,
  key: string,
  category: string,
  options: { tags?: string[]; mustFollow?: string[] } = {}
): Promise<string> {
  const openingPackage = {
    title, positioning: {
      publishingPlatform: 'fanqie', channel: 'male', category, genres: [category], tags: options.tags ?? ['成长'],
      coreAppeal: '小人物在复杂世界中稳步成长。', targetReaders: '喜欢长篇成长和持续回报的男频读者',
      expectedTotalWords: 2_000_000, volumePlan: { minimum: 5, recommended: 6, maximum: 8 },
      retentionPositioning: '开篇快速建立主角处境，逐卷兑现成长、关系和局势变化。'
    },
    backgrounds: { eraAndWorld: category.includes('科幻') ? '星际殖民时代' : '东汉末年', openingSituation: '主角处于社会底层。' },
    protagonists: [{ name: '张三', age: '23岁', identity: '男主', background: '普通人', familyBackground: '普通家庭出身', careerBackground: '', goldenFinger: '', goal: '活下去并改变处境', dilemma: '资源和身份不足', personality: ['谨慎'], boundary: '不能无代价解决问题' }],
    opening: { startingSituation: '危机中醒来', incitingIncident: '被卷入冲突', immediateConflict: '必须立即选择', readerPromise: '靠行动逐步成长' },
    longTermDirection: { centralConflict: '个人与旧秩序冲突', progression: '从底层到能影响局势', relationshipDirection: '逐步建立可信伙伴', storyPotential: '冲突持续升级' },
    possibleEnding: { direction: '建立新的生活秩序', price: '承担真实损失', openness: '保留调整空间' }, authorNotes: [], mustFollow: options.mustFollow ?? ['不违背已确认设定']
  };
  const response = await app.inject({ method: 'POST', url: '/api/v1/v7/opening-books', headers: { ...HEADERS, cookie }, payload: { openingPackage, idempotencyKey: key } });
  expect(response.statusCode).toBe(200); return response.json().data.bookId as string;
}

async function pollBatch(app: Awaited<ReturnType<typeof createServer>>, cookie: string, bookId: string, batchId: string): Promise<any> {
  for (let index = 0; index < 120; index += 1) {
    const response = await app.inject({ method: 'GET', url: `/api/v1/v7/books/${bookId}/setting-batches/${batchId}`, headers: { host: HEADERS.host, cookie } });
    expect(response.statusCode).toBe(200); const view = response.json().data;
    if (!['queued', 'working'].includes(view.status)) return view;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error('设定任务未在预期时间完成');
}

async function waitForStoredBatchStatus(
  database: TestContext['database'],
  batchId: string,
  expectedStatus: string
): Promise<void> {
  for (let index = 0; index < 120; index += 1) {
    const row = database.prepare('SELECT status FROM v7_setting_batches WHERE batch_id=?').get(batchId) as { status: string } | undefined;
    if (row?.status === expectedStatus) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error(`设定任务${batchId}未进入${expectedStatus}`);
}

async function pollRedesign(
  app: Awaited<ReturnType<typeof createServer>>,
  cookie: string,
  bookId: string,
  itemKey: string,
  taskId: string
): Promise<any> {
  for (let index = 0; index < 120; index += 1) {
    const response = await app.inject({
      method: 'GET',
      url: `/api/v1/v7/books/${bookId}/setting-items/${itemKey}/redesigns/${taskId}`,
      headers: { host: HEADERS.host, cookie }
    });
    expect(response.statusCode).toBe(200);
    const view = response.json().data;
    if (!['queued', 'working'].includes(view.status)) return view;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error('重新设计任务未在预期时间完成');
}

async function pollRecommendation(app: Awaited<ReturnType<typeof createServer>>, cookie: string, bookId: string, taskId: string): Promise<any> {
  for (let index = 0; index < 120; index += 1) {
    const response = await app.inject({ method: 'GET', url: `/api/v1/v7/books/${bookId}/setting-recommendations/${taskId}`, headers: { host: HEADERS.host, cookie } });
    expect(response.statusCode).toBe(200); const view = response.json().data;
    if (!['queued', 'working'].includes(view.status)) return view;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error('主编设定清单未在预期时间完成');
}

async function pollFinalReview(app: Awaited<ReturnType<typeof createServer>>, cookie: string, bookId: string): Promise<any> {
  for (let index = 0; index < 120; index += 1) {
    const response = await app.inject({ method: 'GET', url: `/api/v1/v7/books/${bookId}/setting-final-reviews/current`, headers: { host: HEADERS.host, cookie } });
    expect(response.statusCode).toBe(200); const view = response.json().data;
    if (!['queued', 'working'].includes(view.status)) return view;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error('设定统一整理未在预期时间完成');
}
