import sqlite3,sys
d=sqlite3.connect('file:'+sys.argv[1]+'?mode=ro',uri=True,timeout=5)
checks={
'tasks':('status',['pending','queued','working','waiting_confirmation','running']),
'model_calls':('state',['pending','queued','working','reserved','started','running']),
'account_usage_supplemental_calls':('state',['working','unknown']),
'prebook_opening_design_calls':('state',['working']),
'book_branding_designs':('status',['working']),
'v7_book_title_design_calls':('state',['working']),
'v7_book_cover_designs':('state',['working']),
'v7_opening_agent_tasks':('status',['queued','working']),
'v7_setting_batches':('status',['queued','working']),
'v7_setting_item_jobs':('state',['queued','working','chief_review']),
'v7_planning_recipe_runs':('status',['queued','working']),
'v7_planning_generation_runs':('status',['queued','working']),
'v7_planning_maintenance_runs':('status',['queued','working']),
'v7_character_context_packs':('status',['queued','working']),
'v7_character_maintenance_runs':('status',['queued','working']),
'v7_creation_workflows':('status',['queued','working']),
'v7_creation_context_packs':('status',['queued','working']),
'v7_creation_stage_jobs':('status',['pending','working']),
'v7_formalization_outbox':('status',['pending','working']),
'v7_managed_creation_runs':('status',['active'])}
for prefix in ['opening_agent','setting','planning','character','creation']:
 checks['v7_'+prefix+'_model_calls']=('state',['working'])
if d.execute("SELECT 1 FROM sqlite_master WHERE name='v7_route_decision_jobs'").fetchone():
 checks['v7_route_decision_jobs']=('status',['queued','working','unknown'])
total=0
for table,(col,states) in checks.items():
 total+=d.execute('SELECT count(*) FROM '+table+' WHERE '+col+' IN ('+','.join('?'*len(states))+')',states).fetchone()[0]
print(total)
