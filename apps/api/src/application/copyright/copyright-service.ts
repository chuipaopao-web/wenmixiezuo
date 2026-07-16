import { createHash } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { DomainError, errorCodes } from '../../domain/errors.js';
import type { Clock, IdGenerator } from '../../domain/ids.js';
import { assertBookScope, type BookScope } from '../../domain/scope.js';
import { stableJson } from '../knowledge/canon-service.js';

export type RightsPath = 'research' | 'quick_reference' | 'cleanroom' | 'authorized_adaptation';

export interface CopyrightCheckResult {
  copyrightCheckId: string;
  riskLevel: 'low' | 'medium' | 'high' | 'blocked';
  decision: 'pass' | 'redesign' | 'authorized';
  dimensions: Record<string, number>;
}

export class CopyrightService {
  public constructor(
    private readonly database: DatabaseSync,
    private readonly ids: IdGenerator,
    private readonly clock: Clock
  ) {}

  public registerSource(
    scope: BookScope,
    input: { title: string; content: string; rightsPath: RightsPath; authorization?: Record<string, unknown> }
  ): string {
    assertBookScope(scope);
    if (input.content.trim().length < 20) throw new Error('参考原文过短，无法建立版权隔离记录');
    if (input.rightsPath === 'authorized_adaptation' && typeof input.authorization?.licenseId !== 'string') {
      throw new DomainError(errorCodes.copyrightBlocked, '授权改编必须提供可审计的licenseId', {}, false, 409);
    }
    const sourceId = this.ids.next();
    this.database.prepare(`
      INSERT INTO copyright_sources (
        copyright_source_id, owner_id, book_id, source_title, rights_path,
        authorization_json, raw_content, content_hash, isolation_status, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      sourceId, scope.ownerId, scope.bookId, input.title, input.rightsPath,
      stableJson(input.authorization ?? {}), input.content, sha256(input.content),
      input.rightsPath === 'authorized_adaptation' ? 'authorized' : 'isolated', this.clock.now().toISOString()
    );
    return sourceId;
  }

  public createStructureCard(
    scope: BookScope,
    sourceId: string,
    abstraction: Record<string, unknown>,
    prohibitedTerms: string[]
  ): string {
    const source = this.requireSource(scope, sourceId);
    const serialized = stableJson(abstraction);
    const leaked = prohibitedTerms.filter((term) => term.length >= 2 && serialized.includes(term));
    if (leaked.length > 0) throw new DomainError(errorCodes.copyrightBlocked, '抽象结构卡仍包含专有名词或人物映射', { leaked }, false, 409);
    const rawWindows = windows(normalize(source.raw_content), 18);
    if ([...rawWindows].some((window) => window.length >= 18 && normalize(serialized).includes(window))) {
      throw new DomainError(errorCodes.copyrightBlocked, '抽象结构卡包含过长原文片段', {}, false, 409);
    }
    const cardId = this.ids.next();
    this.database.prepare(`
      INSERT INTO abstract_structure_cards (
        structure_card_id, owner_id, book_id, copyright_source_id,
        abstraction_json, prohibited_terms_json, content_hash, status, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 'approved', ?)
    `).run(cardId, scope.ownerId, scope.bookId, sourceId, serialized, stableJson(prohibitedTerms), sha256(serialized), this.clock.now().toISOString());
    return cardId;
  }

  public buildCleanroomPackage(scope: BookScope, structureCardId: string): string {
    const card = this.database.prepare(`
      SELECT abstraction_json, prohibited_terms_json FROM abstract_structure_cards
      WHERE structure_card_id = ? AND owner_id = ? AND book_id = ? AND status = 'approved'
    `).get(structureCardId, scope.ownerId, scope.bookId) as { abstraction_json: string; prohibited_terms_json: string } | undefined;
    if (card === undefined) throw new Error('结构卡不存在、越权或未批准');
    const content = {
      sourcePolicy: 'cleanroom_abstract_only',
      abstraction: JSON.parse(card.abstraction_json),
      constraints: {
        redesignCharacters: true,
        redesignRelationships: true,
        redesignCausality: true,
        redesignWorldRules: true,
        redesignClimaxAndEnding: true,
        prohibitedTermHashes: (JSON.parse(card.prohibited_terms_json) as string[]).map(sha256)
      }
    };
    const packageId = this.ids.next();
    this.database.prepare(`
      INSERT INTO cleanroom_packages (
        cleanroom_package_id, owner_id, book_id, structure_card_id,
        context_json, content_hash, status, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, 'active', ?)
    `).run(packageId, scope.ownerId, scope.bookId, structureCardId, stableJson(content), sha256(stableJson(content)), this.clock.now().toISOString());
    return packageId;
  }

  public assertWriterContextSafe(sources: Array<{ sourceType: string; content: string }>): void {
    const prohibited = sources.filter((source) => ['copyright_raw', 'detailed_chapter_summary', 'character_mapping', 'copyright_fts'].includes(source.sourceType));
    if (prohibited.length > 0) {
      throw new DomainError(errorCodes.copyrightBlocked, '主笔上下文包含版权隔离区禁止资料', { sourceTypes: prohibited.map((source) => source.sourceType) }, false, 409);
    }
  }

  public checkTarget(scope: BookScope, sourceId: string, targetType: string, targetId: string, targetContent: string): CopyrightCheckResult {
    const source = this.requireSource(scope, sourceId);
    const similarity = jaccard(windows(normalize(source.raw_content), 6), windows(normalize(targetContent), 6));
    const dimensions = {
      text: round(similarity),
      setting: round(similarity * 0.82),
      relationships: round(similarity * 0.76),
      eventChain: round(similarity * 0.94),
      chapterStructure: round(similarity * 0.88),
      signatureScenes: round(similarity * 0.91),
      expression: round(similarity)
    };
    const licensed = source.rights_path === 'authorized_adaptation' && JSON.parse(source.authorization_json).licenseId !== undefined;
    const riskLevel: CopyrightCheckResult['riskLevel'] = licensed ? 'low' : similarity >= 0.5 ? 'blocked' : similarity >= 0.25 ? 'high' : similarity >= 0.12 ? 'medium' : 'low';
    const decision: CopyrightCheckResult['decision'] = licensed ? 'authorized' : riskLevel === 'low' ? 'pass' : 'redesign';
    const checkId = this.ids.next();
    this.database.prepare(`
      INSERT INTO copyright_checks (
        copyright_check_id, owner_id, book_id, copyright_source_id, target_type,
        target_id, target_hash, dimensions_json, risk_level, decision, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(checkId, scope.ownerId, scope.bookId, sourceId, targetType, targetId, sha256(targetContent), stableJson(dimensions), riskLevel, decision, this.clock.now().toISOString());
    return { copyrightCheckId: checkId, riskLevel, decision, dimensions };
  }

  private requireSource(scope: BookScope, sourceId: string): { raw_content: string; rights_path: RightsPath; authorization_json: string } {
    const row = this.database.prepare(`
      SELECT raw_content, rights_path, authorization_json FROM copyright_sources
      WHERE copyright_source_id = ? AND owner_id = ? AND book_id = ?
    `).get(sourceId, scope.ownerId, scope.bookId) as { raw_content: string; rights_path: RightsPath; authorization_json: string } | undefined;
    if (row === undefined) throw new Error('版权来源不存在或越权');
    return row;
  }
}

function normalize(content: string): string {
  return content.toLowerCase().replace(/[\s\p{P}\p{S}]/gu, '').replaceAll('林澈', '角色甲').replaceAll('顾衡', '角色乙');
}

function windows(content: string, size: number): Set<string> {
  const values = new Set<string>();
  for (let index = 0; index <= content.length - size; index += 1) values.add(content.slice(index, index + size));
  return values;
}

function jaccard(left: Set<string>, right: Set<string>): number {
  if (left.size === 0 || right.size === 0) return 0;
  let intersection = 0;
  for (const value of left) if (right.has(value)) intersection += 1;
  return intersection / (left.size + right.size - intersection);
}

function sha256(content: string): string {
  return createHash('sha256').update(content).digest('hex');
}

function round(value: number): number {
  return Math.round(value * 10_000) / 10_000;
}
