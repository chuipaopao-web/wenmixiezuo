import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { afterEach, expect, it, vi } from 'vitest';
import { V7BookDesignCardService, parseBookDesignCard, bookCardFragments, BookCardSourceIssues } from '../../apps/api/src/application/planning/v7-book-design-card-service.js';
import { planningPromptSnapshot, type V7PlanningCompiledSnapshot } from '../../apps/api/src/application/planning/v7-planning-source-compiler.js';
const dbs:DatabaseSync[]=[];
afterEach(()=>dbs.splice(0).forEach(db=>db.close()));
function setup(){const db=new DatabaseSync(':memory:');dbs.push(db);db.exec(readFileSync('apps/api/src/infrastructure/db/migrations/0112_book_design_cards.sql','utf8'));return {db,service:new V7BookDesignCardService(db)};}
function snapshot(ownerId='owner-a', bookId='book-a',version='1'):V7PlanningCompiledSnapshot{return {snapshotId:'snapshot',ownerId,bookId,treeKind:'book',scopeId:'book',purpose:'recipe_design',sourceFingerprint:version,
  sources:[{sourceKind:'opening',sourceId:'opening',sourceVersion:version,authority:'formal',label:'开书资料',content:{name:'林舟',ability:'无灵根；蓝图制造需要材料'},contentHash:version,includedReason:'已确认'}],excludedSources:[],excludedSourceDecisions:[],createdAt:'2026-09-09T00:00:00.000Z'};}
const card=()=>({intent:[],protagonists:[{text:'林舟没有灵根。',refs:['F1','F2']}],hook:[{text:'蓝图制造需要材料。',refs:['F2']}],world:[],rules:[],requirements:[]});
it('来源版本不变缓存复用，跨书跨账号不共用，源更新重建且原文不改',async()=>{
  const {service}=setup();const s=snapshot();const before=JSON.stringify(s);const generate=vi.fn(async()=>JSON.stringify(card()));
  const first=await service.prepare(s,generate);await service.prepare(s,generate);expect(generate).toHaveBeenCalledTimes(2);
  expect(JSON.stringify(s)).toBe(before);expect(planningPromptSnapshot(first)).toHaveProperty('bookDesignCard');
  await service.prepare(snapshot('owner-a','book-b'),generate);await service.prepare(snapshot('owner-b','book-a'),generate);
  await service.prepare(snapshot('owner-a','book-a','2'),generate);expect(generate).toHaveBeenCalledTimes(8);
});
it('拒绝未知引用、遗漏栏目和超长卡，不截断内容；失败后仍可继续',async()=>{
  const refs=new Set(['F1','F2']);const invalid=card();invalid.hook[0]!.refs=['foreign'];
  expect(()=>parseBookDesignCard(JSON.stringify(invalid),refs)).toThrow('来源');
  expect(()=>parseBookDesignCard('{}',refs)).toThrow('六个');
  const long=card();long.hook[0]!.text='条件'.repeat(1800);expect(()=>parseBookDesignCard(JSON.stringify(long),refs)).toThrow('过长');
  const {service}=setup();const bad=vi.fn(async()=>JSON.stringify(invalid));await expect(service.prepare(snapshot(),bad)).rejects.toThrow('尚未整理');expect(bad).toHaveBeenCalledTimes(2);
  expect((await service.prepare(snapshot(),async()=>JSON.stringify(card()))).bookDesignCard?.text).toContain('需要材料');
});
it('长字符串分页不丢字符，最后一页保留信息',()=>{
  const s=snapshot();s.sources[0]!.content={text:'甲'.repeat(12000)+'末尾关键条件'};
  const fs=bookCardFragments(s);expect(fs.map(f=>f.text).join('')).toBe((s.sources[0]!.content as {text:string}).text);
  expect(fs.at(-1)?.text).toContain('末尾关键条件');
});
it('同来源并发读取只启动一次整理',async()=>{
  const {service}=setup();const generate=vi.fn(async()=>JSON.stringify(card()));
  await Promise.all([service.prepare(snapshot(),generate),service.prepare(snapshot(),generate)]);expect(generate).toHaveBeenCalledTimes(2);
});
it('明确来源冲突交由作者处理，不当作格式错误重复生成',async()=>{
  const {service}=setup();const generate=vi.fn(async()=>JSON.stringify({sourceIssues:['主角姓名在两份正式资料中不一致']}));
  await expect(service.prepare(snapshot(),generate)).rejects.toBeInstanceOf(BookCardSourceIssues);
  expect(generate).toHaveBeenCalledTimes(1);
});
it('全部空栏不能发布为有效短卡',async()=>{
  const {service}=setup();const empty={intent:[],protagonists:[],hook:[],world:[],rules:[],requirements:[]};
  await expect(service.prepare(snapshot(),async()=>JSON.stringify(empty))).rejects.toThrow('未提取到有效信息');
});
