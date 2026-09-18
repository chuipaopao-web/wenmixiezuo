import {DatabaseSync} from 'node:sqlite';
import assert from 'node:assert/strict';
const src='/opt/wenmi-releases/wm-v7-20260918-161500-e1310473/source';
const {readRebuildControl}=await import(src+'/apps/api/dist/application/admin/rebuild-control-service.js');
const db=new DatabaseSync('/opt/wenmi/data/database/wenmi.sqlite',{readOnly:true});
const data=await readRebuildControl({projectRoot:src,releaseId:'wm-v7-20260918-161500-e1310473',publicOrigin:'https://wenmixiezuo.com'},db);
const row=data.units.find(x=>x.id==='RB-22');assert.equal(row.deployment,'试用中');assert.equal(row.acceptance,'验收中');
console.log(JSON.stringify({currentBatch:data.source.currentBatch,units:data.units.length,RB22:{acceptance:row.acceptance,deployment:row.deployment},runtime:data.runtime.releaseId}));db.close();
