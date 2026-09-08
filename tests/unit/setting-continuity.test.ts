import { describe, expect, it } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { reviewSettingContinuity, continuityHash, continuitySourceHash, continuitySources, continuitySourceText, type ContinuitySource } from '../../apps/api/src/application/books/setting-continuity.js';
import { activeSettingVersions } from '../../apps/api/src/infrastructure/db/repositories/setting-version-selection.js';

describe('设定变更与旧主题归并',()=>{
  const sources:ContinuitySource[]=[{id:'s1',kind:'setting',label:'旧规则',text:'只有拿到通行证才可入城'},
    {id:'v1',kind:'planning',label:'第一卷',text:'计划伪造通行证入城'},
    {id:'v2',kind:'planning',label:'第二卷',text:'计划成为守城官'},
    {id:'c1',kind:'actual',label:'第一章',text:'张三拿着通行证入了城。'}];
  it('两卷规划和定稿分别核对，冲突不得被计数或通过格式掩盖',async()=>{
    const original=JSON.stringify(sources);
    const report=await reviewSettingContinuity({sources,candidate:'任何人都不能入城',generate:async(prompt)=>JSON.stringify({
      change:'fact',covered:false,conflicts:[{problem:prompt.includes('"kind":"actual"')?'定稿已经入城':'规则含义改变',suggestion:'保留持证入城条件'}]})});
    expect(report.checkedSources).toBe(4);expect(report.findings.some(f=>f.kind==='actual')).toBe(true);
    expect(report.mergedVersionIds).toEqual([]);expect(JSON.stringify(sources)).toBe(original);
    expect(report.sourceHash).not.toBe(continuitySourceHash([...sources,{...sources[0]!,id:'new'}]));
  });
  it('无语义变化保留覆盖凭证，变化来源使凭证过期',async()=>{
    const report=await reviewSettingContinuity({sources,candidate:'持通行证方可入城',generate:async()=>JSON.stringify({change:'wording',covered:true,conflicts:[]})});
    expect(report.findings).toEqual([]);expect(report.mergedVersionIds).toEqual(['s1']);
    expect(report.checkedSources).toBe(1);
    expect(report.candidateHash).not.toBe(continuityHash('人人可入城'));
  });
  it('不完整报告有限重试后失败，不伪装通过',async()=>{
    let calls=0;
    await expect(reviewSettingContinuity({sources,candidate:'规则',generate:async()=>{calls++;return '{"change":"wording","covered":false,"conflicts":[]}';}})).rejects.toThrow('不完整');
    expect(calls).toBe(2);
  });
  it('分页原文全覆盖，已完成检查使用稳定调用键',async()=>{
    const pages:string[]=[];const keys:string[]=[];
    const input={sources:[{...sources[0]!,text:'甲'.repeat(6_000)+'最后的例外'}],candidate:'候选',generate:async(prompt:string,key:string)=>{
      pages.push(prompt);keys.push(key);return '{"change":"wording","covered":true,"conflicts":[]}';}};
    await reviewSettingContinuity(input);await reviewSettingContinuity(input);
    expect(pages[1]).toContain('最后的例外');expect(keys.slice(0,2)).toEqual(keys.slice(2));
  });
  it('只隐藏已确认完整承接的旧版本，后续修改旧项自动重新出现',()=>{
    const old={item_key:'world-layer',version_id:'old',content_json:'{}'};
    const canonical={item_key:'geography',version_id:'new',content_json:JSON.stringify({rules:[{}],continuity:{findings:[],mergedVersionIds:['old']}})};
    expect(activeSettingVersions([old,canonical])).toEqual([canonical]);
    expect(activeSettingVersions([{...old,version_id:'updated'},canonical])).toHaveLength(2);
    expect(activeSettingVersions([{...old,item_key:'abilities'},canonical])).toHaveLength(2);
  });
  it('有明确作者取舍才合并改变的旧规则，正文冲突不能借此隐藏',()=>{
    const old={item_key:'world-layer',version_id:'old',content_json:'{}'};
    const data={rules:[{}],continuity:{findings:[{kind:'setting',sourceId:'old'}],mergedVersionIds:[]}};
    const row={item_key:'geography',version_id:'new',content_json:JSON.stringify(data)};
    expect(activeSettingVersions([old,row])).toHaveLength(2);
    row.content_json=JSON.stringify({...data,authorRuleDecision:'adopt_changed_rules'});
    expect(activeSettingVersions([old,row])).toEqual([row]);
    data.continuity.findings.push({kind:'actual',sourceId:'chapter'});
    row.content_json=JSON.stringify({...data,authorRuleDecision:'adopt_changed_rules'});
    expect(activeSettingVersions([old,row])).toHaveLength(2);
  });
  it('两卷与定稿按归属读取，元数据和完整包指纹一致；换说法不加载正文',async()=>{
    const db=new DatabaseSync(':memory:');
    try {
      db.exec(`CREATE TABLE v7_setting_items(owner_id,book_id,item_key,item_label);
        CREATE TABLE v7_setting_item_versions(version_id,owner_id,book_id,item_key,content_json,status,revision);
        CREATE TABLE v7_planning_tree_heads(owner_id,book_id,confirmed_version_id,candidate_version_id);
        CREATE TABLE v7_planning_tree_versions(tree_version_id,owner_id,book_id,tree_kind,scope_id,content_json,content_hash,lifecycle);
        CREATE TABLE v7_manuscript_versions(manuscript_version_id,owner_id,book_id,chapter_number,lifecycle,content_text,content_hash);
        CREATE TABLE book_opening_blueprints(opening_blueprint_id,owner_id,book_id,status,blueprint_json,content_hash);`);
      db.prepare('INSERT INTO v7_setting_items VALUES(?,?,?,?)').run('o','b','geography','地理');
      db.prepare('INSERT INTO v7_setting_item_versions VALUES(?,?,?,?,?,?,?)').run('s','o','b','geography',JSON.stringify({finalContent:'有证才可入城'}),'confirmed',1);
      for(const id of ['vol1','vol2']) {
        db.prepare('INSERT INTO v7_planning_tree_heads VALUES(?,?,?,?)').run('o','b',id,null);
        db.prepare('INSERT INTO v7_planning_tree_versions VALUES(?,?,?,?,?,?,?,?)').run(id,'o','b','volume',id,'{"plan":"持证入城"}',id+'hash','confirmed');
      }
      db.prepare('INSERT INTO v7_manuscript_versions VALUES(?,?,?,?,?,?,?)').run('chapter','o','b',1,'final','持证入城了。','chapterhash');
      db.prepare('INSERT INTO v7_manuscript_versions VALUES(?,?,?,?,?,?,?)').run('private','other','b',1,'final','他人私密正文','privatehash');
      const before=db.prepare('SELECT * FROM v7_manuscript_versions').all();
      const metadata=continuitySources(db,'o','b','geography',false);
      const full=continuitySources(db,'o','b','geography');
      expect(metadata.map(s=>s.id)).toEqual(['s','vol1','vol2','chapter']);
      expect(continuitySourceHash(metadata)).toBe(continuitySourceHash(full));
      expect(()=>continuitySourceText(db,'o','b',{id:'private',kind:'actual',label:'',text:''})).toThrow('不属于');
      const read:string[]=[];
      await reviewSettingContinuity({sources:metadata,candidate:'持证方可入城',readText:source=>{read.push(source.id);return continuitySourceText(db,'o','b',source);},generate:async()=>'{"change":"wording","covered":true,"conflicts":[]}'});
      expect(read).toEqual(['s']);
      expect(db.prepare('SELECT * FROM v7_manuscript_versions').all()).toEqual(before);
      db.prepare('UPDATE v7_manuscript_versions SET content_hash=? WHERE manuscript_version_id=?').run('changed','chapter');
      expect(continuitySourceHash(continuitySources(db,'o','b','geography',false))).not.toBe(continuitySourceHash(metadata));
    }finally{db.close();}
  });
});
