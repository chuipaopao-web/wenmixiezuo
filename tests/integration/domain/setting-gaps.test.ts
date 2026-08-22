import {afterEach,describe,expect,it} from 'vitest';
import {SettingGapService} from '../../../apps/api/src/application/knowledge/setting-gap-service.js';
import {parseDetectedSettingGaps,stopForDetectedSettingGaps} from '../../../apps/api/src/application/planning/setting-gap-detection.js';
import {SettingGapRepository} from '../../../apps/api/src/infrastructure/db/repositories/setting-gap-repository.js';
import {UnitOfWork} from '../../../apps/api/src/infrastructure/db/unit-of-work.js';
import {initializeDomainBook} from '../../helpers/domain-fixture.js';
import {createTestContext,FixedClock,SequenceIds,type TestContext} from '../../helpers/test-context.js';

describe('按需补设定三选一',()=>{
  let context:TestContext|undefined;afterEach(()=>context?.close());
  it('发现缺口不会猜成事实，作者可选择当前层不用、保持未知或现在补设计',()=>{
    context=createTestContext();const ids=new SequenceIds(),clock=new FixedClock();
    const first=initializeDomainBook(context,context.config.ownerId,ids,clock,{title:'按需设定书'});
    const second=initializeDomainBook(context,context.config.ownerId,ids,clock,{title:'隔离书'});
    const scope={ownerId:context.config.ownerId,bookId:first.bookId};
    const service=new SettingGapService(new SettingGapRepository(context.database),new UnitOfWork(context.database),ids,clock);
    const unknown=service.discover(scope,{scopeType:'event',scopeId:'event-7',question:'禁区中的时间是否流动？',
      whyNeeded:'当前事件需要决定人物能否等待救援。',affectedObjects:['事件7','后续章链']});
    expect(unknown).toMatchObject({status:'pending',decision:null});
    expect(service.discover(scope,{scopeType:'event',scopeId:'event-7',question:'禁区中的时间是否流动？',
      whyNeeded:'当前事件需要决定人物能否等待救援。'}).gapId).toBe(unknown.gapId);
    expect(service.decide(scope,unknown.gapId,{decision:'keep_unknown'})).toMatchObject({status:'decided',decision:'keep_unknown'});
    expect(context.database.prepare(`SELECT kind,strength,scope_type,scope_id,statement FROM setting_clauses
      WHERE owner_id=? AND book_id=? AND source_version_id=?`).get(scope.ownerId,scope.bookId,`setting-gap:${unknown.gapId}`))
      .toEqual({kind:'blank',strength:'open_space',scope_type:'event',scope_id:'event-7',statement:'保持未知：禁区中的时间是否流动？'});

    const unused=service.discover(scope,{scopeType:'volume',scopeId:'volume-1',question:'是否存在跨国传送阵？',
      whyNeeded:'卷候选曾尝试用传送阵跳过旅程。'});
    service.decide(scope,unused.gapId,{decision:'not_used_this_volume'});
    expect(context.database.prepare(`SELECT kind,strength,scope_type,scope_id FROM setting_clauses
      WHERE owner_id=? AND book_id=? AND source_version_id=?`).get(scope.ownerId,scope.bookId,`setting-gap:${unused.gapId}`))
      .toEqual({kind:'boundary',strength:'current_task',scope_type:'volume',scope_id:'volume-1'});

    const design=service.discover(scope,{scopeType:'chapter',scopeId:'chapter-12',question:'旧印记的代价是什么？',
      whyNeeded:'第一场使用即将发生。'});
    expect(service.decide(scope,design.gapId,{decision:'design_now'})).toMatchObject({status:'needs_setting',decision:'design_now'});
    expect(service.decide(scope,design.gapId,{decision:'design_now',resolvedSettingVersionId:'setting-item:rules-costs:v3'}))
      .toMatchObject({status:'decided',resolvedSettingVersionId:'setting-item:rules-costs:v3'});
    const otherScope={ownerId:context.config.ownerId,bookId:second.bookId};
    expect(()=>service.decide(otherScope,unknown.gapId,{decision:'keep_unknown'})).toThrow('不存在或不属于当前书籍');
  });

  it('AI只有报告真正阻塞的必要设定时才创建缺口并暂停，重复输出不会重复记录',()=>{
    context=createTestContext();const ids=new SequenceIds(),clock=new FixedClock();
    const book=initializeDomainBook(context,context.config.ownerId,ids,clock,{title:'AI按需补设定'});
    const scope={ownerId:context.config.ownerId,bookId:book.bookId};
    const service=new SettingGapService(new SettingGapRepository(context.database),new UnitOfWork(context.database),ids,clock);
    expect(parseDetectedSettingGaps('{"settingGaps":[]}')).toEqual([]);
    const output='模型说明：```json\n'+JSON.stringify({settingGaps:[{
      question:'古代引擎首次启动会失去哪段记忆？',
      whyNeeded:'当前事件的核心选择取决于主角是否愿意承担这次具体代价。',
      affectedObjects:['当前事件','首卷前三章责任']
    }]})+'\n```';
    expect(parseDetectedSettingGaps(output)).toEqual([expect.objectContaining({
      question:'古代引擎首次启动会失去哪段记忆？',affectedObjects:['当前事件','首卷前三章责任']
    })]);
    const stop=()=>stopForDetectedSettingGaps({output,service,scope,scopeType:'event',scopeId:'event-1'});
    expect(stop).toThrow(/请先选择/);
    expect(service.list(scope)).toEqual([expect.objectContaining({
      scopeType:'event',scopeId:'event-1',status:'pending',decision:null,
      question:'古代引擎首次启动会失去哪段记忆？'
    })]);
    expect(stop).toThrow(/请先选择/);
    expect(service.list(scope)).toHaveLength(1);
  });
});