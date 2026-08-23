import { afterEach, describe, expect, it } from 'vitest';
import { CanonService } from '../../../apps/api/src/application/knowledge/canon-service.js';
import { ContextPackService, estimateTokens } from '../../../apps/api/src/application/memory/context-pack-service.js';
import { DomainError, errorCodes } from '../../../apps/api/src/domain/errors.js';
import { createKnowledgeFixture } from '../../helpers/knowledge-fixture.js';
import { createTestContext, FixedClock, SequenceIds, type TestContext } from '../../helpers/test-context.js';

describe('不可变上下文包', () => {
  let context: TestContext | undefined;
  afterEach(() => context?.close());

  it('完整保留硬来源并显式记录低优先级排除原因', () => {
    context = createTestContext();
    const ids = new SequenceIds();
    const clock = new FixedClock();
    const fixture = createKnowledgeFixture(context, ids, clock);
    const hardContent = '老板决定：正文不可静默覆盖。当前正文：林澈抵达北塔。';
    const hardTokens = estimateTokens(hardContent);
    const pack = new ContextPackService(context.database, ids, clock).build(fixture.scope, {
      taskId: fixture.taskId, agentId: fixture.agentId, chapterId: fixture.chapterId,
      canonRevision: 0, positioningVersion: 1, tokenBudget: hardTokens + 2,
      hardSources: [{ sourceType: 'boss_decision', sourceId: 'decision-1', content: hardContent, reason: '老板已确认决定与当前正文', priority: 100 }],
      optionalSources: [
        { sourceType: 'expert_note', sourceId: 'low-note', content: '这是很长的低优先级专家建议，不应挤掉硬来源。', reason: '可选建议', priority: 1 },
        { sourceType: 'hint', sourceId: 'short-hint', content: '提示', reason: '短提示', priority: 10 }
      ]
    });
    expect(pack.sources[0]?.content).toBe(hardContent);
    expect(pack.sources[0]?.hard).toBe(true);
    expect(pack.sources[0]).toMatchObject({ constraintStrength: 'hard_fact', truthStatus: 'confirmed', scopeType: 'book' });
    expect(pack.sources.find((source) => source.sourceId === 'short-hint')).toMatchObject({ constraintStrength: 'soft_reference' });
    expect(pack.excluded).toContainEqual(expect.objectContaining({ sourceId: 'low-note', reason: 'token_budget_lower_priority' }));
    const stored = context.database.prepare(`SELECT source_manifest_json, content_hash FROM context_packs WHERE context_pack_id = ?`)
      .get(pack.contextPackId) as { source_manifest_json: string; content_hash: string };
    expect(JSON.parse(stored.source_manifest_json)[0].content).toBe(hardContent);
    expect(stored.content_hash).toBe(pack.contentHash);
    expect(JSON.parse(stored.source_manifest_json)[0]).toMatchObject({
      constraintStrength: 'hard_fact', truthStatus: 'confirmed', scopeType: 'book', dependencies: [] });
  });

  it('把正文事实、作者规划、开放问题和AI候选分区，候选不能冒充硬事实', () => {
    context = createTestContext();
    const ids = new SequenceIds();
    const clock = new FixedClock();
    const fixture = createKnowledgeFixture(context, ids, clock);
    const pack = new ContextPackService(context.database, ids, clock).build(fixture.scope, {
      taskId: fixture.taskId, agentId: fixture.agentId, chapterId: fixture.chapterId,
      canonRevision: 0, positioningVersion: 1, tokenBudget: 500,
      hardSources: [
        { sourceType: 'volume_settlement', sourceId: 'settlement-v1', content: '主角公开承担了代价。', reason: '卷结算事实', priority: 100, truthStatus: 'actual' },
        { sourceType: 'author_frontier', sourceId: 'frontier-v2', content: '作者目前只想到第十卷完成复仇。', reason: '作者确认边界', priority: 99, truthStatus: 'planned' },
        { sourceType: 'storyline_growth_candidate', sourceId: 'candidate-v3', content: 'AI猜测下一卷转向朝堂。', reason: '尚未确认的候选', priority: 70, truthStatus: 'confirmed', constraintStrength: 'hard_fact' }
      ],
      optionalSources: [
        { sourceType: 'storyline_open_question', sourceId: 'question-v1', content: '最终敌人是谁仍未知。', reason: '保留开放问题', priority: 80, truthStatus: 'confirmed' }
      ]
    });
    const byId = new Map(pack.sources.map((source) => [source.sourceId, source]));
    expect(byId.get('settlement-v1')).toMatchObject({ knowledgeZone: 'hard_fact', truthStatus: 'actual' });
    expect(byId.get('frontier-v2')).toMatchObject({ knowledgeZone: 'author_plan', truthStatus: 'planned' });
    expect(byId.get('question-v1')).toMatchObject({ knowledgeZone: 'open_question', constraintStrength: 'open_space' });
    expect(byId.get('candidate-v3')).toMatchObject({ knowledgeZone: 'ai_candidate', constraintStrength: 'current_task' });
    expect(byId.get('candidate-v3')?.constraintStrength).not.toBe('hard_fact');
    const stored = context.database.prepare('SELECT source_manifest_json FROM context_packs WHERE context_pack_id=?')
      .get(pack.contextPackId) as { source_manifest_json: string };
    expect(new Set((JSON.parse(stored.source_manifest_json) as Array<{ knowledgeZone: string }>).map((item) => item.knowledgeZone)))
      .toEqual(new Set(['hard_fact', 'author_plan', 'open_question', 'ai_candidate']));
  });
  it('硬来源超预算时暂停而不是截断', () => {
    context = createTestContext();
    const ids = new SequenceIds();
    const clock = new FixedClock();
    const fixture = createKnowledgeFixture(context, ids, clock);
    const database = context.database;
    expect(() => new ContextPackService(database, ids, clock).build(fixture.scope, {
      taskId: fixture.taskId, agentId: fixture.agentId, chapterId: fixture.chapterId,
      canonRevision: 0, positioningVersion: 1, tokenBudget: 1,
      hardSources: [{ sourceType: 'current_manuscript', sourceId: 'current', content: '不可截断的当前完整正文', reason: '当前正文', priority: 100 }],
      optionalSources: []
    })).toThrowError(expect.objectContaining<Partial<DomainError>>({ code: errorCodes.operationIncomplete }));
  });

  it('硬来源专用余量只扩到实际硬资料，不允许软资料占用未使用余量', () => {
    context = createTestContext();
    const ids = new SequenceIds();
    const clock = new FixedClock();
    const fixture = createKnowledgeFixture(context, ids, clock);
    const pack = new ContextPackService(context.database, ids, clock).build(fixture.scope, {
      taskId: fixture.taskId, agentId: fixture.agentId, chapterId: fixture.chapterId,
      canonRevision: 0, positioningVersion: 1, tokenBudget: 10, characterBudget: 10,
      hardSourceTokenReserve: 10, hardSourceCharacterReserve: 10,
      hardSources: [{ sourceType: 'current_manuscript', sourceId: 'hard-12', content: '甲'.repeat(12), reason: '必须完整保留', priority: 100 }],
      optionalSources: [{ sourceType: 'retrieval:fact', sourceId: 'optional-1', content: '乙', reason: '低优先级补充', priority: 99 }]
    });
    expect(pack.totalTokens).toBe(12);
    expect(pack.totalCharacters).toBe(12);
    expect(pack.sources.map((source) => source.sourceId)).toEqual(['hard-12']);
    expect(pack.excluded).toContainEqual(expect.objectContaining({
      sourceId: 'optional-1', reason: 'character_budget_lower_priority'
    }));
    expect(context.database.prepare('SELECT token_budget FROM context_packs WHERE context_pack_id = ?')
      .get(pack.contextPackId)).toEqual({ token_budget: 12 });
  });

  it('按字符预算构建可追溯资料包并保存策略版本与来源指纹', () => {
    context = createTestContext();
    const ids = new SequenceIds();
    const clock = new FixedClock();
    const fixture = createKnowledgeFixture(context, ids, clock);
    const pack = new ContextPackService(context.database, ids, clock).build(fixture.scope, {
      taskId: fixture.taskId,
      agentId: fixture.agentId,
      chapterId: fixture.chapterId,
      canonRevision: 0,
      positioningVersion: 1,
      tokenBudget: 100,
      characterBudget: 12,
      policyVersion: 'writer-context-test-v2',
      hardSources: [
        { sourceType: 'chapter_work_order', sourceId: 'order-1', content: '本章目标六个字', reason: '硬工单', priority: 100 }
      ],
      optionalSources: [
        { sourceType: 'optional', sourceId: 'fits', content: '补充', reason: '可选', priority: 10 },
        { sourceType: 'optional', sourceId: 'too-long', content: '这是一段超过剩余字符预算的资料', reason: '低优先级', priority: 1 }
      ]
    });
    expect(pack.totalCharacters).toBeLessThanOrEqual(12);
    expect(pack.sources.find((source) => source.sourceId === 'order-1'))
      .toMatchObject({ constraintStrength: 'current_task', truthStatus: 'planned', scopeType: 'chapter' });
    expect(pack.policyVersion).toBe('writer-context-test-v2');
    expect(pack.sourceFingerprint).toMatch(/^[a-f0-9]{64}$/u);
    expect(pack.excluded).toContainEqual(expect.objectContaining({
      sourceId: 'too-long',
      reason: 'character_budget_lower_priority'
    }));
    expect(context.database.prepare(`
      SELECT policy_version, source_fingerprint FROM context_packs WHERE context_pack_id = ?
    `).get(pack.contextPackId)).toEqual({
      policy_version: 'writer-context-test-v2',
      source_fingerprint: pack.sourceFingerprint
    });
  });

  it('正史变化只使旧版本派生上下文失效', () => {
    context = createTestContext();
    const ids = new SequenceIds();
    const clock = new FixedClock();
    const fixture = createKnowledgeFixture(context, ids, clock);
    const contextPacks = new ContextPackService(context.database, ids, clock);
    const oldPack = contextPacks.build(fixture.scope, {
      taskId: fixture.taskId, agentId: fixture.agentId, chapterId: fixture.chapterId,
      canonRevision: 0, positioningVersion: 1, tokenBudget: 100,
      hardSources: [{ sourceType: 'rule', sourceId: 'rule', content: '服从正史', reason: '硬规则', priority: 100 }], optionalSources: []
    });
    const canon = new CanonService(context.database, ids, clock);
    const entityId = canon.createEntity(fixture.scope, { entityType: 'character', canonicalName: '林澈' });
    canon.proposeFact(fixture.scope, {
      subjectEntityId: entityId, relationKey: 'location', value: '北塔', evidence: [{ quote: '抵达北塔' }], grade: 'B',
      sourceChapterId: fixture.chapterId, sourceManuscriptVersionId: fixture.manuscriptVersionId
    });
    canon.settleChapter(fixture.scope, fixture.chapterId, fixture.manuscriptVersionId, { location: '北塔' });
    expect(context.database.prepare(`SELECT status FROM context_packs WHERE context_pack_id = ?`).get(oldPack.contextPackId)).toEqual({ status: 'invalidated' });
  });

  it('完整前章已硬注入时排除同版本派生检索块并记录duplicate_of_hard_source', () => {
    context = createTestContext();
    const ids = new SequenceIds();
    const clock = new FixedClock();
    const fixture = createKnowledgeFixture(context, ids, clock);
    const pack = new ContextPackService(context.database, ids, clock).build(fixture.scope, {
      taskId: fixture.taskId, agentId: fixture.agentId, chapterId: fixture.chapterId,
      canonRevision: 0, positioningVersion: 1, tokenBudget: 1000,
      hardSources: [{ sourceType: 'manuscript', sourceId: 'mv-1', content: '前章完整正文', reason: '完整不可变版本', priority: 100, version: 'mv-1' }],
      optionalSources: [
        { sourceType: 'retrieval:manuscript', sourceId: 'mv-1-chunk-a', content: '前章正文片段A', reason: '同版本检索块', priority: 50, version: 'mv-1' },
        { sourceType: 'retrieval:manuscript', sourceId: 'mv-2-chunk-b', content: '旧版本正文片段', reason: '不同版本检索块', priority: 40, version: 'mv-2' }
      ]
    });
    expect(pack.excluded).toContainEqual(expect.objectContaining({ sourceId: 'mv-1-chunk-a', reason: 'duplicate_of_hard_source' }));
    expect(pack.sources.some((source) => source.sourceId === 'mv-2-chunk-b')).toBe(true);
    expect(pack.sources.some((source) => source.sourceId === 'mv-1-chunk-a')).toBe(false);
    expect(pack.sources.some((source) => source.sourceId === 'mv-1' && source.hard)).toBe(true);
  });

  it('硬前章正文无version时按正文版本ID根排除同源检索块', () => {
    context = createTestContext();
    const ids = new SequenceIds();
    const clock = new FixedClock();
    const fixture = createKnowledgeFixture(context, ids, clock);
    // 真实场景：previous_chapter_manuscript 只带 sourceId(manuscriptVersionId) 无 version，
    // 而 retrieval:manuscript 带 version(contentHash) 且 sourceId 形如 manuscriptVersionId:clusterId。
    // version 不对齐时，必须按 sourceId 根(manuscriptVersionId) 去重，否则同源重复注入。
    const pack = new ContextPackService(context.database, ids, clock).build(fixture.scope, {
      taskId: fixture.taskId, agentId: fixture.agentId, chapterId: fixture.chapterId,
      canonRevision: 0, positioningVersion: 1, tokenBudget: 1000,
      hardSources: [{ sourceType: 'previous_chapter_manuscript', sourceId: 'mv-9', content: '前章完整正史正文', reason: '前章已结算完整正文', priority: 98 }],
      optionalSources: [
        { sourceType: 'retrieval:manuscript', sourceId: 'mv-9:cluster-a', content: '前章正文片段A', reason: '同物理正文的检索子块', priority: 50, version: 'contentHash-9' },
        { sourceType: 'retrieval:manuscript', sourceId: 'mv-10:cluster-b', content: '他章正文片段', reason: '不同正文的检索子块', priority: 40, version: 'contentHash-10' }
      ]
    });
    expect(pack.excluded).toContainEqual(expect.objectContaining({ sourceId: 'mv-9:cluster-a', reason: 'duplicate_of_hard_source' }));
    expect(pack.sources.some((source) => source.sourceId === 'mv-10:cluster-b')).toBe(true);
    expect(pack.sources.some((source) => source.sourceId === 'mv-9:cluster-a')).toBe(false);
  });

  it('按正文内容指纹排除重复硬来源和重复可选来源并保留排除证据', () => {
    context = createTestContext();
    const ids = new SequenceIds();
    const clock = new FixedClock();
    const fixture = createKnowledgeFixture(context, ids, clock);
    const duplicateContent = '同一份章纲内容只应进入一次资料包';
    const pack = new ContextPackService(context.database, ids, clock).build(fixture.scope, {
      taskId: fixture.taskId, agentId: fixture.agentId, chapterId: fixture.chapterId,
      canonRevision: 0, positioningVersion: 1, tokenBudget: 1000,
      hardSources: [
        { sourceType: 'chapter_outline', sourceId: 'outline-1', content: duplicateContent, reason: '完整章纲', priority: 100 },
        { sourceType: 'planning:current_chapter', sourceId: 'outline-copy', content: duplicateContent, reason: '规划链副本', priority: 100 }
      ],
      optionalSources: [
        { sourceType: 'retrieval:outline', sourceId: 'outline-retrieval', content: duplicateContent, reason: '检索副本', priority: 50 },
        { sourceType: 'retrieval:fact', sourceId: 'fact-a', content: '独立事实', reason: '相关事实', priority: 40 },
        { sourceType: 'retrieval:fact', sourceId: 'fact-b', content: '独立事实', reason: '重复事实', priority: 30 }
      ]
    });
    expect(pack.sources.map((source) => source.sourceId)).toEqual(['outline-1', 'fact-a']);
    expect(pack.excluded).toContainEqual(expect.objectContaining({ sourceId: 'outline-copy', reason: 'duplicate_of_hard_source' }));
    expect(pack.excluded).toContainEqual(expect.objectContaining({ sourceId: 'outline-retrieval', reason: 'duplicate_of_included_source' }));
    expect(pack.excluded).toContainEqual(expect.objectContaining({ sourceId: 'fact-b', reason: 'duplicate_of_included_source' }));
  });

  it('完整前章和完整章纲已经注入时排除其尾段及检索切片', () => {
    context = createTestContext();
    const ids = new SequenceIds();
    const clock = new FixedClock();
    const fixture = createKnowledgeFixture(context, ids, clock);
    const fullPreviousChapter = '前章开头。前章中段发生冲突。前章结尾留下钩子。';
    const pack = new ContextPackService(context.database, ids, clock).build(fixture.scope, {
      taskId: fixture.taskId, agentId: fixture.agentId, chapterId: fixture.chapterId,
      canonRevision: 0, positioningVersion: 1, tokenBudget: 1000,
      hardSources: [
        { sourceType: 'chapter_outline', sourceId: 'outline-v1', content: '本章完整章纲内容', reason: '本章章纲', priority: 100 },
        { sourceType: 'previous_chapter_end', sourceId: 'previous:1', content: '前章结尾留下钩子。', reason: '前章结尾', priority: 100 },
        { sourceType: 'previous_chapter_tail', sourceId: 'manuscript-v1', content: '前章中段发生冲突。前章结尾留下钩子。', reason: '前章尾段', priority: 100 },
        { sourceType: 'previous_chapter_full', sourceId: 'manuscript-v1', content: fullPreviousChapter, reason: '前章全文', priority: 100 }
      ],
      optionalSources: [
        { sourceType: 'retrieval:outline', sourceId: 'outline-v1:cluster-a', content: '本章完整章纲内容的一部分', reason: '章纲检索切片', priority: 60 },
        { sourceType: 'retrieval:manuscript', sourceId: 'manuscript-v1:cluster-b', content: '前章中段发生冲突。', reason: '前章检索切片', priority: 50 },
        { sourceType: 'retrieval:fact', sourceId: 'fact-v1:cluster-c', content: '独立正史事实', reason: '相关事实', priority: 40 }
      ]
    });
    expect(pack.sources.map((source) => source.sourceId)).toEqual(['outline-v1', 'manuscript-v1', 'fact-v1:cluster-c']);
    expect(pack.excluded).toContainEqual(expect.objectContaining({ sourceId: 'previous:1', reason: 'duplicate_of_hard_source' }));
    expect(pack.excluded).toContainEqual(expect.objectContaining({ sourceType: 'previous_chapter_tail', reason: 'duplicate_of_hard_source' }));
    expect(pack.excluded).toContainEqual(expect.objectContaining({ sourceId: 'outline-v1:cluster-a', reason: 'duplicate_of_hard_source' }));
    expect(pack.excluded).toContainEqual(expect.objectContaining({ sourceId: 'manuscript-v1:cluster-b', reason: 'duplicate_of_hard_source' }));
  });

  it('只有前章尾段时不因版本相同误删前章其他位置的检索证据', () => {
    context = createTestContext();
    const ids = new SequenceIds();
    const clock = new FixedClock();
    const fixture = createKnowledgeFixture(context, ids, clock);
    const pack = new ContextPackService(context.database, ids, clock).build(fixture.scope, {
      taskId: fixture.taskId, agentId: fixture.agentId, chapterId: fixture.chapterId,
      canonRevision: 0, positioningVersion: 1, tokenBudget: 1000,
      hardSources: [
        { sourceType: 'previous_chapter_tail', sourceId: 'manuscript-v1', content: '前章最后的钩子。', reason: '前章尾段', priority: 100 }
      ],
      optionalSources: [
        { sourceType: 'retrieval:manuscript', sourceId: 'manuscript-v1:cluster-a', content: '前章中段的独立证据。', reason: '前章中段', priority: 50 }
      ]
    });
    expect(pack.sources.map((source) => source.sourceId)).toEqual(['manuscript-v1', 'manuscript-v1:cluster-a']);
  });
  it('每次调用保存八类稳定组合包、来源版本、纳入排除理由和预算',()=>{
    context=createTestContext();
    const ids=new SequenceIds(),clock=new FixedClock(),fixture=createKnowledgeFixture(context,ids,clock);
    const pack=new ContextPackService(context.database,ids,clock).build(fixture.scope,{
      taskId:fixture.taskId,agentId:fixture.agentId,chapterId:fixture.chapterId,
      canonRevision:0,positioningVersion:1,tokenBudget:300,characterBudget:300,
      hardSources:[
        {sourceType:'book_opening',sourceId:'opening-v2',version:'opening-v2',content:'开书方向',reason:'本书基本方向',priority:100,componentKind:'BookCorePack'},
        {sourceType:'chapter_outline',sourceId:'outline-v3',version:'outline-v3',content:'当前章必须完成明确选择',reason:'直接父级章纲',priority:100,componentKind:'ChapterTaskPack'}
      ],
      optionalSources:[
        {sourceType:'story_thread',sourceId:'thread-1',version:2,content:'未解决承诺',reason:'当前事件相关线程',priority:40,componentKind:'StoryThreadPack'},
        {sourceType:'setting_clause',sourceId:'setting-v4',version:'setting-v4',content:'低优先级但很长的可选设定'.repeat(80),reason:'相关可选设定',priority:1,componentKind:'SettingConstraintPack'}
      ]
    });
    const rows=context.database.prepare(`SELECT component_kind,source_version_ids_json,included_reasons_json,
      excluded_reasons_json,token_budget,character_budget,content_hash FROM context_pack_components
      WHERE context_pack_id=? ORDER BY component_kind`).all(pack.contextPackId) as Array<Record<string,unknown>>;
    expect(rows).toHaveLength(8);
    expect(new Set(rows.map(row=>row.component_kind))).toEqual(new Set([
      'BookCorePack','SettingConstraintPack','BookStorySpinePack','VolumeResponsibilityPack',
      'EventResponsibilityPack','ChapterTaskPack','RecentActualStatePack','StoryThreadPack'
    ]));
    const book=rows.find(row=>row.component_kind==='BookCorePack')!;
    expect(JSON.parse(String(book.source_version_ids_json))).toContain('opening-v2');
    expect(JSON.parse(String(book.included_reasons_json))).toEqual(expect.arrayContaining([
      expect.objectContaining({sourceId:'opening-v2',reason:'本书基本方向'})
    ]));
    const settings=rows.find(row=>row.component_kind==='SettingConstraintPack')!;
    expect(JSON.parse(String(settings.excluded_reasons_json))).toEqual(expect.arrayContaining([
      expect.objectContaining({sourceId:'setting-v4',reason:'character_budget_lower_priority'})
    ]));
    expect(rows.every(row=>Number(row.token_budget)>=0&&Number(row.character_budget)>=0
      &&/^[a-f0-9]{64}$/u.test(String(row.content_hash)))).toBe(true);
  });
  it('四项宏观核心全文始终进入，增加大量无关可选设定不会让任务上下文线性膨胀',()=>{
    context=createTestContext();const ids=new SequenceIds(),clock=new FixedClock(),fixture=createKnowledgeFixture(context,ids,clock);
    const insert=context.database.prepare(`INSERT INTO setting_clauses(setting_clause_id,owner_id,book_id,kind,statement,
      strength,truth_status,scope_type,scope_id,source_version_id,dependency_version_ids_json,status,created_at,updated_at)
      VALUES(?,?,?,?,?,?,'confirmed','book',?,?, '[]','active',?,?)`);
    const now=clock.now().toISOString();
    const add=(id:string,itemKey:string,statement:string,strength:'hard_fact'|'soft_reference'|'open_space')=>insert.run(id,fixture.scope.ownerId,
      fixture.scope.bookId,strength==='open_space'?'blank':strength==='hard_fact'?'fact':'direction',statement,strength,
      fixture.scope.bookId,`setting-item:${itemKey}:v1`,now,now);
    add('clause-core-world','world-stage','天空城位于永久风暴带上方。','hard_fact');
    add('clause-core-order','social-order','天空城议会按维修工时分配通行权。','hard_fact');
    add('clause-core-rule','rules-costs','古代引擎每次启动都会消耗近期记忆。','hard_fact');
    add('clause-core-blank','boundaries-blanks','地表文明真相暂时留白，不得提前解释。','open_space');
    add('clause-relevant','fuel-economy','飞行艇燃料短缺会迫使船员改变航线。','soft_reference');
    const build=()=>new ContextPackService(context!.database,ids,clock).build(fixture.scope,{
      taskId:fixture.taskId,agentId:fixture.agentId,chapterId:fixture.chapterId,canonRevision:0,positioningVersion:1,
      tokenBudget:2000,characterBudget:2000,hardSources:[{sourceType:'chapter_work_order',sourceId:'outline-fuel',
        content:'本章围绕飞行艇燃料短缺展开，主角必须决定是否改变航线。',reason:'当前章任务',priority:100}],optionalSources:[]});
    const before=build();
    for(let index=1;index<=40;index+=1)add(`clause-unrelated-${index}`,`remote-custom-${index}`,
      `第${index}处远方岛屿使用独立的礼仪称谓和节庆颜色。`,'soft_reference');
    const after=build();
    const settingIds=(pack:ReturnType<typeof build>)=>pack.sources.filter(source=>source.componentKind==='SettingConstraintPack')
      .map(source=>source.sourceId).sort();
    expect(settingIds(before)).toEqual(['clause-core-blank','clause-core-order','clause-core-rule','clause-core-world','clause-relevant']);
    expect(settingIds(after)).toEqual(settingIds(before));
    expect(after.totalCharacters).toBe(before.totalCharacters);
    expect(after.sources.some(source=>source.sourceId.startsWith('clause-unrelated-'))).toBe(false);
  });
});
