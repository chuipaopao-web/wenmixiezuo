import { createHash } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { BOOK_CARD_FIELDS, BOOK_CARD_MAX_CHARS, BOOK_CARD_PAGE_CHARS, BOOK_CARD_TEMPLATE_VERSION,
  bookCardTemplatePrompt, renderBookDesignCard, type BookDesignCard } from '@wenmi/v7-backend';
import type { V7PlanningCompiledSnapshot } from './v7-planning-source-compiler.js';
import { planningSourceProjection, removeEmpty } from './v7-planning-source-projection.js';

type Generate = (call: { key: string; prompt: string }) => Promise<string>;
interface Fragment { ref: string; sourceId: string; path: string; text: string }
const pending = new Map<string, Promise<BookDesignCard>>();
const hash = (v: unknown): string => createHash('sha256').update(JSON.stringify(v)).digest('hex');
export class BookCardSourceIssues extends Error {
  constructor(public readonly issues:string[]) { super(issues.join('；')); }
}

export function parseBookDesignCard(output: string, refs: ReadonlySet<string>): BookDesignCard {
  const parsed = JSON.parse(output.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')) as BookDesignCard;
  const issues=(parsed as unknown as {sourceIssues?:unknown})?.sourceIssues;
  if(Array.isArray(issues) && issues.length>0 && issues.length<=8 && issues.every(i=>typeof i==='string'&&i.length<=500))throw new BookCardSourceIssues(issues as string[]);
  if (!parsed || Array.isArray(parsed) || Object.keys(parsed).length !== BOOK_CARD_FIELDS.length) throw Error('短卡需完整提供六个栏目。');
  for (const f of BOOK_CARD_FIELDS) {
    const entries = parsed[f.key];
    if (!Array.isArray(entries) || entries.length > 30) throw Error('短卡栏目格式无效。');
    for (const e of entries) if (!e || typeof e.text !== 'string' || !e.text.trim() || e.text.length > 1000
      || !Array.isArray(e.refs) || !e.refs.length || e.refs.some(r => !refs.has(r))) throw Error('短卡内容缺少有效来源或过长。');
  }
  if (renderBookDesignCard(parsed).length > BOOK_CARD_MAX_CHARS) throw Error('短卡超过预算，请去重精简，保留关键条件。');
  return parsed;
}

/** Full source coverage in bounded pages. Paths and fragments are audit evidence, never new facts. */
export function bookCardFragments(snapshot: V7PlanningCompiledSnapshot): Fragment[] {
  const fragments: Fragment[] = [];
  const visit = (value: unknown, sourceId: string, path: string): void => {
    if (value === null || value === undefined || value === '') return;
    if (typeof value === 'object') {
      for (const [k,v] of Object.entries(value)) visit(v, sourceId, `${path}/${k.replaceAll('~','~0').replaceAll('/','~1')}`);
    } else {
      const chars = Array.from(String(value));
      for (let offset = 0; offset < chars.length; offset += 1800) fragments.push({ ref: `F${fragments.length+1}`, sourceId,
        path: `${path}@${offset}`, text: chars.slice(offset,offset+1800).join('') });
    }
  };
  for (const s of snapshot.sources.filter(s => s.sourceKind === 'opening' || s.sourceKind === 'setting')) {
    // Projection removes repeated transport fields while retaining unique conditions.
    visit(s.sourceKind === 'opening' ? removeEmpty(s.content) : planningSourceProjection(s.content), s.sourceId, '');
  }
  return fragments;
}

export class V7BookDesignCardService {
  constructor(private readonly database: DatabaseSync) {}
  async prepare(snapshot: V7PlanningCompiledSnapshot, generate: Generate): Promise<V7PlanningCompiledSnapshot> {
    const sourceKey = hash({ template: BOOK_CARD_TEMPLATE_VERSION, sources: snapshot.sources
      .filter(s => s.sourceKind === 'opening' || s.sourceKind === 'setting')
      .map(s => [s.sourceId,s.sourceVersion,s.contentHash]) });
    const cacheKey = JSON.stringify([snapshot.ownerId,snapshot.bookId,sourceKey]);
    let work = pending.get(cacheKey);
    if (!work) {
      work = this.build(snapshot,sourceKey,generate); pending.set(cacheKey,work);
    }
    try {
      const card = await work;
      const selectedRefs=new Set(Object.values(card).flatMap(es=>es.flatMap(e=>e.refs)));
      return { ...snapshot, bookDesignCard: { sourceKey, templateVersion: BOOK_CARD_TEMPLATE_VERSION,
        text: renderBookDesignCard(card), refs: [...selectedRefs],
        sourceIds:[...new Set(bookCardFragments(snapshot).filter(f=>selectedRefs.has(f.ref)).map(f=>f.sourceId))] } };
    } finally { if (pending.get(cacheKey) === work) pending.delete(cacheKey); }
  }
  private async build(snapshot: V7PlanningCompiledSnapshot, sourceKey: string, generate: Generate): Promise<BookDesignCard> {
    const fragments = bookCardFragments(snapshot);
    const allRefs = new Set(fragments.map(f => f.ref));
    const get = (stage: string): BookDesignCard | null => {
      const row = this.database.prepare('SELECT card_json FROM v7_book_design_cards WHERE owner_id=? AND book_id=? AND source_key=? AND stage_key=?')
        .get(snapshot.ownerId,snapshot.bookId,sourceKey,stage) as {card_json:string}|undefined;
      return row ? parseBookDesignCard(row.card_json,allRefs) : null;
    };
    const save = (stage:string, card:BookDesignCard): void => {
      this.database.prepare('INSERT OR IGNORE INTO v7_book_design_cards VALUES(?,?,?,?,?,?)')
        .run(snapshot.ownerId,snapshot.bookId,sourceKey,stage,JSON.stringify(card),new Date().toISOString());
    };
    const ready = get('ready'); if (ready) return ready;
    const pages: Fragment[][] = [[]];
    for (const f of fragments) {
      if (JSON.stringify([...pages.at(-1)!,f]).length > BOOK_CARD_PAGE_CHARS) pages.push([]);
      pages.at(-1)!.push(f);
    }
    if (!fragments.length || pages.length > 32) throw Error('全书资料尚未准备好或超出本轮整理容量，原文已保留。');
    const call = async (stage:string, material:unknown, refs:Set<string>, extra:string): Promise<BookDesignCard> => {
      const prior = get(stage); if (prior) return prior;
      let correction = '';
      for (let attempt=0;attempt<2;attempt++) {
        const prompt = `${bookCardTemplatePrompt()}\n${extra}\n${correction}\n资料：${JSON.stringify(material)}`;
        if (prompt.length > 18000) throw Error('资料短卡整理输入超出预算，未发送模型。');
        const output = await generate({ key:`book-card:${sourceKey}:${stage}:${attempt}`,prompt });
        try { const card = parseBookDesignCard(output,refs); save(stage,card); return card; }
        catch(e) { if(e instanceof BookCardSourceIssues)throw e; correction = `上次提交未通过：${e instanceof Error ? e.message : '格式错误'}。重新从资料整理，不增加情节。`; }
      }
      throw Error('资料短卡尚未整理完成，已完成部分保留，可继续。');
    };
    let cards: BookDesignCard[] = [];
    for (let i=0;i<pages.length;i++) cards.push(await call(`page-${i}`,pages[i],new Set(pages[i]!.map(f=>f.ref)),`当前第${i+1}/${pages.length}页，只提取本页信息，未出现的栏目留空。`));
    for (let level=0;cards.length>1;level++) {
      const next: BookDesignCard[]=[];
      for (let i=0;i<cards.length;i+=2) {
        if (!cards[i+1]) { next.push(cards[i]!); continue; }
        const pair=cards.slice(i,i+2);
        const refs=new Set(pair.flatMap(c=>Object.values(c).flatMap(es=>es.flatMap(e=>e.refs))));
        next.push(await call(`merge-${level}-${i}`,pair,refs,'合并两份资料短卡，去重；不要新增事实，不要丢失主角身份、能力关键条件和作者要求。'));
      }
      cards=next;
    }
    let final=cards[0]!;
    for (let i=0;i<pages.length;i++) {
      const refs=new Set([...Object.values(final).flatMap(es=>es.flatMap(e=>e.refs)),...pages[i]!.map(f=>f.ref)]);
      final=await call(`check-${i}`,{card:final,originalPage:pages[i]},refs,
        '复核短卡与本页原文。只修复主角身份、能力条件、全书关键规则、作者要求的明确遗漏或错误；不把生活细目补回来。保留原卡其他正确内容，输出完整六栏短卡，不输出思考过程。');
    }
    if (!Object.values(final).some(entries => entries.length)) throw Error('资料短卡未提取到有效信息，原文及已完成批次保留。');
    // Keep fragment mapping alongside the derived card for source inspection.
    this.database.prepare('INSERT OR IGNORE INTO v7_book_design_cards VALUES(?,?,?,?,?,?)')
      .run(snapshot.ownerId,snapshot.bookId,sourceKey,'source-map',JSON.stringify(fragments.map(({ref,sourceId,path})=>({ref,sourceId,path}))),new Date().toISOString());
    save('ready',final); return get('ready')!;
  }
}
