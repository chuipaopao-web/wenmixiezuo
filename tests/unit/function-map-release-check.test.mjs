import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {verifyPlanCardNames,verifyFunctionManagement} from '../../scripts/verify-function-management.mjs';
const doc=readFileSync('docs/REBUILD_EXECUTION_PLAN.md','utf8');
test('current map and management records pass the static release gate',()=>{
  assert.equal(verifyPlanCardNames(doc),82);
  assert(verifyFunctionManagement(process.cwd())>0);
});
test('R180: a stale opening title cannot ship even when management digests match',()=>{
  assert.throws(()=>verifyPlanCardNames(doc.replace('### RB-19 单页创意开书与结果采用','### RB-19 AI开书页与结果采用')),/RB-19/);
});
test('missing and duplicate cards cannot ship',()=>{
  assert.throws(()=>verifyPlanCardNames(doc.replace('### RB-19 单页创意开书与结果采用','#### RB-19 单页创意开书与结果采用')),/不完整/);
  assert.throws(()=>verifyPlanCardNames(doc.replace('### RB-19 单页创意开书与结果采用','### RB-19 单页创意开书与结果采用\n### RB-19 单页创意开书与结果采用')),/RB-19/);
});
test('Windows and Linux line endings are both accepted',()=>{
  assert.equal(verifyPlanCardNames(doc.replace(/\r?\n/g,'\r\n')),82);
});
