import {DatabaseSync} from 'node:sqlite';
import {describe,it,expect,vi} from 'vitest';
import {dispatchSettingHandoffs,enqueueSettingHandoff} from '../../apps/api/src/application/books/setting-time-machine-handoff.js';
import {readFileSync} from 'node:fs';
function setup(){const db=new DatabaseSync(':memory:');db.exec(`CREATE TABLE books(owner_id TEXT,book_id TEXT,status TEXT,PRIMARY KEY(owner_id,book_id));CREATE TABLE tm2_design_runs(id TEXT,owner_id TEXT,book_id TEXT,kind TEXT,request_key TEXT);INSERT INTO books VALUES('o','b','active'),('x','b','active');`);db.exec(readFileSync('apps/api/src/infrastructure/db/migrations/0121_setting_time_machine_handoffs.sql','utf8'));return db;}
describe('设定到故事线的持久派工',()=>{
 it('事务回滚无派工；关闭页面后可消费，同版本重复提交只派一次',()=>{const db=setup();try{
  db.exec('BEGIN');enqueueSettingHandoff(db,{ownerId:'o',bookId:'b'},'v1','now');db.exec('ROLLBACK');expect(db.prepare('SELECT * FROM setting_time_machine_handoffs').all()).toHaveLength(0);
  enqueueSettingHandoff(db,{ownerId:'o',bookId:'b'},'v1','now');enqueueSettingHandoff(db,{ownerId:'o',bookId:'b'},'v1','now');
  const start=vi.fn(()=> 'run');dispatchSettingHandoffs(db,()=>({ready:true,version:'v1'}),start);dispatchSettingHandoffs(db,()=>({ready:true,version:'v1'}),start);
  expect(start).toHaveBeenCalledExactlyOnceWith({ownerId:'o',bookId:'b'},'recommend-initial:b:v1');
 }finally{db.close();}});
 it('重启前已建运行可恢复；不同用户相同书号不混用',()=>{const db=setup();try{
  enqueueSettingHandoff(db,{ownerId:'o',bookId:'b'},'v1','now');enqueueSettingHandoff(db,{ownerId:'x',bookId:'b'},'v1','now');
  db.prepare('INSERT INTO tm2_design_runs VALUES(?,?,?,?,?)').run('saved','o','b','recommend','recommend-initial:b:v1');
  const start=vi.fn(()=> 'new');dispatchSettingHandoffs(db,()=>({ready:true,version:'v1'}),start);
  expect(start).toHaveBeenCalledExactlyOnceWith({ownerId:'x',bookId:'b'},'recommend-initial:b:v1');
  expect(db.prepare("SELECT run_id FROM setting_time_machine_handoffs WHERE owner_id='o'").get()).toEqual({run_id:'saved'});
 }finally{db.close();}});
 it('资料变化或未确认不派工，失败不无限重试',()=>{const db=setup();try{
  enqueueSettingHandoff(db,{ownerId:'o',bookId:'b'},'v1','now');const start=vi.fn(()=>{throw Error('not ready');});
  dispatchSettingHandoffs(db,()=>({ready:true,version:'v2'}),start);expect(start).not.toHaveBeenCalled();
  enqueueSettingHandoff(db,{ownerId:'o',bookId:'b'},'v2','now');dispatchSettingHandoffs(db,()=>({ready:true,version:'v2'}),start);dispatchSettingHandoffs(db,()=>({ready:true,version:'v2'}),start);expect(start).toHaveBeenCalledTimes(1);
  expect(db.prepare("SELECT state FROM setting_time_machine_handoffs WHERE source_version='v2'").get()).toEqual({state:'failed'});
 }finally{db.close();}});
});
