import { settingTopicKey } from '@wenmi/opening-runtime';

/** A merge hides only the exact, reviewed versions. A later edit to an old entry becomes visible again. */
export function activeSettingVersions<T extends {item_key:string;version_id:string;content_json:string}>(rows:T[]):T[] {
  const replaced=new Set<string>();
  for(const row of rows) {
    if(settingTopicKey(row.item_key)!==row.item_key)continue;
    const data=JSON.parse(row.content_json) as {rules?:unknown;authorRuleDecision?:string;continuity?:{findings?:Array<{kind:string;sourceId:string}>;mergedVersionIds?:string[]}};
    const accepted=data.authorRuleDecision==='adopt_changed_rules'&&data.continuity?.findings?.every(f=>f.kind==='setting');
    if(!Array.isArray(data.rules)||!data.rules.length||!data.continuity||(!accepted&&data.continuity.findings?.length!==0))continue;
    for(const id of [...(data.continuity.mergedVersionIds ?? []),...(accepted ? data.continuity.findings!.map(f=>f.sourceId) : [])]) {
      const previous=rows.find(candidate=>candidate.version_id===id);
      if(previous&&previous.item_key!==row.item_key&&settingTopicKey(previous.item_key)===row.item_key)replaced.add(id);
    }
  }
  return rows.filter(row=>!replaced.has(row.version_id));
}
