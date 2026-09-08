import type { DatabaseSync } from 'node:sqlite';
import { settingTopicKey, parseSettingRules, renderSettingRules } from '@wenmi/opening-runtime';
import { activeSettingVersions } from './setting-version-selection.js';
export interface ContinuitySource { id: string; kind: 'setting' | 'reference' | 'planning' | 'actual'; label: string; text: string; hash?: string; authority?:'candidate'|'confirmed'|'immutable_text' }

/** Read current authorities only. Old immutable versions remain available to frozen tasks. */
export function continuitySources(db: DatabaseSync, ownerId: string, bookId: string, itemKey: string, includeText=true): ContinuitySource[] {
  const rows = db.prepare(`SELECT v.version_id AS id,i.item_key,i.item_label AS label,v.content_json AS text
    FROM v7_setting_items i JOIN v7_setting_item_versions v ON v.owner_id=i.owner_id AND v.book_id=i.book_id AND v.item_key=i.item_key
    WHERE i.owner_id=? AND i.book_id=? AND v.status='confirmed' AND v.revision=(SELECT MAX(s.revision)
      FROM v7_setting_item_versions s WHERE s.owner_id=i.owner_id AND s.book_id=i.book_id AND s.item_key=i.item_key AND s.status='confirmed')
    ORDER BY i.item_key`).all(ownerId, bookId) as Array<{id:string;item_key:string;label:string;text:string}>;
  const settings=activeSettingVersions(rows.map(row=>({...row,version_id:row.id,content_json:row.text})));
  for(const setting of settings) {
    const content=JSON.parse(setting.text) as Record<string,unknown>;
    const rules=parseSettingRules(content.rules);
    const text=rules ? renderSettingRules(rules) : content.finalContent ?? content.content;
    if(typeof text!=='string'||!text.trim())throw new Error('正式设定缺少可核对的完整内容');
    setting.text=text;
  }
  const previous = settings.filter(s => settingTopicKey(s.item_key) === settingTopicKey(itemKey));
  const planning = db.prepare(`SELECT t.tree_version_id AS id, t.tree_kind || ' · ' || t.scope_id AS label,${includeText ? 't.content_json' : "''"} AS text,t.content_hash AS hash,t.lifecycle AS authority
    FROM v7_planning_tree_heads h JOIN v7_planning_tree_versions t ON t.owner_id=h.owner_id AND t.book_id=h.book_id
      AND (t.tree_version_id=h.confirmed_version_id OR t.tree_version_id=h.candidate_version_id)
    WHERE h.owner_id=? AND h.book_id=? ORDER BY t.tree_version_id`).all(ownerId, bookId) as Array<{id:string;label:string;text:string}>;
  // A changed world rule can affect a chapter even when an old pack failed to record a direct reference.
  const actual = db.prepare(`SELECT manuscript_version_id AS id,'第' || chapter_number || '章' AS label,${includeText ? 'content_text' : "''"} AS text,content_hash AS hash
    FROM v7_manuscript_versions WHERE owner_id=? AND book_id=? AND lifecycle='final' ORDER BY chapter_number`)
    .all(ownerId, bookId) as Array<{id:string;label:string;text:string}>;
  if(settings.length===0&&planning.length===0&&actual.length===0)return [];
  const opening=db.prepare(`SELECT opening_blueprint_id AS id,'开书资料' AS label,blueprint_json AS text,content_hash AS hash
    FROM book_opening_blueprints WHERE owner_id=? AND book_id=? AND status='active' ORDER BY opening_blueprint_id`).all(ownerId,bookId) as Array<{id:string;label:string;text:string;hash:string}>;
  return [...previous.map(s=>({id:s.id,label:s.label,text:s.text,kind:'setting' as const})),
    ...settings.filter(s=>!previous.some(p=>p.id===s.id)).map(s=>({id:s.id,label:s.label,text:s.text,kind:'reference' as const})),
    ...opening.map(s=>({...s,kind:'reference' as const})),
    ...planning.map(s => ({...s,kind:'planning' as const})), ...actual.map(s => ({...s,kind:'actual' as const}))];
}

export function continuitySourceText(db:DatabaseSync,ownerId:string,bookId:string,source:ContinuitySource):string {
  if(source.kind!=='planning'&&source.kind!=='actual')return source.text;
  const row=source.kind==='planning'
    ? db.prepare('SELECT content_json AS text FROM v7_planning_tree_versions WHERE owner_id=? AND book_id=? AND tree_version_id=?').get(ownerId,bookId,source.id)
    : db.prepare('SELECT content_text AS text FROM v7_manuscript_versions WHERE owner_id=? AND book_id=? AND manuscript_version_id=?').get(ownerId,bookId,source.id);
  if(!row||typeof row.text!=='string')throw new Error('核对依据不存在或不属于本书');
  return row.text;
}
