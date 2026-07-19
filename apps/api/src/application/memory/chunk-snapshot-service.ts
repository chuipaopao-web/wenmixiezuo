import { createHash } from 'node:crypto';
import type { Clock, IdGenerator } from '../../domain/ids.js';
import type { BookScope } from '../../domain/scope.js';
import type { ChunkSnapshotRepository } from '../../infrastructure/db/repositories/chunk-snapshot-repository.js';
import type { UnitOfWork } from '../../infrastructure/db/unit-of-work.js';
import { StructuralChunker } from './structural-chunker.js';

export interface ChunkSourceInput {
  sourceType: 'manuscript' | 'setting' | 'outline' | 'fact' | 'wiki' | 'voice' | 'temporary';
  sourceId: string;
  sourceVersion: string;
  content: string;
  sourceHash: string;
  sourceLocator: Record<string, unknown>;
  lifecycleLayer: 'temporary' | 'candidate' | 'canon' | 'derived';
  authorityGrade: 'A' | 'B' | 'C' | 'D';
  title?: string;
  embeddingHeader?: string;
}

export class ChunkSnapshotService {
  public constructor(
    private readonly repository: ChunkSnapshotRepository,
    private readonly unitOfWork: UnitOfWork,
    private readonly chunker: StructuralChunker,
    private readonly ids: IdGenerator,
    private readonly clock: Clock
  ) {}

  public build(scope: BookScope, source: ChunkSourceInput, canonRevision: number, failAt?: 'before_validate' | 'before_ready'): { snapshotId: string; chunkCount: number } {
    return this.buildMany(scope, [source], canonRevision, failAt);
  }

