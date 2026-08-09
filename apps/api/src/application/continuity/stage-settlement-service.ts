import type { Clock, IdGenerator } from '../../domain/ids.js';
import type { BookScope } from '../../domain/scope.js';
import type { LongformContinuityRepository } from '../../infrastructure/db/repositories/longform-continuity-repository.js';
import type { UnitOfWork } from '../../infrastructure/db/unit-of-work.js';

export interface SettlementProbe { type: 'fact' | 'state' | 'commitment' | 'causality' | 'source' | 'negative'; expected: unknown; actual: unknown; passed: boolean }
export interface SettlementSource { sourceType: string; sourceId: string; sourceHash: string; locator: Record<string, unknown> }

export class StageSettlementService {
  public constructor(private readonly repository: LongformContinuityRepository, private readonly unitOfWork: UnitOfWork, private readonly ids: IdGenerator, private readonly clock: Clock) {}

  public closeCurrentStoryArc(scope: BookScope, title = '当前剧情阶段'): {
    settlementId: string;
    chapterStart: number;
    chapterEnd: number;
  } {
    const chapterStart = this.repository.latestStageEnd(scope, 'story_arc') + 1;
    const chapterEnd = this.repository.latestSettledChapter(scope);
    if (chapterEnd < chapterStart) throw new Error('当前没有尚未结算为剧情阶段的已定稿章节');
    const chapters = this.repository.activeChapterSettlements(scope, chapterStart, chapterEnd);
    const expectedCount = chapterEnd - chapterStart + 1;
    if (chapters.length !== expectedCount) {
      throw new Error('剧情阶段内存在缺失的章节结算，不能生成可能漏掉正史的阶段摘要');
    }
    const canonRevision = this.repository.latestCanonRevision(scope);
    const latest = chapters.at(-1)!;
    const payload = {
      irreversibleResults: uniqueJson(chapters.flatMap((item) => arrayValue(item.payload.irreversibleResults))),
      entityStates: latest.payload.entityStates,
      closedThreads: uniqueJson(chapters.flatMap((item) => arrayValue(item.payload.closedThreads))),
      openThreads: latest.payload.openThreads,
      relationshipChanges: uniqueJson(chapters.flatMap((item) => arrayValue(item.payload.relationshipChanges))),
      knowledgeChanges: uniqueJson(chapters.flatMap((item) => arrayValue(item.payload.knowledgeChanges))),
      resourceChanges: uniqueJson(chapters.flatMap((item) => arrayValue(item.payload.resourceChanges))),
      ruleChanges: uniqueJson(chapters.flatMap((item) => arrayValue(item.payload.ruleChanges))),
      exclusions: ['旧版会话原文', '未定稿正文', '未锁定剧情预测', '被否决或已替代方案']
    };
    const built = this.build(scope, {
      stageType: 'story_arc',
      stageKey: `story-arc:${chapterStart}-${chapterEnd}:${title.trim() || '未命名阶段'}`,
      chapterStart,
      chapterEnd,
      canonRevision,
      payload,
      sources: chapters.map((chapter) => ({
        sourceType: 'chapter_settlement',
        sourceId: chapter.settlementId,
        sourceHash: this.repository.settlementSourceHash(chapter),
        locator: {
          chapterStart: chapter.chapterStart,
          chapterEnd: chapter.chapterEnd,
          settlementVersion: chapter.version
        }
      })),
      probes: [
        { type: 'source', expected: expectedCount, actual: chapters.length, passed: chapters.length === expectedCount },
        { type: 'state', expected: canonRevision, actual: Math.max(...chapters.map((item) => item.canonRevision)), passed: chapters.every((item) => item.canonRevision <= canonRevision) },
        { type: 'causality', expected: [chapterStart, chapterEnd], actual: [chapters[0]!.chapterStart, latest.chapterEnd], passed: chapters[0]!.chapterStart === chapterStart && latest.chapterEnd === chapterEnd }
      ]
    });
    if (!built.activated) throw new Error('剧情阶段结算探针未通过，已保留原章节正史且未切换摘要');
    return { settlementId: built.settlementId, chapterStart, chapterEnd };
  }

  public build(scope: BookScope, input: {
    stageType: 'chapter' | 'story_arc' | 'volume' | 'book'; stageKey: string; chapterStart: number; chapterEnd: number;
    canonRevision: number; payload: Record<string, unknown>; sources: SettlementSource[]; probes: SettlementProbe[];
  }): { settlementId: string; activated: boolean; retainedPreviousId: string | null } {
    if (input.sources.length === 0) throw new Error('阶段结算不能没有正史来源');
    if (input.sources.some((source) => source.sourceHash.length !== 64)) throw new Error('阶段结算来源哈希无效');
    if (input.probes.length === 0) throw new Error('阶段结算必须包含至少一个可验证探针');
    const previous = this.repository.activeSettlement(scope, input.stageType, input.stageKey);
    const id = this.ids.next();
    const now = this.clock.now().toISOString();
    const allPassed = input.probes.every((probe) => probe.passed);
    this.unitOfWork.run(() => {
      this.repository.insertSettlement(scope, { id, stageType: input.stageType, stageKey: input.stageKey,
        version: this.repository.nextSettlementVersion(scope, input.stageType, input.stageKey), chapterStart: input.chapterStart,
        chapterEnd: input.chapterEnd, canonRevision: input.canonRevision, payload: input.payload, status: 'building', now });
      for (const source of input.sources) this.repository.insertSettlementSource(scope, { id: this.ids.next(), settlementId: id, ...source, now });
      for (const probe of input.probes) this.repository.insertProbe(scope, { id: this.ids.next(), settlementId: id, ...probe, now });
      if (allPassed) this.repository.activateSettlement(scope, id, input.stageType, input.stageKey, now);
      else this.repository.failSettlement(scope, id);
    });
    return { settlementId: id, activated: allPassed, retainedPreviousId: allPassed ? null : previous?.id ?? null };
  }
}

function arrayValue(value: unknown): unknown[] {
  return Array.isArray(value) ? value : value === null || value === undefined ? [] : [value];
}

function uniqueJson(values: unknown[]): unknown[] {
  const seen = new Set<string>();
  return values.filter((value) => {
    const key = JSON.stringify(value);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
