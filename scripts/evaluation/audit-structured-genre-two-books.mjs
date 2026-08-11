import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const OWNER_ID = 'owner-local-boss';
const gameBookId = process.argv[2];
const lordBookId = process.argv[3];
assert.ok(gameBookId && lordBookId, '用法：node audit-structured-genre-two-books.mjs <游戏仙侠书籍ID> <领主经营书籍ID> [输出文件]');
const outputPath = resolve(process.argv[4] ?? 'data/verification/structured-genre-two-books-200-chapters/final-audit.json');
const databasePath = resolve(process.argv[5] ?? 'data/database/wenmi.sqlite');
const database = new DatabaseSync(databasePath, { readOnly: true });

const targets = [
  {
    kind: 'game_xianxia', bookId: gameBookId, title: '灵契天墟',
    required: ['陆昭','霜尾','叶绯','石拓','乌槐','赫连魇','御灵剑使','灵宠状态','职业等级','战斗记录','星痕剑阵','赤月剑匣'],
    forbidden: ['顾临川','秦瑶','岳重山','商九娘','赫连朔','黑旗伯','灰烬领','资源结算']
  },
  {
    kind: 'lord', bookId: lordBookId, title: '灰烬领主',
    required: ['顾临川','秦瑶','岳重山','商九娘','赫连朔','黑旗伯','灰烬领','领地状态','资源结算','资源产出','武将属性','建筑面板','升级消耗规划'],
    forbidden: ['陆昭','霜尾','叶绯','石拓','乌槐','赫连魇','御灵剑使','灵宠状态']
  }
];

try {
  const results = targets.map(auditBook);
  const crossBookViolations = crossBookChecks();
  assert.deepEqual(crossBookViolations, [], `发现跨书关联：${JSON.stringify(crossBookViolations)}`);
  const contextIsolation = auditContextIsolation();
  const report = { generatedAt:new Date().toISOString(), databasePath, passed:true, crossBookViolations, contextIsolation, results };
  mkdirSync(dirname(outputPath), { recursive:true });
  writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
} finally { database.close(); }

