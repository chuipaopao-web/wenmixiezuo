import type {DatabaseSync} from 'node:sqlite';
import {SqliteCreativeReferenceRepository} from '../../apps/api/src/infrastructure/db/repositories/creative-reference-repository.js';
export function seedCreativeLibrary(db:DatabaseSync){
 const repo=new SqliteCreativeReferenceRepository(db),now='2026-09-14';
 const card=repo.createCard({assetKind:'method',idempotencyKey:'test-payoff',legacy:null,authorActor:'test-designer',payload:{assetKind:'method',name:'成果可见',shortPhrase:'成果可见',summary:'用实际变化表现回报',aliases:[],method:{title:'成果可见',instruction:'借角色行动与生活变化表现获得和失去',boundary:'不反复复述结果',usageTree:'阶段回报',relatedPurposes:['情绪回报'],applicableLayers:['opening','setting','book'],conditionalUses:[],aliases:[]}}},now);
 repo.reviewRevision({internalId:card.internalId,expectedRevision:1,reviewActor:'test-reviewer'},now);
 const release=repo.publishRelease({entries:[{internalId:card.internalId,revision:1}],relations:[],publishedBy:'test-publisher',expectedActiveReleaseId:null},now);
 return {id:card.displayCode,releaseId:release.releaseId};
}
