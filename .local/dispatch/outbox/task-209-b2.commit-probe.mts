import {DatabaseSync} from 'node:sqlite';
import {pathToFileURL} from 'node:url';
import {resolve} from 'node:path';
const imp=(p:string)=>import(pathToFileURL(resolve(process.cwd(),p)).href);
const {createTestContext}=await imp('tests/helpers/test-context.ts');
const {SqliteCreativeReferenceRepository}=await imp('apps/api/src/infrastructure/db/repositories/creative-reference-repository.ts');
const c=createTestContext('b2-commit-');
let other:DatabaseSync|undefined;
try{
 c.database.exec('PRAGMA journal_mode=DELETE; PRAGMA busy_timeout=10; CREATE TABLE codex_marker(n INTEGER)');
 other=new DatabaseSync(c.config.databasePath);
 other.exec('BEGIN');other.prepare('SELECT * FROM codex_marker').all();
 const repo=new SqliteCreativeReferenceRepository(c.database);
 let error='';try{repo.runInTransaction(()=>{c.database.exec('INSERT INTO codex_marker VALUES(1)');});}catch(e){error=String(e);}
 other.exec('ROLLBACK');
 repo.runInTransaction(()=>{c.database.exec('INSERT INTO codex_marker VALUES(2)');});
 let outside:unknown;try{outside=other.prepare('SELECT * FROM codex_marker').all();}catch(e){outside=String(e);}
 console.log(JSON.stringify({commitError:error,retryReturnedSuccess:true,sameConnection:c.database.prepare('SELECT * FROM codex_marker').all(),otherConnection:outside}));
}finally{try{c.database.exec('ROLLBACK');}catch{}other?.close();c.close();}
