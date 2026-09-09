import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {verifyPlanCardNames,verifyFunctionManagement} from '../../scripts/verify-function-management.mjs';
const doc=readFileSync('docs/REBUILD_EXECUTION_PLAN.md','utf8');

test('reviewed progress rejects invalid or duplicate records',()=>{
  const line='- **收尾·进度状态**：部分实现·待接入';
  assert(doc.includes(line));
  assert.throws(()=>verifyPlanCardNames(doc.replace(line,'- **收尾·进度状态**：随意完成')),/进度状态/);
  assert.throws(()=>verifyPlanCardNames(doc.replace(line,`${line}\n${line}`)),/进度状态/);
});
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

test('every roadmap card must retain exactly one complete delivery and retirement record',()=>{
  for (const label of ['线上现状','执行归属','剩余工作','旧实现退出']) {
    const line=doc.match(new RegExp(`^- \\*\\*收尾·${label}\\*\\*：[^\\r\\n]+`,'m'))[0];
    assert.throws(()=>verifyPlanCardNames(doc.replace(line,'')),new RegExp(label));
    assert.throws(()=>verifyPlanCardNames(doc.replace(line,`${line}\n${line}`)),new RegExp(label));
  }
});