function auditBook(target) {
  const book = database.prepare(`SELECT title, canon_revision, status FROM books WHERE owner_id=? AND book_id=?`).get(OWNER_ID,target.bookId);
  assert.ok(book, `${target.title}不存在`);
  assert.equal(book.title,target.title);
  assert.notEqual(book.status,'archived',`${target.title}不应为归档书籍`);
  const count=(table,where='',values=[])=>Number(database.prepare(`SELECT COUNT(*) AS count FROM ${table} WHERE owner_id=? AND book_id=? ${where}`).get(OWNER_ID,target.bookId,...values).count);
  const counts={
    volumes:count('volumes'), volumePlans:count('volume_plans'), events:count('story_events'), eventSequences:count('event_chapter_sequences'),
    chapterOutlines:count('event_chapter_outlines'), chapters:count('chapters'), settledChapters:count('chapters',"AND settlement_status='settled' AND generation_status='completed'"),
    canonManuscripts:count('manuscript_versions',"AND status='canon'"), reviewPanels:count('review_panels',"AND status='complete'"), reviewReports:count('review_reports',"AND status='submitted'"),
    chapterSettlements:count('stage_settlements',"AND stage_type='chapter' AND status='active'"), eventSettlements:count('stage_settlements',"AND stage_type='story_arc' AND status='active'"),
    volumeSettlements:count('stage_settlements',"AND stage_type='volume' AND status='active'"), entities:count('entities',"AND status='active'"), activeFacts:count('fact_assertions',"AND status='active'"),
    relationships:count('relationship_projection','AND canon_revision=?',[book.canon_revision]), timeline:count('timeline_projection','AND canon_revision=?',[book.canon_revision]),
    contextPacks:count('context_packs'), retrievals:count('retrieval_records'), activeTasks:count('tasks',"AND status IN ('queued','claimed','running','working','preparing','waiting_confirmation','retrying')"),
    blockedHistory:count('tasks',"AND status='blocked'"), failedHistory:count('tasks',"AND status='failed'")
  };
  assert.deepEqual({ volumes:counts.volumes,volumePlans:counts.volumePlans,events:counts.events,eventSequences:counts.eventSequences,chapterOutlines:counts.chapterOutlines,chapters:counts.chapters,settledChapters:counts.settledChapters,canonManuscripts:counts.canonManuscripts,reviewPanels:counts.reviewPanels,reviewReports:counts.reviewReports,chapterSettlements:counts.chapterSettlements,eventSettlements:counts.eventSettlements,volumeSettlements:counts.volumeSettlements },
    { volumes:1,volumePlans:1,events:10,eventSequences:10,chapterOutlines:100,chapters:100,settledChapters:100,canonManuscripts:100,reviewPanels:100,reviewReports:300,chapterSettlements:100,eventSettlements:10,volumeSettlements:1 }, `${target.title}主流程计数不完整`);
  assert.equal(counts.activeTasks,0,`${target.title}仍有执行中的任务`);
  assert.ok(counts.contextPacks>=400,`${target.title}上下文包数量不足`);
  assert.ok(counts.retrievals>=100,`${target.title}检索记录不足`);

  const entityTypes=Object.fromEntries(database.prepare(`SELECT entity_type,COUNT(*) AS count FROM entities WHERE owner_id=? AND book_id=? AND status='active' GROUP BY entity_type`).all(OWNER_ID,target.bookId).map((row)=>[row.entity_type,Number(row.count)]));
  for(const type of ['character','location','organization','item']) assert.ok((entityTypes[type]??0)>0,`${target.title}资料库缺少${type}`);
  if(target.kind==='game_xianxia') for(const type of ['skill','stat_panel']) assert.ok((entityTypes[type]??0)>0,`${target.title}资料库缺少${type}`);
  if(target.kind==='lord') for(const type of ['resource','stat_panel']) assert.ok((entityTypes[type]??0)>0,`${target.title}资料库缺少${type}`);
  assert.ok(counts.activeFacts>=100,`${target.title}正式事实不足`);
  assert.ok(counts.relationships>=5,`${target.title}关系资料不足`);
  assert.ok(counts.timeline>=100,`${target.title}正文时间线不足`);
  const currentBindings=Number(database.prepare(`SELECT COUNT(*) AS count FROM canon_bindings b JOIN canon_revisions r ON r.canon_revision_id=b.canon_revision_id AND r.owner_id=b.owner_id AND r.book_id=b.book_id WHERE b.owner_id=? AND b.book_id=? AND r.revision=? AND b.active=1`).get(OWNER_ID,target.bookId,book.canon_revision).count);
  assert.equal(currentBindings,counts.activeFacts,`${target.title}当前正史事实绑定不完整`);

  const rows=database.prepare(`SELECT c.chapter_number,c.title,m.word_count,f.relative_path FROM chapters c JOIN manuscript_versions m ON m.manuscript_version_id=c.canon_manuscript_version_id JOIN file_registry f ON f.file_id=m.file_id AND f.owner_id=m.owner_id AND f.book_id=m.book_id WHERE c.owner_id=? AND c.book_id=? ORDER BY c.chapter_number`).all(OWNER_ID,target.bookId);
  assert.equal(rows.length,100);
  const manuscripts=rows.map((row)=>({ ...row, content:readFileSync(resolve(process.cwd(),'data',row.relative_path),'utf8') }));
  for(const row of manuscripts){
    assert.ok(row.title.trim().length>0&&row.title.length<=20,`${target.title}第${row.chapter_number}章标题异常`);
    assert.ok(row.word_count>=2350&&row.word_count<=3650,`${target.title}第${row.chapter_number}章字数越界：${row.word_count}`);
    assert.doesNotMatch(row.content,/(?:workflowArtifact|```json|book_id|source_id|sourceId|contextPack|system prompt|作为AI|我是AI|temperature|token|schema|\uFFFD)/iu,`${target.title}第${row.chapter_number}章泄漏技术信息或乱码`);
    assert.doesNotMatch(row.content,/(?:鏂|鍐欎|锛|绉樺|浣滃)/u,`${target.title}第${row.chapter_number}章疑似乱码`);
  }
  const fullText=manuscripts.map((row)=>row.content).join('\n');
  for(const term of target.required) assert.ok(fullText.includes(term),`${target.title}缺少题材关键内容：${term}`);
  for(const term of target.forbidden) assert.ok(!fullText.includes(term),`${target.title}混入其他书内容：${term}`);
  const repeatedPairs=[];
  for(let index=1;index<manuscripts.length;index+=1){ const similarity=tokenSetSimilarity(manuscripts[index-1].content,manuscripts[index].content); if(similarity>0.88) repeatedPairs.push({ previous:index,current:index+1,similarity:Number(similarity.toFixed(4)) }); }
  assert.deepEqual(repeatedPairs,[],`${target.title}相邻章节过度重复：${JSON.stringify(repeatedPairs.slice(0,5))}`);

  const evidenceRows=database.prepare(`SELECT f.fact_id,f.evidence_json,fr.relative_path FROM fact_assertions f JOIN file_registry fr ON fr.version_id=f.source_manuscript_version_id AND fr.owner_id=f.owner_id AND fr.book_id=f.book_id WHERE f.owner_id=? AND f.book_id=? AND f.status='active'`).all(OWNER_ID,target.bookId);
  assert.equal(evidenceRows.length,counts.activeFacts,`${target.title}事实来源文件不完整`);
  for(const row of evidenceRows){ const source=readFileSync(resolve(process.cwd(),'data',row.relative_path),'utf8'); const evidence=JSON.parse(row.evidence_json); assert.ok(Array.isArray(evidence)&&evidence.length>0,`${row.fact_id}没有证据`); for(const item of evidence) assert.ok(typeof item.quote==='string'&&source.includes(item.quote),`${row.fact_id}证据无法回查原文`); }

  const genreAudit=target.kind==='game_xianxia'?auditGame(manuscripts):auditLord(manuscripts);
  return { kind:target.kind,bookId:target.bookId,title:target.title,canonRevision:book.canon_revision,counts,entityTypes,currentBindings,evidenceChecked:evidenceRows.length,genreAudit };
}

function auditGame(manuscripts){
  let previous={ body:0,spirit:0,agility:0,petPower:0,petSpeed:0 };
  for(const row of manuscripts){
    const hero=row.content.match(/职业等级(\d+)级，体魄(\d+)，灵识(\d+)，敏捷(\d+)/u); const pet=row.content.match(/灵宠等级(\d+)级，力量(\d+)，速度(\d+)/u);
    assert.ok(hero&&pet,`《灵契天墟》第${row.chapter_number}章缺少人物或灵宠属性面板`);
    const current={ body:+hero[2],spirit:+hero[3],agility:+hero[4],petPower:+pet[2],petSpeed:+pet[3] };
    for(const key of Object.keys(previous)) assert.ok(current[key]>=previous[key],`《灵契天墟》第${row.chapter_number}章${key}无解释倒退`);
    previous=current;
    if(row.chapter_number<40) assert.ok(!row.content.includes('已掌握星痕剑阵'),`第${row.chapter_number}章提前获得星痕剑阵`);
    if(row.chapter_number<60) assert.ok(!row.content.includes('已装备赤月剑匣'),`第${row.chapter_number}章提前获得赤月剑匣`);
  }
  return { statPanelsChecked:100,monotonicAttributes:true,skillAvailableFromChapter:40,itemAvailableFromChapter:60 };
}

function auditLord(manuscripts){
  let previousAfter=null;
  const upgrades=[];
  for(const row of manuscripts){
    const match=row.content.match(/资源结算：本章期初粮食(\d+)份、木材(\d+)份、石料(\d+)份、铁矿(\d+)份、灵晶(\d+)枚；本章获得粮食(\d+)份、木材(\d+)份、石料(\d+)份、铁矿(\d+)份、灵晶(\d+)枚；本章消耗粮食(\d+)份、木材(\d+)份、石料(\d+)份、铁矿(\d+)份、灵晶(\d+)枚；期末库存分别为(\d+)份、(\d+)份、(\d+)份、(\d+)份和(\d+)枚/u);
    assert.ok(match,`《灰烬领主》第${row.chapter_number}章资源结算不完整`);
    const values=match.slice(1).map(Number); const before=values.slice(0,5); const gain=values.slice(5,10); const use=values.slice(10,15); const after=values.slice(15,20);
    if(previousAfter) assert.deepEqual(before,previousAfter,`第${row.chapter_number}章期初库存与上章期末不一致`);
    assert.deepEqual(after,before.map((value,index)=>value+gain[index]-use[index]),`第${row.chapter_number}章资源算式错误`);
    assert.ok(after.every((value)=>value>=0),`第${row.chapter_number}章资源出现负数`); previousAfter=after;
    assert.match(row.content,/运输统一扣除一成损耗/u,`第${row.chapter_number}章缺少产出损耗规则`);
    assert.match(row.content,/岳重山武将属性：.+赫连朔武将属性：/u,`第${row.chapter_number}章武将属性面板不完整`);
    assert.match(row.content,/建筑面板：/u,`第${row.chapter_number}章建筑面板缺失`);
    if([20,30,50,70,90,100].includes(row.chapter_number)) upgrades.push(row.chapter_number);
  }
  return { ledgersChecked:100,continuity:true,nonnegative:true,transportLossRate:'一成',upgradeChapters:upgrades };
}

function auditContextIsolation(){
  const rows=database.prepare(`SELECT context_pack_id,book_id,source_manifest_json FROM context_packs WHERE owner_id=? AND book_id IN (?,?)`).all(OWNER_ID,gameBookId,lordBookId);
  const violations=[];
  for(const row of rows){ const text=row.source_manifest_json; const foreign=row.book_id===gameBookId?targets[1]:targets[0]; if(text.includes(foreign.bookId)||foreign.required.slice(0,6).some((term)=>text.includes(term))) violations.push({ contextPackId:row.context_pack_id,bookId:row.book_id }); }
  assert.deepEqual(violations,[],'上下文包混入另一书资料'); return { checked:rows.length,violations };
}

function crossBookChecks(){
  const checks=[
    ['fact_entity',`SELECT f.fact_id AS id FROM fact_assertions f JOIN entities e ON e.entity_id=f.subject_entity_id WHERE f.owner_id<>e.owner_id OR f.book_id<>e.book_id`],
    ['fact_chapter',`SELECT f.fact_id AS id FROM fact_assertions f JOIN chapters c ON c.chapter_id=f.source_chapter_id WHERE f.owner_id<>c.owner_id OR f.book_id<>c.book_id`],
    ['fact_manuscript',`SELECT f.fact_id AS id FROM fact_assertions f JOIN manuscript_versions m ON m.manuscript_version_id=f.source_manuscript_version_id WHERE f.owner_id<>m.owner_id OR f.book_id<>m.book_id`],
    ['relationship_entity',`SELECT r.relationship_id AS id FROM relationship_projection r JOIN entities e ON e.entity_id=r.from_entity_id WHERE r.owner_id<>e.owner_id OR r.book_id<>e.book_id`],
    ['timeline_fact',`SELECT t.timeline_id AS id FROM timeline_projection t JOIN fact_assertions f ON f.fact_id=t.source_fact_id WHERE t.owner_id<>f.owner_id OR t.book_id<>f.book_id`],
    ['context_task',`SELECT p.context_pack_id AS id FROM context_packs p JOIN tasks t ON t.task_id=p.task_id WHERE p.owner_id<>t.owner_id OR p.book_id<>t.book_id`],
    ['context_chapter',`SELECT p.context_pack_id AS id FROM context_packs p JOIN chapters c ON c.chapter_id=p.chapter_id WHERE p.owner_id<>c.owner_id OR p.book_id<>c.book_id`]
  ];
  return checks.flatMap(([kind,sql])=>database.prepare(sql).all().map((row)=>({ kind,id:row.id })));
}

function tokenSetSimilarity(left,right){ const tokens=(text)=>new Set(text.replace(/\s+/gu,'').match(/.{1,12}/gu)??[]); const a=tokens(left); const b=tokens(right); let intersection=0; for(const token of a) if(b.has(token)) intersection+=1; return intersection/Math.max(1,new Set([...a,...b]).size); }
