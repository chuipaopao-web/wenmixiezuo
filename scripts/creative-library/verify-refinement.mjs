import {DatabaseSync} from 'node:sqlite';
import {pathToFileURL} from 'node:url';
import {resolve} from 'node:path';
const [root,path]=process.argv.slice(2),db=new DatabaseSync(path,{readOnly:true});
try{const {CreativeReferenceAdminRepository}=await import(pathToFileURL(resolve(root,'apps/api/dist/infrastructure/db/repositories/creative-reference-admin-repository.js')).href),repo=new CreativeReferenceAdminRepository(db);
 const filter={assetKind:'method',availabilities:['draft','reviewed','published'],limit:100},out={};
 for(const [purpose,n] of Object.entries({'阅读期待':12,'反差':10,'融合取舍':4,'事实连续':4,'文学修订':17})){const items=repo.listSummaries({...filter,usageTree:purpose}).items;if(items.length!==n)throw Error('分类数量不符 '+purpose);out[purpose]=items.length;}
 if(repo.listSummaries({...filter,usageTree:'阅读期待',layers:['setting']}).items.length)throw Error('条件阶段误当重点阶段');
 const rows=db.prepare("SELECT asset_kind,status,count(*) n FROM creative_reference_cards GROUP BY asset_kind,status").all();
 if(!rows.some(r=>r.asset_kind==='method'&&r.status==='draft'&&r.n===361))throw Error('方法数不符');
 console.log(JSON.stringify({purposes:out,rows,integrity:db.prepare('PRAGMA quick_check').get()}));
}finally{db.close();}
