import {DatabaseSync} from 'node:sqlite';
import {pathToFileURL} from 'node:url';
import {resolve} from 'node:path';
const [root,path]=process.argv.slice(2),db=new DatabaseSync(path,{readOnly:true});
try{
 const {SqliteCreativeReferenceRepository}=await import(pathToFileURL(resolve(root,'apps/api/dist/infrastructure/db/repositories/creative-reference-repository.js')).href);
 const repo=new SqliteCreativeReferenceRepository(db),release=repo.getActiveRelease();if(!release)throw Error('尚未发布');
 const counts={method:0,reference:0};let cursor=null,total=0;
 do{const page=repo.listReleaseEntries(release.releaseId,cursor,100);for(const e of page.items){const r=repo.getRevisionInRelease(release.releaseId,e.internalId);if(!r||r.status==='draft')throw Error('无审核版本');counts[r.payload.assetKind]++;total++;}cursor=page.nextCursor;}while(cursor);
 if(total!==562||counts.method!==366||counts.reference!==196)throw Error('正式供给数量不符');
 const integrity=db.prepare('PRAGMA quick_check').get();if(Object.values(integrity)[0]!=='ok')throw Error('数据库检查失败');
 console.log(JSON.stringify({releaseId:release.releaseId,counts,total,integrity}));
}finally{db.close();}
