import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
const [path,planPath]=process.argv.slice(2),db=new DatabaseSync(path,{readOnly:true}),plan=JSON.parse(readFileSync(planPath,'utf8')),sha=p=>createHash('sha256').update(JSON.stringify(p)).digest('hex');
try{const rows=db.prepare("SELECT c.idempotency_key identity,c.display_code code,r.payload_json FROM creative_reference_cards c JOIN creative_reference_revisions r ON r.internal_id=c.internal_id AND r.revision=c.current_revision WHERE c.status<>'retired'").all();if(rows.length!==594)throw Error('数量错误');
 for(const e of plan.entries){const row=rows.find(r=>r.identity===e.identity);if(!row||sha(JSON.parse(row.payload_json))!==sha(e.payload))throw Error('原卡未恢复');}
 const variants=rows.filter(r=>r.identity.startsWith('r209-c6/'));if(variants.length!==32)throw Error('新卡数量错误');for(const r of variants){const p=JSON.parse(r.payload_json);if(JSON.stringify(p.method.applicableLayers)!=='["chain_chapters"]'||p.method.conditionalUses.length||!p.method.instruction.includes('余韵0—3章'))throw Error('新卡范围错误');}
 if(Object.values(db.prepare('PRAGMA quick_check').get())[0]!=='ok')throw Error('数据库不完整');
 console.log(JSON.stringify({restored:33,variants:variants.length,codes:variants.map(r=>r.code),total:rows.length,integrity:'ok'}));
}finally{db.close();}
