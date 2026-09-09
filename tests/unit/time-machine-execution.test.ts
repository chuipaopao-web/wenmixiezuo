import {afterEach,describe,it,expect} from 'vitest';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {schema} from '../../rebuild/packages/time-machine-core/src/store.js';
import {StepRepository,executionSchema} from '../../rebuild/packages/time-machine-core/src/execution.js';
const scope={ownerId:'o',bookId:'b'};const connections:DatabaseSync[]=[];
afterEach(()=>connections.splice(0).forEach(db=>db.close()));
function setup(){const db=new DatabaseSync(':memory:');connections.push(db);db.exec('PRAGMA foreign_keys=ON');db.exec(schema+executionSchema);db.prepare('INSERT INTO tm2_books(owner,book,manifest) VALUES(?,?,?)').run('o','b','{}');const repo=new StepRepository(db);repo.create(scope,'step',{version:'1'},'writer');return {repo,db};}
function claim(repo:StepRepository,now=1){const result=repo.claim(scope,'step',now,100);if(result.kind!=='claimed')throw Error('not claimed');return result.attemptId;}
describe('durable new member execution',()=>{
 it('host migration equals independent execution schema',()=>{expect(readFileSync('apps/api/src/infrastructure/db/migrations/0115_time_machine_execution.sql','utf8').replace(/^--.*$/gmu,'').trim()).toBe(executionSchema.trim());});
 it('deduplicates creation and dispatch, refuses changed member or input',()=>{const {repo}=setup();repo.create(scope,'step',{version:'1'},'writer');expect(()=>repo.create(scope,'step',{version:'2'},'writer')).toThrow('输入');expect(()=>repo.create(scope,'step',{version:'1'},'other')).toThrow('成员');claim(repo);expect(repo.claim(scope,'step',2,100)).toEqual({kind:'wait',state:'running'});});
 it('expired lease becomes unknown, never automatic duplicate call',()=>{const {repo}=setup();const attempt=claim(repo);expect(repo.claim(scope,'step',102,100)).toEqual({kind:'wait',state:'unknown'});expect(repo.retryTemporary(scope,'step')).toBe(false);repo.finish(scope,'step',attempt,{result:'late response'},103);expect(repo.claim(scope,'step',104,100)).toEqual({kind:'saved',output:{result:'late response'}});});
 it('commits once and rejects a divergent replay',()=>{const {repo,db}=setup();const attempt=claim(repo);repo.finish(scope,'step',attempt,{done:true},2);repo.finish(scope,'step',attempt,{done:true},3);expect(()=>repo.finish(scope,'step',attempt,{done:false},4)).toThrow('不能变化');expect(db.prepare('SELECT COUNT(*) n FROM tm2_outbox').get()).toMatchObject({n:1});});
 it('caps known temporary retries and rejects an old response',()=>{const {repo}=setup();const first=claim(repo);repo.fail(scope,'step',first,'temporary',2);expect(repo.retryTemporary(scope,'step')).toBe(true);const second=claim(repo,3);expect(()=>repo.finish(scope,'step',first,{},4)).toThrow('旧attempt');repo.fail(scope,'step',second,'temporary',5);expect(repo.retryTemporary(scope,'step')).toBe(true);repo.fail(scope,'step',claim(repo,6),'temporary',7);expect(repo.retryTemporary(scope,'step')).toBe(false);});
 it.each(['authentication','budget','truncated','unknown'] as const)('does not auto retry %s',code=>{const {repo}=setup();repo.fail(scope,'step',claim(repo),code,2);expect(repo.retryTemporary(scope,'step')).toBe(false);});
 it('rejects cross-book access',()=>{const {repo}=setup();expect(()=>repo.state({...scope,bookId:'other'},'step')).toThrow('不属于');});
});
