import { DatabaseSync } from 'node:sqlite';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
const [root,path]=process.argv.slice(2);
if(!root||!path)throw Error('需要release源码与数据库路径');
const {CreativeReferenceAdminRepository}=await import(pathToFileURL(resolve(root,'apps/api/dist/infrastructure/db/repositories/creative-reference-admin-repository.js')).href);
const db=new DatabaseSync(path,{readOnly:true});
try{
 const repo=new CreativeReferenceAdminRepository(db);
 const rows=db.prepare("SELECT asset_kind,status,count(*) n FROM creative_reference_cards WHERE legacy_namespace='r209-c1' GROUP BY asset_kind,status").all();
 const method=repo.listSummaries({assetKind:'method',limit:30});
 const genre=repo.listSummaries({assetKind:'reference',usageTree:'题材与融合',limit:100});
 const three=repo.listSummaries({assetKind:'reference',keyword:'三国与职业脑洞',limit:30});
 if(!method.items.length||!genre.items.length||!three.items.length)throw Error('后台查询未返回预期内容');
 const counts=rows.reduce((a,r)=>({...a,[r.asset_kind]:Number(r.n)}),{});
 if(counts.method!==346||counts.reference!==196||rows.some(r=>r.status!=='draft'))throw Error('本批数量/状态不符');
 console.log(JSON.stringify({counts,rows,methodFirstPage:method.items.length,genreFirstPage:genre.items.length,threeKingdomsMatches:three.items.length,integrity:db.prepare('PRAGMA quick_check').get()}));
}finally{db.close();}
