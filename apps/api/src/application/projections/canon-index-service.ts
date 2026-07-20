import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import type { DatabaseSync } from 'node:sqlite';
import type { Clock, IdGenerator } from '../../domain/ids.js';
import { assertBookScope, type BookScope } from '../../domain/scope.js';
import { ChunkSnapshotRepository } from '../../infrastructure/db/repositories/chunk-snapshot-repository.js';
import { CanonIndexRepository, type CanonIndexFactRow } from '../../infrastructure/db/repositories/canon-index-repository.js';
import { ProjectionRepository } from '../../infrastructure/db/repositories/projection-repository.js';
import { UnitOfWork } from '../../infrastructure/db/unit-of-work.js';
import { resolveInside } from '../../infrastructure/files/file-utils.js';
import { ChunkSnapshotService, type ChunkSourceInput } from '../memory/chunk-snapshot-service.js';
import { DEFAULT_CHUNK_POLICY } from '../memory/chunk-policy.js';
import { StructuralChunker } from '../memory/structural-chunker.js';
import { ProjectionJobService } from './projection-job-service.js';

interface SourceDescriptor {
  sourceType: ChunkSourceInput['sourceType'];
  sourceId: string;
  sourceVersion: string;
  sourceHash: string;
  load: () => ChunkSourceInput;
}

export class CanonIndexService {
  public constructor(
    private readonly database: DatabaseSync,
    private readonly dataDir: string,
    private readonly ids: IdGenerator,
    private readonly clock: Clock
  ) {}

  public executeClaimed(scope: BookScope, requestId: string, workerId: string): {
    status: 'completed' | 'superseded'; snapshotId: string | null; sourceCount: number;
  } {
    assertBookScope(scope);
    const repository = new CanonIndexRepository(this.database);
    const request = repository.requireClaimed(scope, requestId, workerId);
    if (repository.requireBookCanonRevision(scope) !== request.canonRevision) {
      repository.supersede(scope, requestId, workerId, this.clock.now().toISOString());
      return { status: 'superseded', snapshotId: null, sourceCount: 0 };
    }

    const sources = this.loadAuthoritySourceDescriptors(scope, repository);
    let snapshotId = repository.findReadySnapshot(scope, request.canonRevision);
    if (snapshotId === null) {
      const members: Array<{
        membershipId: string; memberSnapshotId: string; sourceType: string;
        sourceId: string; sourceVersion: string; sourceHash: string;
      }> = [];
      const pending: SourceDescriptor[] = [];
      for (const source of sources) {
        const reusable = repository.findReusableSource(scope, {
          sourceType: source.sourceType, sourceId: source.sourceId, sourceVersion: source.sourceVersion,
          sourceHash: source.sourceHash, strategyVersion: DEFAULT_CHUNK_POLICY.version,
          normalizationVersion: DEFAULT_CHUNK_POLICY.normalizationVersion,
          embeddingTextPolicyVersion: DEFAULT_CHUNK_POLICY.embeddingTextPolicyVersion
        });
        if (reusable === null) pending.push(source);
        else members.push({ membershipId: this.ids.next(), memberSnapshotId: reusable,
          sourceType: source.sourceType, sourceId: source.sourceId,
          sourceVersion: source.sourceVersion, sourceHash: source.sourceHash });
      }
      if (pending.length > 0) {
        const fragment = new ChunkSnapshotService(
          new ChunkSnapshotRepository(this.database), new UnitOfWork(this.database), new StructuralChunker(), this.ids, this.clock
        ).buildFragmentMany(scope, pending.map((source) => source.load()), request.canonRevision);
        for (const source of pending) members.push({ membershipId: this.ids.next(), memberSnapshotId: fragment.snapshotId,
          sourceType: source.sourceType, sourceId: source.sourceId,
          sourceVersion: source.sourceVersion, sourceHash: source.sourceHash });
      }
      snapshotId = this.ids.next();
      const manifestId = snapshotId;
      const now = this.clock.now().toISOString();
      let superseded = false;
      new UnitOfWork(this.database).run(() => {
        if (repository.requireBookCanonRevision(scope) !== request.canonRevision) {
          repository.supersede(scope, requestId, workerId, now);
          superseded = true;
          return;
        }
        repository.createManifest(scope, { snapshotId: manifestId, canonRevision: request.canonRevision, members, now });
        this.enqueueProjections(scope, requestId, manifestId, request.canonRevision);
        repository.complete(scope, requestId, workerId, manifestId, now);
      });
      if (superseded) return { status: 'superseded', snapshotId: null, sourceCount: 0 };
      return { status: 'completed', snapshotId: manifestId, sourceCount: sources.length };
    }

    const now = this.clock.now().toISOString();
    let superseded = false;
    new UnitOfWork(this.database).run(() => {
      if (repository.requireBookCanonRevision(scope) !== request.canonRevision) {
        repository.supersede(scope, requestId, workerId, now);
        superseded = true;
        return;
      }
      this.enqueueProjections(scope, requestId, snapshotId, request.canonRevision);
      repository.complete(scope, requestId, workerId, snapshotId, now);
    });
    if (superseded) return { status: 'superseded', snapshotId: null, sourceCount: 0 };
    return { status: 'completed', snapshotId, sourceCount: sources.length };
  }

