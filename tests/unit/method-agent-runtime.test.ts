import {afterEach,expect,it} from 'vitest';
import {DatabaseSync} from 'node:sqlite';import {readFileSync} from 'node:fs';
import {DEFAULT_RHYTHM_POLICY,COMPLETE_V3_RHYTHM_POLICY,renderRhythmFragment,executeMethodTool,validateRhythmPolicy} from '@wenmi/v7-backend';
import {MethodAgentRuntime} from '../../apps/api/src/application/agents/method-agent-runtime.js';
import {V7RhythmPolicyStore} from '../../apps/api/src/application/planning/v7-rhythm-policy-store.js';
const dbs:DatabaseSync[]=[];afterEach(()=>dbs.splice(0).forEach(db=>db.close()));
function setup(){const db=new DatabaseSync(':memory:');dbs.push(db);for(const file of ['0109_v7_rhythm_policy.sql','0113_method_agent_audit.sql'])db.exec(readFileSync('apps/api/src/infrastructure/db/migrations/'+file,'utf8'));
db.exec("CREATE TABLE v7_planning_recipe_runs(owner_id TEXT,book_id TEXT,run_id TEXT,status TEXT); INSERT INTO v7_planning_recipe_runs VALUES('owner','book','run','working');");
const store=new V7RhythmPolicyStore(db);store.initialize('2026-09-09');const snapshot=store.snapshot('route:owner:book:run','2026-09-10')!;
const request={ownerId:'owner',bookId:'book',runId:'run',requestId:'request',kind:'recipe' as const,memberKey:'member',prompt:'林舟无灵根，机甲修仙。'+renderRhythmFragment(snapshot.policy,'book_backbone',snapshot.version)};
const runtime=new MethodAgentRuntime(db);return {db,store,snapshot,request,runtime,binding:runtime.binding(request)!};}
it('校正版本完整可查，导航不含整库，旧版本冻结而且重复初始化不增版本',()=>{
const {db,store}=setup();expect(validateRhythmPolicy(DEFAULT_RHYTHM_POLICY).cards).toHaveLength(341);
expect(renderRhythmFragment(DEFAULT_RHYTHM_POLICY,'volume',1).length).toBeLessThan(1300);
db.prepare('INSERT INTO v7_rhythm_policy_versions VALUES(?,?,?,?)').run(2,JSON.stringify(COMPLETE_V3_RHYTHM_POLICY),'old','2026-09-09');
store.snapshot('old','2026-09-10');store.initialize('2026-09-10');expect(store.snapshot('old','2026-09-10')?.policy.cards).toHaveLength(330);
expect(db.prepare('SELECT COUNT(*) n FROM v7_rhythm_policy_versions').get()?.n).toBe(2);
});
it('查询分页、跨层读取、别名、参数隔离和未知ID',()=>{const {snapshot}=setup();
const page=executeMethodTool(snapshot,'book_backbone',{name:'search_methods',arguments:{}}) as {cards:unknown[];nextCursor:number};expect(page.cards).toHaveLength(20);expect(page.nextCursor).toBe(20);
const next=executeMethodTool(snapshot,'book_backbone',{name:'search_methods',arguments:{cursor:20}}) as {cards:unknown[]};expect(next.cards).not.toEqual(page.cards);
expect(JSON.stringify(executeMethodTool(snapshot,'chapter_execution',{name:'read_methods',arguments:{ids:['six-act','deadline-pressure','not-found']}}))).toContain('ticking-clock');
expect(()=>executeMethodTool(snapshot,'volume',{name:'read_methods',arguments:{ids:['six-act'],ownerId:'other'}})).toThrow();
expect(()=>executeMethodTool(snapshot,'volume',{name:'read_methods',arguments:{ids:Array(9).fill('six-act')}})).toThrow();
});
it('资料足够直接设计只调用一次，其他书的版本不能绑定',async()=>{const {runtime,request,binding}=setup();let calls=0;
const result=await runtime.run(request,binding,async(step,prompt)=>{calls++;expect(prompt).toContain('林舟');return {requestId:String(step),output:'{"story":"机甲入山门"}',inputTokens:80,outputTokens:20};});expect(calls).toBe(1);expect(result.output).toContain('机甲');
expect(runtime.binding({...request,bookId:'other'})).toBeNull();});
it('同节点结果未知时，不向另一成员重复派发；别的书不受影响',async()=>{
 const {db,runtime,request,binding}=setup();
 db.exec("CREATE TABLE v7_planning_model_calls(owner_id TEXT,book_id TEXT,run_id TEXT,node_key TEXT,state TEXT,request_id TEXT); INSERT INTO v7_planning_model_calls VALUES('owner','book','run','design:methods:1','unknown','unknown-call');");
 let n=0;const generate=async()=>{n++;return {requestId:'next',output:'{}',inputTokens:1,outputTokens:1};};
 await expect(runtime.run({...request,nodeKey:'design',memberKey:'other-member'},binding,generate)).rejects.toThrow('尚未确认');expect(n).toBe(0);
 db.exec("UPDATE v7_planning_model_calls SET book_id='another-book'");
 await runtime.run({...request,nodeKey:'design'},binding,generate);expect(n).toBe(1);
});
it('成员查询后选择，最终上下文去掉查询结果并留下具体用法；审计可追溯',async()=>{const {db,runtime,request,binding}=setup();const prompts:string[]=[];
const outputs=[{agentAction:'tool_calls',calls:[{name:'search_methods',arguments:{category:'macro_architecture'}}]},
{agentAction:'tool_calls',calls:[{name:'read_methods',arguments:{ids:['six-act']}}]},
{agentAction:'selection',selected:[{id:'six-act',application:'林舟从修机甲到建立工坊，阶段不是卷数。'}]}, {story:'林舟先以机甲救下矿工，获得第一座工坊。'}];
await runtime.run(request,binding,async(step,prompt)=>{prompts.push(prompt);return {requestId:'r'+step,output:JSON.stringify(outputs[step]),inputTokens:100,outputTokens:20};});
expect(prompts).toHaveLength(4);expect(prompts[3]).toContain('阶段不是卷数');expect(prompts[3]).not.toContain('最近工具返回');expect(prompts[3]).not.toContain('nextCursor');
const events=db.prepare('SELECT event_json FROM v7_method_agent_events ORDER BY step').all().map(e=>JSON.parse(String(e.event_json)));expect(events.at(-1).state).toBe('completed');expect(events.at(-1).selected[0].id).toBe('six-act');
});
it('查询有界且取消立即停止，不无限调用',async()=>{const {db,runtime,request,binding}=setup();let n=0;
await expect(runtime.run(request,binding,async(step)=>{n++;if(step===0)db.exec("UPDATE v7_planning_recipe_runs SET status='cancelled'");return {requestId:String(step),output:JSON.stringify({agentAction:'tool_calls',calls:[{name:'list_method_categories',arguments:{}}]}),inputTokens:10,outputTokens:10};})).rejects.toThrow('已停止');expect(n).toBe(1);
db.exec("UPDATE v7_planning_recipe_runs SET status='working'");n=0;
await expect(runtime.run(request,binding,async(step)=>{n++;return {requestId:String(step),output:JSON.stringify({agentAction:'tool_calls',calls:[{name:'list_method_categories',arguments:{}}]}),inputTokens:10,outputTokens:10};})).rejects.toThrow('上限');expect(n).toBe(6);
});
