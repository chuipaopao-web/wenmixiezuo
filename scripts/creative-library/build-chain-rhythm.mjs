import {DatabaseSync} from 'node:sqlite';
import {writeFileSync} from 'node:fs';
import {refineChainRhythm} from './chain-rhythm.mjs';
const [dbPath,out]=process.argv.slice(2),db=new DatabaseSync(dbPath,{readOnly:true});
try{const active=db.prepare('SELECT release_id FROM creative_reference_releases WHERE active=1').get();if(!active)throw Error('no active release');
 const rows=db.prepare("SELECT c.idempotency_key identity,c.display_code code,r.revision,r.payload_json FROM creative_reference_cards c JOIN creative_reference_revisions r ON r.internal_id=c.internal_id AND r.revision=c.current_revision WHERE c.status<>'retired'").all();
 const entries=rows.flatMap(r=>{const expectedPayload=JSON.parse(r.payload_json),payload=refineChainRhythm(r.code,expectedPayload);return payload?[{identity:r.identity,code:r.code,expectedRevision:r.revision,expectedPayload,payload}]:[];});
 if(!entries.some(e=>e.code==='法012'))throw Error('missing 法012');
 writeFileSync(out,JSON.stringify({batch:'r209-c5',expectedReleaseId:active.release_id,entries,additions:[]},null,2));console.log(JSON.stringify(entries.map(e=>({code:e.code,name:e.payload.name,stages:e.payload.method.applicableLayers}))));
}finally{db.close();}
