import {DatabaseSync} from 'node:sqlite';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
const [root,path]=process.argv.slice(2);
const {CreativeReferenceAdminRepository}=await import(pathToFileURL(resolve(root,'apps/api/dist/infrastructure/db/repositories/creative-reference-admin-repository.js')).href);
const db=new DatabaseSync(path,{readOnly:true});try{
 const repo=new CreativeReferenceAdminRepository(db),filters={assetKind:'method',availabilities:['draft','reviewed','published'],limit:100};
 const rows=db.prepare("SELECT asset_kind,status,count(*) n FROM creative_reference_cards WHERE legacy_namespace IN ('r209-c1','r209-c2') GROUP BY asset_kind,status").all();
 const active=rows.filter(r=>r.asset_kind==='method'&&r.status!=='retired').reduce((a,r)=>a+Number(r.n),0);
 const retired=rows.find(r=>r.asset_kind==='method'&&r.status==='retired');if(active!==349||retired?.n!==5)throw Error('方法数量不符');
 const queries={};for(const usageTree of ['题材与融合','卖点与阅读体验','人物与关系','故事与因果','结构与节奏','信息与表达','衔接与收束','审查与修订','群像','核心吸引力']){const page=repo.listSummaries({...filters,usageTree});if(!page.items.length)throw Error('分类空 '+usageTree);queries[usageTree]=page.items.length;}
 const old=repo.listSummaries({...filters,keyword:'法219'});if(!old.items.length||old.items.some(x=>x.availability==='retired'))throw Error('旧号查询失败');
 const stage=repo.listSummaries({...filters,usageTree:'核心吸引力',layers:['opening']});if(!stage.items.length)throw Error('用途阶段组合失败');
 const integrity=db.prepare('PRAGMA quick_check').get();if(Object.values(integrity)[0]!=='ok')throw Error('数据库检查失败');
 console.log(JSON.stringify({active,retired:retired.n,rows,queries,oldNumber:old.items.map(x=>({code:x.displayCode,name:x.name})),stageMatches:stage.items.length,integrity}));
}finally{db.close();}