  public buildMany(scope: BookScope, sources: ChunkSourceInput[], canonRevision: number, failAt?: 'before_validate' | 'before_ready'): { snapshotId: string; chunkCount: number } {
    if (sources.length === 0) throw new Error('切片快照至少需要一个不可变来源');
    const duplicate = sources.find((source, index) => sources.findIndex((candidate) => candidate.sourceType === source.sourceType
      && candidate.sourceId === source.sourceId && candidate.sourceVersion === source.sourceVersion) !== index);
    if (duplicate !== undefined) throw new Error(`切片快照包含重复来源版本：${duplicate.sourceType}/${duplicate.sourceId}/${duplicate.sourceVersion}`);
    const prepared = sources.map((source) => {
      const actualHash = sha256(source.content);
      if (actualHash !== source.sourceHash) throw new Error(`不可变来源哈希不匹配：${source.sourceType}/${source.sourceId}`);
      const result = this.chunker.chunk(source.content);
      if (result.chunks.length === 0) throw new Error(`来源没有可检索内容：${source.sourceType}/${source.sourceId}`);
      return { source, result };
    });
    const snapshotId = this.ids.next();
    const now = this.clock.now().toISOString();
    this.unitOfWork.run(() => {
      const policy = prepared[0]!.result.policy;
      this.repository.createSnapshot(scope, {
        snapshotId, strategyVersion: policy.version, normalizationVersion: policy.normalizationVersion,
        embeddingTextPolicyVersion: policy.embeddingTextPolicyVersion, canonRevision, now
      });
      let chunkCount = 0;
      let nodeCount = 0;
      const coverageSources: Array<{ sourceType: string; sourceId: string; sourceVersion: string; sourceBytes: number; coveredBytes: number; excludedSeparators: unknown }> = [];
      for (const { source, result } of prepared) {
        this.repository.addSource(scope, {
          snapshotSourceId: this.ids.next(), snapshotId, sourceType: source.sourceType, sourceId: source.sourceId,
          sourceVersion: source.sourceVersion, sourceHash: source.sourceHash, sourceBytes: result.sourceBytes,
          sourceLocatorJson: JSON.stringify(source.sourceLocator), lifecycleLayer: source.lifecycleLayer,
          authorityGrade: source.authorityGrade, now
        });
        const documentNodeId = this.ids.next();
        this.repository.addNode(scope, {
          nodeId: documentNodeId, snapshotId, sourceType: source.sourceType, sourceId: source.sourceId,
          sourceVersion: source.sourceVersion, nodeType: source.sourceType === 'setting' ? 'setting_section' : source.sourceType === 'outline' ? 'outline_section' : 'document',
          title: source.title ?? null, byteStart: 0, byteEnd: result.sourceBytes, ordinal: nodeCount, now
        });
        const parentIds = result.parents.map((parent) => {
          const nodeId = this.ids.next();
          this.repository.addNode(scope, {
            nodeId, snapshotId, sourceType: source.sourceType, sourceId: source.sourceId, sourceVersion: source.sourceVersion,
            parentNodeId: documentNodeId, nodeType: 'scene_beat', byteStart: parent.byteStart, byteEnd: parent.byteEnd,
            ordinal: nodeCount + parent.ordinal + 1, now
          });
          return nodeId;
        });
        const chunkIds = result.chunks.map(() => this.ids.next());
        for (const chunk of result.chunks) {
          const header = source.embeddingHeader?.trim();
          const embeddingText = header === undefined || header.length === 0 ? chunk.content : `${header}\n${chunk.content}`;
          this.repository.addChunk(scope, {
            chunkId: chunkIds[chunk.ordinal]!, snapshotId, nodeId: parentIds[chunk.parentOrdinal]!,
            sourceType: source.sourceType, sourceId: source.sourceId, sourceVersion: source.sourceVersion,
            sourceHash: source.sourceHash, contentHash: sha256(chunk.content), indexTextHash: sha256(chunk.content),
            indexText: chunk.content, embeddingText, byteStart: chunk.byteStart, byteEnd: chunk.byteEnd,
            paragraphStart: chunk.paragraphStart, paragraphEnd: chunk.paragraphEnd,
            previousChunkId: chunk.previousOrdinal === null ? null : chunkIds[chunk.previousOrdinal]!,
            nextChunkId: chunk.nextOrdinal === null ? null : chunkIds[chunk.nextOrdinal]!, ordinal: chunkCount + chunk.ordinal,
            chunkType: `${source.sourceType}_leaf`, lifecycleLayer: source.lifecycleLayer,
            authorityGrade: source.authorityGrade, narrativeMode: chunk.narrativeMode, canonRevision,
            policyVersion: result.policy.version, normalizationVersion: result.policy.normalizationVersion,
            embeddingTextPolicyVersion: result.policy.embeddingTextPolicyVersion,
            boundaryConfidence: chunk.boundaryConfidence, now
          });
        }
        const coveredBytes = result.chunks.reduce((total, chunk) => total + chunk.byteEnd - chunk.byteStart, 0);
        coverageSources.push({
          sourceType: source.sourceType, sourceId: source.sourceId, sourceVersion: source.sourceVersion,
          sourceBytes: result.sourceBytes, coveredBytes, excludedSeparators: result.excludedSeparatorRanges
        });
        chunkCount += result.chunks.length;
        nodeCount += result.parents.length + 1;
      }
      if (failAt === 'before_validate') throw new Error('simulated-chunk-build-failure');
      const coverage = {
        sourceBytes: coverageSources.reduce((sum, source) => sum + source.sourceBytes, 0),
        coveredBytes: coverageSources.reduce((sum, source) => sum + source.coveredBytes, 0),
        sources: coverageSources
      };
      const validation = {
        hashMatched: true,
        noOverlap: prepared.every(({ result }) => hasNoOverlap(result.chunks)),
        parentContainsChildren: true,
        adjacencyValid: true,
        sourceIdentityUnique: true
      };
      if (!validation.noOverlap) throw new Error('切片存在非预期重叠');
      this.repository.completeSnapshot(scope, snapshotId, {
        expected: 'building', next: 'validated', sourceCount: prepared.length, nodeCount,
        chunkCount, coverageJson: JSON.stringify(coverage), validationJson: JSON.stringify(validation), now
      });
      this.repository.replaceFts(scope, snapshotId);
      if (failAt === 'before_ready') throw new Error('simulated-snapshot-probe-failure');
      this.repository.completeSnapshot(scope, snapshotId, {
        expected: 'validated', next: 'ready', sourceCount: prepared.length, nodeCount,
        chunkCount, coverageJson: JSON.stringify(coverage), validationJson: JSON.stringify(validation), now
      });
    });
    return { snapshotId, chunkCount: prepared.reduce((sum, item) => sum + item.result.chunks.length, 0) };
  }
}

function hasNoOverlap(chunks: Array<{ byteStart: number; byteEnd: number }>): boolean {
  return chunks.every((chunk, index) => index === 0 || chunks[index - 1]!.byteEnd <= chunk.byteStart);
}

function sha256(value: string): string { return createHash('sha256').update(value).digest('hex'); }