  private enqueueProjections(scope: BookScope, requestId: string, snapshotId: string, canonRevision: number): void {
    const jobs = new ProjectionJobService(
      new ProjectionRepository(this.database), new UnitOfWork(this.database), this.ids, this.clock
    );
    for (const projectionType of ['fts', 'vector'] as const) jobs.enqueue(scope, {
      projectionType, sourceSnapshotId: snapshotId, requiredCanonRevision: canonRevision,
      idempotencyKey: `canon:${canonRevision}:${snapshotId}:${projectionType}`,
      payload: { trigger: 'canon_settlement', requestId }
    });
  }

  private loadAuthoritySourceDescriptors(scope: BookScope, repository: CanonIndexRepository): SourceDescriptor[] {
    const manuscripts = repository.listAuthorityManuscripts(scope);
    const sources: SourceDescriptor[] = manuscripts.map((row) => ({
      sourceType: 'manuscript', sourceId: row.manuscriptVersionId, sourceVersion: row.contentHash,
      sourceHash: row.contentHash,
      load: () => {
        const content = readFileSync(resolveInside(this.dataDir, row.relativePath), 'utf8').normalize('NFC');
        if (sha256(content) !== row.contentHash) throw new Error(`正史正文文件哈希不匹配：${row.manuscriptVersionId}`);
        return {
          sourceType: 'manuscript', sourceId: row.manuscriptVersionId, sourceVersion: row.contentHash,
          content, sourceHash: row.contentHash,
          sourceLocator: { manuscriptVersionId: row.manuscriptVersionId, chapterNumber: row.chapterNumber },
          lifecycleLayer: 'canon', authorityGrade: 'D', title: `第${row.chapterNumber}章 ${row.title}`,
          embeddingHeader: `正史正文 第${row.chapterNumber}章 ${row.title}`
        };
      }
    }));
    for (const row of repository.listAuthorityArtifacts(scope)) {
      const content = row.contentJson.normalize('NFC');
      const sourceType = row.artifactType.includes('outline') ? 'outline' as const : 'setting' as const;
      const sourceHash = sha256(content);
      sources.push({ sourceType, sourceId: row.artifactVersionId, sourceVersion: String(row.version), sourceHash,
        load: () => ({ sourceType, sourceId: row.artifactVersionId, sourceVersion: String(row.version), content, sourceHash,
          sourceLocator: { artifactVersionId: row.artifactVersionId, artifactType: row.artifactType },
          lifecycleLayer: 'canon', authorityGrade: 'D', title: row.title,
          embeddingHeader: `${row.artifactType} ${row.title}` }) });
    }
    for (const row of repository.listAuthorityFacts(scope)) {
      const content = factIndexText(row).normalize('NFC');
      const sourceHash = sha256(content);
      sources.push({ sourceType: 'fact', sourceId: row.factId, sourceVersion: sourceHash, sourceHash,
        load: () => ({ sourceType: 'fact', sourceId: row.factId, sourceVersion: sourceHash, content,
          sourceHash, sourceLocator: { factId: row.factId }, lifecycleLayer: 'canon', authorityGrade: row.grade,
          title: `${row.canonicalName}·${row.relationKey}`,
          embeddingHeader: `正史${row.epistemicStatus === 'objective' && row.negated === 0 ? '事实' : '叙事主张'} ${row.canonicalName} ${row.relationKey}` }) });
    }
    if (sources.length === 0) throw new Error('正史索引请求没有可切片的权威来源');
    return sources;
  }
}

function factIndexText(row: CanonIndexFactRow): string {
  const truthLabel = row.epistemicStatus === 'objective' ? '客观事实' : `${row.epistemicStatus}叙事主张`;
  const viewpoint = row.viewpointName === null ? '' : ` 认知主体:${row.viewpointName}`;
  const predicate = row.negated === 1 ? `并非 ${row.relationKey}` : row.relationKey;
  return `[${truthLabel}]${viewpoint} ${row.canonicalName} ${predicate} ${row.valueJson}`;
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}
