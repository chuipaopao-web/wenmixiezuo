import type { DatabaseSync } from 'node:sqlite';
import type { Clock, IdGenerator } from '../../domain/ids.js';
import type { PositioningDraft, PositioningField, PositioningTag, SourceStatus } from '../../domain/positioning.js';
import { assertOwnerScope, type OwnerScope } from '../../domain/scope.js';
import { OwnerRepository } from '../../infrastructure/db/repositories/owner-repository.js';
import {
  OPENING_TAXONOMY,
  validateOpeningBlueprint,
  type OpeningBlueprintInput
} from '../../contracts/opening-blueprint.js';

interface DraftRow {
  draft_id: string;
  proposed_book_id: string;
  title: string;
  input_text: string;
  fields_json: string;
  tags_json: string;
  opening_blueprint_json: string;
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
    input: {
      title?: string;
      text: string;
      category?: string;
      classification?: string;
      targetAudience?: string;
      expectedScaleChars?: number;
      initialExpressionBaseline?: string;
      tags?: string[];
      style?: string;
      openingBlueprint?: OpeningBlueprintInput;
    }
  ): PositioningDraft {
    assertOwnerScope(scope);
    new OwnerRepository(this.database).ensure(scope, '老板', this.clock.now().toISOString());
    const requestedTitle = input.title?.trim() ?? '';
    if (input.openingBlueprint !== undefined && requestedTitle.length === 0) throw new Error('完整开书必须填写书名');
    if (requestedTitle.length > 120) throw new Error('书名不能超过120个字符');
    const openingBlueprint = input.openingBlueprint === undefined ? null : validateOpeningBlueprint(input.openingBlueprint);
    const text = openingBlueprint?.storyDirection ?? input.text.trim();
    if (text.length < 2) throw new Error('定位描述至少需要2个字符');
    if (input.expectedScaleChars !== undefined && (
      !Number.isInteger(input.expectedScaleChars)
      || input.expectedScaleChars < 1_000
      || input.expectedScaleChars > 10_000_000
    )) {
      throw new Error('预计规模必须是1,000至10,000,000之间的整数');
    }
    const openingCategory = openingBlueprint === null
      ? null
      : OPENING_TAXONOMY.categories.find((item) => item.key === openingBlueprint.categoryKey)!;
    const inferredGenre = openingBlueprint === null ? inferGenre(text) : null;
    const explicitGenre = openingCategory?.name ?? input.category?.trim() ?? null;
    const genreStatus: SourceStatus = explicitGenre !== null && inferredGenre !== null && explicitGenre !== inferredGenre
      ? 'conflict'
      : explicitGenre !== null ? 'explicit' : inferredGenre !== null ? 'inferred' : 'unspecified';
    const fields: PositioningField[] = [
      { key: 'premise', label: '核心创意', value: text, sourceStatus: 'explicit', evidence: text },
      { key: 'genre', label: '题材', value: explicitGenre ?? inferredGenre, sourceStatus: genreStatus, evidence: explicitGenre === null ? inferredGenre : explicitGenre },
      {
        key: 'classification', label: '分类',
        value: openingBlueprint === null ? input.classification?.trim() || null : openingBlueprint.channel === 'male' ? '男频' : '女频',
        sourceStatus: openingBlueprint !== null || input.classification ? 'explicit' : 'unspecified',
        evidence: openingBlueprint === null ? input.classification ?? null : openingBlueprint.categoryKey
      },
      {
        key: 'audience',
        label: '目标读者',
        value: openingBlueprint?.targetAudience ?? (input.targetAudience?.trim() || null),
        sourceStatus: openingBlueprint !== null || input.targetAudience ? 'explicit' : 'unspecified',
        evidence: openingBlueprint?.targetAudience ?? input.targetAudience ?? null
      },
      {
        key: 'expected_scale_chars',
        label: '预计规模',
        value: input.expectedScaleChars === undefined ? null : String(input.expectedScaleChars),
        sourceStatus: input.expectedScaleChars === undefined ? 'unspecified' : 'explicit',
        evidence: input.expectedScaleChars === undefined ? null : String(input.expectedScaleChars)
      },
      {
        key: 'expression_baseline',
        label: '初始表达基线',
        value: input.initialExpressionBaseline?.trim() || input.style?.trim() || null,
        sourceStatus: input.initialExpressionBaseline || input.style ? 'explicit' : 'unspecified',
        evidence: input.initialExpressionBaseline ?? input.style ?? null
      }
    ];
    const inputTags = openingBlueprint === null
      ? input.tags ?? []
      : [openingCategory!.name, ...openingBlueprint.mainTags, ...openingBlueprint.auxiliaryTags,
        ...openingBlueprint.storyTraits, ...openingBlueprint.customTags,
        ...openingBlueprint.mustFollow.map((item) => `必须遵守：${item}`)];
    const tags: PositioningTag[] = [...new Set(inputTags.map((name) => name.trim()).filter(Boolean))]
      .map((name): PositioningTag => ({ name, category: 'dynamic', sourceStatus: 'explicit' }));
    if (inferredGenre !== null && !tags.some((tag) => tag.name === inferredGenre)) {
      tags.push({ name: inferredGenre, category: 'genre', sourceStatus: explicitGenre === null ? 'inferred' : genreStatus });
    }
    const draftId = this.ids.next();
    const proposedBookId = this.ids.next();
    const title = requestedTitle || suggestTitle(text);
    const now = this.clock.now().toISOString();
    this.database.prepare(`
      INSERT INTO positioning_drafts (
        draft_id, owner_id, proposed_book_id, title, input_text, fields_json,
        tags_json, opening_blueprint_json, status, version, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'editing', 1, ?, ?)
    `).run(
      draftId, scope.ownerId, proposedBookId, title, text, JSON.stringify(fields), JSON.stringify(tags),
      JSON.stringify(openingBlueprint ?? {}), now, now
    );
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
      SELECT draft_id, proposed_book_id, title, input_text, fields_json, tags_json, opening_blueprint_json,
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
      openingBlueprint: parseOpeningBlueprint(row.opening_blueprint_json),
      status: row.status,
      version: row.version,
      confirmedBookId: row.confirmed_book_id
    };
  }
}

function parseOpeningBlueprint(value: string): OpeningBlueprintInput | null {
  const parsed = JSON.parse(value) as Record<string, unknown>;
  return Object.keys(parsed).length === 0 ? null : parsed as unknown as OpeningBlueprintInput;
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
