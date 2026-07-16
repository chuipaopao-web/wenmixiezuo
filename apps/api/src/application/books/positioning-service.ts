import type { DatabaseSync } from 'node:sqlite';
import type { Clock, IdGenerator } from '../../domain/ids.js';
import type { PositioningDraft, PositioningField, PositioningTag, SourceStatus } from '../../domain/positioning.js';
import { assertOwnerScope, type OwnerScope } from '../../domain/scope.js';
import { OwnerRepository } from '../../infrastructure/db/repositories/owner-repository.js';

interface DraftRow {
  draft_id: string;
  proposed_book_id: string;
  title: string;
  input_text: string;
  fields_json: string;
  tags_json: string;
  status: PositioningDraft['status'];
  version: number;
  confirmed_book_id: string | null;
}

export class PositioningService {
  public constructor(
    private readonly database: DatabaseSync,
    private readonly ids: IdGenerator,
    private readonly clock: Clock
  ) {}

  public createDraft(
    scope: OwnerScope,
    input: { title?: string; text: string; category?: string; tags?: string[]; style?: string }
  ): PositioningDraft {
    assertOwnerScope(scope);
    new OwnerRepository(this.database).ensure(scope, '老板', this.clock.now().toISOString());
    const text = input.text.trim();
    if (text.length < 2) throw new Error('定位描述至少需要2个字符');
    const inferredGenre = inferGenre(text);
    const explicitGenre = input.category?.trim() || null;
    const genreStatus: SourceStatus = explicitGenre !== null && inferredGenre !== null && explicitGenre !== inferredGenre
      ? 'conflict'
      : explicitGenre !== null ? 'explicit' : inferredGenre !== null ? 'inferred' : 'unspecified';
    const fields: PositioningField[] = [
      { key: 'premise', label: '核心创意', value: text, sourceStatus: 'explicit', evidence: text },
      { key: 'genre', label: '题材', value: explicitGenre ?? inferredGenre, sourceStatus: genreStatus, evidence: explicitGenre === null ? inferredGenre : explicitGenre },
      { key: 'style', label: '文风', value: input.style?.trim() || null, sourceStatus: input.style ? 'explicit' : 'unspecified', evidence: input.style ?? null },
      { key: 'audience', label: '目标读者', value: null, sourceStatus: 'unspecified', evidence: null },
      { key: 'ending', label: '结局倾向', value: null, sourceStatus: 'unspecified', evidence: null }
    ];
    const tags: PositioningTag[] = (input.tags ?? []).map((name): PositioningTag => ({ name: name.trim(), category: 'dynamic', sourceStatus: 'explicit' }))
      .filter((tag) => tag.name.length > 0);
    if (inferredGenre !== null && !tags.some((tag) => tag.name === inferredGenre)) {
      tags.push({ name: inferredGenre, category: 'genre', sourceStatus: explicitGenre === null ? 'inferred' : genreStatus });
    }
    const draftId = this.ids.next();
    const proposedBookId = this.ids.next();
    const title = input.title?.trim() || suggestTitle(text);
    const now = this.clock.now().toISOString();
    this.database.prepare(`
      INSERT INTO positioning_drafts (
        draft_id, owner_id, proposed_book_id, title, input_text, fields_json,
        tags_json, status, version, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 'editing', 1, ?, ?)
    `).run(draftId, scope.ownerId, proposedBookId, title, text, JSON.stringify(fields), JSON.stringify(tags), now, now);
    return this.require(scope, draftId);
  }

  public updateDraft(
    scope: OwnerScope,
    draftId: string,
    expectedVersion: number,
    patch: { title?: string; fields?: PositioningField[]; tags?: PositioningTag[] }
  ): PositioningDraft {
    const current = this.require(scope, draftId);
    if (current.status !== 'editing') throw new Error('定位草稿已结束编辑');
    const now = this.clock.now().toISOString();
    const result = this.database.prepare(`
      UPDATE positioning_drafts SET title = ?, fields_json = ?, tags_json = ?,
        version = version + 1, updated_at = ?
      WHERE draft_id = ? AND owner_id = ? AND version = ? AND status = 'editing'
    `).run(
      patch.title?.trim() || current.title,
      JSON.stringify(patch.fields ?? current.fields),
      JSON.stringify(patch.tags ?? current.tags),
      now,
      draftId,
      scope.ownerId,
      expectedVersion
    );
    if (result.changes !== 1) throw new Error('定位草稿版本已经变化');
    return this.require(scope, draftId);
  }

  public require(scope: OwnerScope, draftId: string): PositioningDraft {
    assertOwnerScope(scope);
    const row = this.database.prepare(`
      SELECT draft_id, proposed_book_id, title, input_text, fields_json, tags_json,
             status, version, confirmed_book_id
      FROM positioning_drafts WHERE draft_id = ? AND owner_id = ?
    `).get(draftId, scope.ownerId) as DraftRow | undefined;
    if (row === undefined) throw new Error('定位草稿不存在或越权');
    return {
      draftId: row.draft_id,
      proposedBookId: row.proposed_book_id,
      title: row.title,
      inputText: row.input_text,
      fields: JSON.parse(row.fields_json) as PositioningField[],
      tags: JSON.parse(row.tags_json) as PositioningTag[],
      status: row.status,
      version: row.version,
      confirmedBookId: row.confirmed_book_id
    };
  }
}

function inferGenre(text: string): string | null {
  const rules: Array<[RegExp, string]> = [
    [/游戏|副本|玩家|装备/, '游戏'],
    [/历史|北宋|唐朝|明朝|古代/, '历史'],
    [/悬疑|谜案|侦探|凶手/, '悬疑'],
    [/科幻|星际|太空|人工智能/, '科幻'],
    [/仙侠|修仙|灵气|宗门/, '仙侠'],
    [/都市|职场|现代/, '都市']
  ];
  return rules.find(([pattern]) => pattern.test(text))?.[1] ?? null;
}

function suggestTitle(text: string): string {
  const compact = text.replace(/[，。！？、\s]/g, '').slice(0, 12);
  return compact.length > 0 ? compact : '未命名新书';
}
