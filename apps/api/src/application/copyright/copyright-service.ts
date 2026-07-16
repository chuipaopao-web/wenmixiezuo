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

export interface AggregateCopyrightCheckResult {
  sourceCount: number;
  riskLevel: CopyrightCheckResult['riskLevel'];
  decision: CopyrightCheckResult['decision'];
  dimensions: Record<string, number>;
  checks: CopyrightCheckResult[];
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
    const eventSimilarity = eventChainSimilarity(source.raw_content, serialized);
    if (eventVerbs(source.raw_content).length >= 3 && eventSimilarity >= 0.6) {
      throw new DomainError(errorCodes.copyrightBlocked, '抽象结构卡仍保留原事件顺序', { eventSimilarity }, false, 409);
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

  public validatePreGeneration(scope: BookScope): void {
    assertBookScope(scope);
    const incomplete = this.database.prepare(`
      SELECT s.copyright_source_id FROM copyright_sources s
      WHERE s.owner_id = ? AND s.book_id = ? AND s.rights_path = 'cleanroom'
        AND NOT EXISTS (
          SELECT 1 FROM abstract_structure_cards c
          JOIN cleanroom_packages p ON p.structure_card_id = c.structure_card_id
          WHERE c.copyright_source_id = s.copyright_source_id
            AND c.owner_id = s.owner_id AND c.book_id = s.book_id
            AND c.status = 'approved' AND p.status = 'active'
        )
    `).all(scope.ownerId, scope.bookId) as unknown[];
    if (incomplete.length > 0) {
      throw new DomainError(errorCodes.copyrightBlocked, '干净室参考尚未形成可用的抽象上下文包', { incompleteCount: incomplete.length }, false, 409);
    }
  }

  public checkTarget(scope: BookScope, sourceId: string, targetType: string, targetId: string, targetContent: string): CopyrightCheckResult {
    const source = this.requireSource(scope, sourceId);
    const similarity = jaccard(windows(normalize(source.raw_content), 6), windows(normalize(targetContent), 6));
    const eventSimilarity = eventChainSimilarity(source.raw_content, targetContent);
    const languagesDiffer = languageFamily(source.raw_content) !== languageFamily(targetContent)
      && languageFamily(source.raw_content) !== 'unknown' && languageFamily(targetContent) !== 'unknown';
    const crossLanguage = languagesDiffer && eventSimilarity >= 0.5;
    const dimensions = {
      text: round(similarity),
      setting: round(similarity * 0.82),
      relationships: round(similarity * 0.76),
      eventChain: round(Math.max(similarity * 0.94, eventSimilarity)),
      chapterStructure: round(similarity * 0.88),
      signatureScenes: round(Math.max(similarity * 0.91, eventSimilarity * 0.9)),
      expression: round(similarity),
      translationRisk: crossLanguage ? 1 : 0
    };
    const licensed = source.rights_path === 'authorized_adaptation' && JSON.parse(source.authorization_json).licenseId !== undefined;
    const score = Math.max(similarity, eventSimilarity, crossLanguage ? 0.75 : 0);
    const riskLevel: CopyrightCheckResult['riskLevel'] = licensed ? 'low' : score >= 0.5 ? 'blocked' : score >= 0.25 ? 'high' : score >= 0.12 ? 'medium' : 'low';
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

  public checkTargetAgainstAllSources(scope: BookScope, targetType: string, targetId: string, targetContent: string): AggregateCopyrightCheckResult {
    assertBookScope(scope);
    const sources = this.database.prepare(`
      SELECT copyright_source_id, raw_content FROM copyright_sources
      WHERE owner_id = ? AND book_id = ? AND rights_path <> 'authorized_adaptation'
      ORDER BY copyright_source_id
    `).all(scope.ownerId, scope.bookId) as unknown as Array<{ copyright_source_id: string; raw_content: string }>;
    if (sources.length === 0) {
      return { sourceCount: 0, riskLevel: 'low', decision: 'pass', dimensions: { combinedText: 0, eventChain: 0, translationRisk: 0 }, checks: [] };
    }
    const checks = sources.map((source) => this.checkTarget(scope, source.copyright_source_id, targetType, targetId, targetContent));
    const targetWindows = windows(normalize(targetContent), 6);
    const combinedWindows = new Set<string>();
    for (const source of sources) for (const window of windows(normalize(source.raw_content), 6)) combinedWindows.add(window);
    const combinedText = coverage(targetWindows, combinedWindows);
    const eventChain = Math.max(...sources.map((source) => eventChainSimilarity(source.raw_content, targetContent)));
    const translationRisk = Math.max(...checks.map((check) => check.dimensions.translationRisk ?? 0));
    const score = Math.max(combinedText, eventChain, translationRisk * 0.75);
    const riskLevel: CopyrightCheckResult['riskLevel'] = score >= 0.5 ? 'blocked' : score >= 0.25 ? 'high' : score >= 0.12 ? 'medium' : 'low';
    return {
      sourceCount: sources.length,
      riskLevel,
      decision: riskLevel === 'low' ? 'pass' : 'redesign',
      dimensions: { combinedText: round(combinedText), eventChain: round(eventChain), translationRisk },
      checks
    };
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
  return content.normalize('NFKC').toLowerCase().replace(/[\s\p{P}\p{S}]/gu, '');
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

function coverage(target: Set<string>, sources: Set<string>): number {
  if (target.size === 0) return 0;
  let matched = 0;
  for (const value of target) if (sources.has(value)) matched += 1;
  return matched / target.size;
}

const eventVerbVocabulary = [
  ['发现', 'discover'], ['find', 'discover'], ['discover', 'discover'],
  ['进入', 'enter'], ['enter', 'enter'], ['观察', 'observe'], ['observe', 'observe'],
  ['确认', 'confirm'], ['confirm', 'confirm'], ['诱使', 'lure'], ['lure', 'lure'],
  ['修正', 'correct'], ['correct', 'correct'], ['取回', 'retrieve'], ['retrieve', 'retrieve'],
  ['逃离', 'escape'], ['escape', 'escape'], ['追踪', 'track'], ['track', 'track'],
  ['交换', 'exchange'], ['exchange', 'exchange'], ['隐藏', 'hide'], ['hide', 'hide'],
  ['揭露', 'reveal'], ['reveal', 'reveal'], ['背叛', 'betray'], ['betray', 'betray'],
  ['营救', 'rescue'], ['rescue', 'rescue'], ['杀死', 'kill'], ['kill', 'kill'],
  ['复活', 'revive'], ['revive', 'revive']
] as const;

function eventVerbs(content: string): string[] {
  const normalized = content.normalize('NFKC').toLowerCase();
  const occurrences: Array<{ verb: string; index: number }> = [];
  for (const [verb, canonical] of eventVerbVocabulary) {
    let offset = normalized.indexOf(verb);
    while (offset >= 0) {
      occurrences.push({ verb: canonical, index: offset });
      offset = normalized.indexOf(verb, offset + verb.length);
    }
  }
  return occurrences.sort((left, right) => left.index - right.index).map((item) => item.verb);
}

function eventChainSimilarity(left: string, right: string): number {
  const leftEvents = eventVerbs(left);
  const rightEvents = eventVerbs(right);
  if (leftEvents.length < 2 || rightEvents.length < 2) return 0;
  const rows = Array.from({ length: leftEvents.length + 1 }, () => Array<number>(rightEvents.length + 1).fill(0));
  for (let leftIndex = 1; leftIndex <= leftEvents.length; leftIndex += 1) {
    for (let rightIndex = 1; rightIndex <= rightEvents.length; rightIndex += 1) {
      rows[leftIndex]![rightIndex] = leftEvents[leftIndex - 1] === rightEvents[rightIndex - 1]
        ? rows[leftIndex - 1]![rightIndex - 1]! + 1
        : Math.max(rows[leftIndex - 1]![rightIndex]!, rows[leftIndex]![rightIndex - 1]!);
    }
  }
  return rows[leftEvents.length]![rightEvents.length]! / Math.max(leftEvents.length, rightEvents.length);
}

function languageFamily(content: string): 'cjk' | 'latin' | 'unknown' {
  const cjk = (content.match(/[\p{Script=Han}]/gu) ?? []).length;
  const latin = (content.match(/[A-Za-z]/g) ?? []).length;
  if (cjk >= 8 && cjk > latin) return 'cjk';
  if (latin >= 12 && latin > cjk) return 'latin';
  return 'unknown';
}

function sha256(content: string): string {
  return createHash('sha256').update(content).digest('hex');
}

function round(value: number): number {
  return Math.round(value * 10_000) / 10_000;
}
