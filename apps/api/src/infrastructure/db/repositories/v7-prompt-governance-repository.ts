import type { DatabaseSync } from 'node:sqlite';
import {
  V7_PROMPT_SOURCE_ASSETS,
  modelBindingForProfile,
  sha256,
  stableStringify,
  type V7BookGenreProfile,
  type V7ContextPackTrace,
  type V7FixedRoleKey,
  type V7PromptAssetKind,
  type V7PromptAssetStatus,
  type V7PromptAssetVersion,
  type V7PromptManifest,
  type V7TaskContract
} from '@wenmi/v7-backend';

export interface V7StoredPromptAssetVersion extends V7PromptAssetVersion {
  governanceRevision: number;
  contentHash: string;
  basedOnAssetId: string | null;
  publishedBy: string | null;
  publishedAt: string | null;
  retiredBy: string | null;
  retiredAt: string | null;
}

export interface V7PromptGovernanceSummary {
  revision: number;
  assetKeyCount: number;
  versionCount: number;
  draftCount: number;
  publishedCount: number;
  retiredCount: number;
  genreProfileCount: number;
  taskContractCount: number;
  contextPackCount: number;
  manifestCount: number;
  prebookPromptBundleCount: number;
}

export interface V7PromptAssetListItem {
  assetKey: string;
  kind: V7PromptAssetKind;
  latestVersion: number;
  published: V7StoredPromptAssetVersion | null;
  latestDraft: V7StoredPromptAssetVersion | null;
  versionCount: number;
}

export interface V7RuntimeBundleInput {
  taskContract: V7TaskContract;
  contextPack: V7ContextPackTrace;
  manifest: V7PromptManifest;
}

/** Exact immutable compiler result shape consumed by technical retries. */
export interface V7ImmutableRuntimeBundle extends V7RuntimeBundleInput {
  fixedRoleKey: V7FixedRoleKey;
}

export interface V7RuntimeBundleResult {
  taskContractId: string;
  contextPackId: string;
  manifestId: string;
  created: boolean;
}

interface PromptAssetRow {
  asset_id: string;
  asset_key: string;
  kind: V7PromptAssetKind;
  version: number;
  status: V7PromptAssetStatus;
  governance_revision: number;
  title: string;
  summary: string;
  content_json: string;
  content_hash: string;
  based_on_asset_id: string | null;
  created_by: string;
  created_at: string;
  published_by: string | null;
  published_at: string | null;
  retired_by: string | null;
  retired_at: string | null;
}

interface PromptManifestRow {
  manifest_id: string;
  owner_id: string;
  book_id: string;
  task_id: string;
  member_key: string;
  role_key: V7PromptManifest['roleKey'];
  workstation_key: V7PromptManifest['workstationKey'];
  task_kind: V7PromptManifest['taskKind'];
  operation_mode: V7PromptManifest['operationMode'];
  role_prompt_version_id: string;
  workstation_prompt_version_id: string;
  genre_profile_id: string | null;
  genre_profile_version: number | null;
  skill_version_ids_json: string;
  task_contract_id: string;
  task_contract_version: number;
  context_pack_id: string;
  context_pack_hash: string;
  model_profile_key: string;
  provider: string;
  model_id: string;
  plan: V7PromptManifest['plan'];
  max_output_tokens: number;
  governance_revision: number;
  temperature: number;
  allowed_tools_json: string;
  compiled_blocks_json: string;
  compiled_prompt: string;
  compiled_prompt_hash: string;
  lifecycle_status: string;
  created_at: string;
}

interface PrebookPromptBundleRow {
  request_id: string;
  owner_id: string;
  opening_task_id: string;
  member_key: string;
  model_id: string;
  state: string;
  governance_revision: number;
  temperature: number | null;
  task_contract_json: string;
  context_pack_json: string;
  prompt_manifest_json: string;
  failure_message: string | null;
  completed_at: string | null;
  created_at: string;
}

interface ManifestListItem {
  manifestId: string;
  createdAt: string;
  [key: string]: unknown;
}

interface PromptExecutionRow {
  state: string;
  output_text: string | null;
  failure_message: string | null;
  completed_at: string | null;
  updated_at: string;
  source_kind: string;
}

export interface V7PromptExecutionView {
  state: 'working' | 'succeeded' | 'failed' | 'unknown' | 'not_linked';
  summary: string;
  completedAt: string | null;
  sourceKind: string | null;
  artifactType: string;
}

const SAFE_VALUE_PATTERN = /(?:Bearer\s+[A-Za-z0-9._-]+|\b(?:sk|ak)-[A-Za-z0-9_-]{8,}|\bark-(?!(?:agent-plan|coding-plan|image)\b)[A-Za-z0-9_-]{8,}|api[_-]?key["']?\s*[:=])/iu;
const HIDDEN_REASONING_PATTERN = /"(?:chainOfThought|reasoningTrace|hiddenReasoning|思维链)"\s*:/u;

export class V7PromptGovernanceRepository {
  public constructor(private readonly database: DatabaseSync) {}

  public ensureSourceRegistrySeeded(now: string): void {
    this.database.exec('BEGIN IMMEDIATE');
    try {
      let inserted = 0;
      let promoted = 0;
      for (const source of V7_PROMPT_SOURCE_ASSETS) {
        const serialized = stableStringify(source.content);
        const contentHash = sha256(serialized);
        const existing = this.database.prepare(`SELECT asset_id,asset_key,kind,version,content_hash
          FROM v7_prompt_asset_versions WHERE asset_key=? AND version=?`).get(source.assetKey, source.version) as
          { asset_id: string; asset_key: string; kind: string; version: number; content_hash: string } | undefined;
        if (existing !== undefined) {
          if (existing.asset_id !== source.assetId || existing.kind !== source.kind || existing.content_hash !== contentHash) {
            throw new Error(`V7提示资产种子冲突：${source.assetKey}@${source.version}`);
          }
          continue;
        }
        const published = this.database.prepare(`SELECT asset_id,version FROM v7_prompt_asset_versions
          WHERE asset_key=? AND status='published'`).get(source.assetKey) as { asset_id: string; version: number } | undefined;
        const replacesPublished = published !== undefined
          && source.version > published.version
          && source.basedOnVersion === published.version;
        const status: V7PromptAssetStatus = published === undefined || replacesPublished ? 'published' : 'retired';
        const basedOnAssetId = replacesPublished ? published.asset_id : null;
        if (replacesPublished) {
          this.database.prepare(`UPDATE v7_prompt_asset_versions
            SET status='retired',retired_by='system',retired_at=?
            WHERE asset_id=? AND status='published'`).run(now, published.asset_id);
          promoted += 1;
        }
        this.database.prepare(`INSERT INTO v7_prompt_asset_versions(
          asset_id,asset_key,kind,version,status,governance_revision,title,summary,content_json,content_hash,
          based_on_asset_id,created_by,created_at,published_by,published_at,retired_by,retired_at
        ) VALUES(?,?,?,?,?,1,?,?,?,?,?,?,?,?,?,?,?)`).run(
          source.assetId, source.assetKey, source.kind, source.version, status, source.title, source.summary,
          serialized, contentHash, basedOnAssetId, source.createdBy, source.createdAt,
          status === 'published' ? source.createdBy : null, status === 'published' ? source.createdAt : null,
          status === 'retired' ? 'system' : null, status === 'retired' ? now : null
        );
        inserted += 1;
      }
      if (promoted > 0) {
        this.database.prepare(`UPDATE v7_prompt_governance_meta
          SET revision=revision+1,updated_by='system',updated_at=? WHERE singleton=1`).run(now);
      }
      if (inserted > 0) {
        this.database.prepare(`INSERT OR IGNORE INTO v7_prompt_governance_events(
          event_id,actor_id,event_type,target_kind,target_key,before_json,after_json,reason,created_at
        ) VALUES('seed:v7-prompt-source-registry-v2','system','seeded','registry','v7-prompt-source-registry-v2',NULL,?,
          '登记V7岗位、工位、题材与Skill提示资产的当前发布版本',?)`)
          .run(JSON.stringify({ inserted, promoted }), now);
      }
      this.database.exec('COMMIT');
    } catch (error) {
      this.database.exec('ROLLBACK');
      throw error;
    }
  }

  public summary(): V7PromptGovernanceSummary {
    const meta = this.database.prepare(`SELECT revision FROM v7_prompt_governance_meta WHERE singleton=1`).get() as
      { revision: number } | undefined;
    if (meta === undefined) throw new Error('V7提示词与上下文治理尚未初始化');
    const assets = this.database.prepare(`SELECT COUNT(DISTINCT asset_key) AS asset_key_count,COUNT(*) AS version_count,
      SUM(CASE WHEN status='draft' THEN 1 ELSE 0 END) AS draft_count,
      SUM(CASE WHEN status='published' THEN 1 ELSE 0 END) AS published_count,
      SUM(CASE WHEN status='retired' THEN 1 ELSE 0 END) AS retired_count FROM v7_prompt_asset_versions`).get() as {
        asset_key_count: number; version_count: number; draft_count: number | null;
        published_count: number | null; retired_count: number | null;
      };
    const count = (table: string): number => (this.database.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as { count: number }).count;
    const prebookPromptBundleCount = (this.database.prepare(`SELECT COUNT(*) AS count
      FROM v7_opening_agent_model_calls
      WHERE task_contract_json IS NOT NULL AND context_pack_json IS NOT NULL AND prompt_manifest_json IS NOT NULL`)
      .get() as { count: number }).count;
    return {
      revision: meta.revision,
      assetKeyCount: assets.asset_key_count,
      versionCount: assets.version_count,
      draftCount: assets.draft_count ?? 0,
      publishedCount: assets.published_count ?? 0,
      retiredCount: assets.retired_count ?? 0,
      genreProfileCount: count('v7_book_genre_profiles'),
      taskContractCount: count('v7_task_contracts') + prebookPromptBundleCount,
      contextPackCount: count('v7_context_pack_traces') + prebookPromptBundleCount,
      manifestCount: count('v7_prompt_manifests') + prebookPromptBundleCount,
      prebookPromptBundleCount
    };
  }

  public listAssets(filters: { kind?: V7PromptAssetKind; search?: string } = {}): V7PromptAssetListItem[] {
    const clauses: string[] = [];
    const values: string[] = [];
    if (filters.kind !== undefined) { clauses.push('kind=?'); values.push(filters.kind); }
    if (filters.search !== undefined) {
      clauses.push('(asset_key LIKE ? ESCAPE \'\\\' OR title LIKE ? ESCAPE \'\\\')');
      const escaped = `%${filters.search.replace(/[\\%_]/gu, '\\$&')}%`;
      values.push(escaped, escaped);
    }
    const where = clauses.length === 0 ? '' : `WHERE ${clauses.join(' AND ')}`;
    const rows = this.database.prepare(`SELECT * FROM v7_prompt_asset_versions ${where}
      ORDER BY asset_key,version DESC`).all(...values) as unknown as PromptAssetRow[];
    const grouped = new Map<string, PromptAssetRow[]>();
    for (const row of rows) grouped.set(row.asset_key, [...(grouped.get(row.asset_key) ?? []), row]);
    return [...grouped.entries()].map(([assetKey, versions]) => ({
      assetKey,
      kind: versions[0]!.kind,
      latestVersion: versions[0]!.version,
      published: mapAsset(versions.find((row) => row.status === 'published')),
      latestDraft: mapAsset(versions.find((row) => row.status === 'draft')),
      versionCount: versions.length
    })).toSorted((left, right) => left.assetKey.localeCompare(right.assetKey));
  }

  public assetVersions(assetKey: string): V7StoredPromptAssetVersion[] {
    return (this.database.prepare(`SELECT * FROM v7_prompt_asset_versions WHERE asset_key=? ORDER BY version DESC`).all(assetKey) as
      unknown as PromptAssetRow[]).map((row) => mapAsset(row)!);
  }

  public assetById(assetId: string): V7StoredPromptAssetVersion | null {
    return mapAsset(this.database.prepare(`SELECT * FROM v7_prompt_asset_versions WHERE asset_id=?`).get(assetId) as PromptAssetRow | undefined);
  }

  public publishedAsset(assetKey: string): V7StoredPromptAssetVersion | null {
    return mapAsset(this.database.prepare(`SELECT * FROM v7_prompt_asset_versions WHERE asset_key=? AND status='published'`).get(assetKey) as
      PromptAssetRow | undefined);
  }

  public publishedAssets(): V7StoredPromptAssetVersion[] {
    return (this.database.prepare(`SELECT * FROM v7_prompt_asset_versions
      WHERE status='published' ORDER BY kind,asset_key`).all() as unknown as PromptAssetRow[])
      .map((row) => mapAsset(row)!);
  }

  public activeBookGenreProfile(ownerId: string, bookId: string): V7BookGenreProfile | null {
    const row = this.database.prepare(`SELECT * FROM v7_book_genre_profiles
      WHERE owner_id=? AND book_id=? AND status='active' ORDER BY version DESC LIMIT 1`)
      .get(ownerId, bookId) as Record<string, unknown> | undefined;
    return row === undefined ? null : mapGenreProfileRow(row);
  }

  public createDraft(input: {
    assetKey: string;
    kind: V7PromptAssetKind;
    title: string;
    summary: string;
    content: Readonly<Record<string, unknown>>;
    basedOnAssetId: string | null;
    expectedRevision: number;
    actorId: string;
    eventId: string;
    reason: string;
    now: string;
  }): V7StoredPromptAssetVersion {
    this.database.exec('BEGIN IMMEDIATE');
    try {
      this.assertRevision(input.expectedRevision);
      const result = this.insertDraft(input, input.expectedRevision + 1);
      this.bumpRevision(input.expectedRevision, input.actorId, input.now);
      this.insertEvent(input.eventId, input.actorId, 'draft_created', 'prompt_asset', input.assetKey, null,
        assetEventView(result), input.reason, input.now);
      this.database.exec('COMMIT');
      return result;
    } catch (error) {
      this.database.exec('ROLLBACK');
      throw error;
    }
  }

  public publish(input: {
    assetKey: string;
    assetId: string;
    expectedRevision: number;
    actorId: string;
    eventId: string;
    reason: string;
    now: string;
  }): V7StoredPromptAssetVersion {
    this.database.exec('BEGIN IMMEDIATE');
    try {
      this.assertRevision(input.expectedRevision);
      const target = this.requireAsset(input.assetId);
      if (target.assetKey !== input.assetKey) throw new Error('提示资产编号与版本不一致');
      if (target.status !== 'draft') throw new Error('只有草稿可以发布');
      const current = this.publishedAsset(input.assetKey);
      if (current !== null) {
        this.database.prepare(`UPDATE v7_prompt_asset_versions SET status='retired',retired_by=?,retired_at=? WHERE asset_id=?`)
          .run(input.actorId, input.now, current.assetId);
      }
      this.database.prepare(`UPDATE v7_prompt_asset_versions SET status='published',published_by=?,published_at=? WHERE asset_id=?`)
        .run(input.actorId, input.now, target.assetId);
      this.bumpRevision(input.expectedRevision, input.actorId, input.now);
      const published = this.requireAsset(target.assetId);
      this.insertEvent(input.eventId, input.actorId, 'published', 'prompt_asset', input.assetKey,
        current === null ? null : assetEventView(current), assetEventView(published), input.reason, input.now);
      this.database.exec('COMMIT');
      return published;
    } catch (error) {
      this.database.exec('ROLLBACK');
      throw error;
    }
  }

  public restoreAsDraft(input: {
    assetKey: string;
    sourceAssetId: string;
    expectedRevision: number;
    actorId: string;
    eventId: string;
    reason: string;
    now: string;
  }): V7StoredPromptAssetVersion {
    this.database.exec('BEGIN IMMEDIATE');
    try {
      this.assertRevision(input.expectedRevision);
      const source = this.requireAsset(input.sourceAssetId);
      if (source.assetKey !== input.assetKey) throw new Error('历史版本不属于当前提示资产');
      const draft = this.insertDraft({
        assetKey: source.assetKey,
        kind: source.kind,
        title: source.title,
        summary: source.summary,
        content: source.content,
        basedOnAssetId: source.assetId,
        expectedRevision: input.expectedRevision,
        actorId: input.actorId,
        eventId: input.eventId,
        reason: input.reason,
        now: input.now
      }, input.expectedRevision + 1);
      this.bumpRevision(input.expectedRevision, input.actorId, input.now);
      this.insertEvent(input.eventId, input.actorId, 'restore_draft_created', 'prompt_asset', input.assetKey,
        assetEventView(source), assetEventView(draft), input.reason, input.now);
      this.database.exec('COMMIT');
      return draft;
    } catch (error) {
      this.database.exec('ROLLBACK');
      throw error;
    }
  }

  public recordPreview(input: { eventId: string; actorId: string; asset: V7StoredPromptAssetVersion; now: string }): void {
    this.insertEvent(input.eventId, input.actorId, 'previewed', 'prompt_asset', input.asset.assetKey, null,
      assetEventView(input.asset), '预览提示资产草稿', input.now);
  }

  public recordBookGenreProfile(profile: V7BookGenreProfile, actorId = 'runtime'): V7BookGenreProfile {
    const semantic = genreProfileSemantic(profile);
    assertSafe(semantic);
    const contentHash = sha256(stableStringify(semantic));
    this.database.exec('BEGIN IMMEDIATE');
    try {
      const existing = this.database.prepare(`SELECT content_hash FROM v7_book_genre_profiles WHERE profile_id=?`).get(profile.profileId) as
        { content_hash: string } | undefined;
      if (existing !== undefined) {
        if (existing.content_hash !== contentHash) throw new Error('题材工作档案编号已存在但内容不同');
        this.database.exec('COMMIT');
        return profile;
      }
      if (profile.status === 'active') {
        this.database.prepare(`UPDATE v7_book_genre_profiles SET status='superseded'
          WHERE owner_id=? AND book_id=? AND status='active'`).run(profile.ownerId, profile.bookId);
      }
      this.database.prepare(`INSERT INTO v7_book_genre_profiles(
        profile_id,owner_id,book_id,version,status,primary_genre_key,supporting_genre_keys_json,
        source_asset_version_ids_json,source_book_version,public_label,working_identity,primary_promise,
        supporting_functions_json,writing_priorities_json,authenticity_checks_json,avoid_patterns_json,
        conflict_resolutions_json,compiled_by_task_id,content_hash,created_at
      ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
        profile.profileId, profile.ownerId, profile.bookId, profile.version, profile.status, profile.primaryGenreKey,
        JSON.stringify(profile.supportingGenreKeys), JSON.stringify(profile.sourceAssetVersionIds), profile.sourceBookVersion,
        profile.publicLabel, profile.workingIdentity, profile.primaryPromise, JSON.stringify(profile.supportingFunctions),
        JSON.stringify(profile.writingPriorities), JSON.stringify(profile.authenticityChecks), JSON.stringify(profile.avoidPatterns),
        JSON.stringify(profile.conflictResolutions), profile.compiledByTaskId, contentHash, profile.createdAt
      );
      this.insertEvent(`genre-profile:${profile.profileId}`, actorId, 'genre_profile_recorded', 'book_genre_profile',
        profile.profileId, null, { ownerId: profile.ownerId, bookId: profile.bookId, version: profile.version, contentHash },
        '记录书级融合题材工作档案', profile.createdAt);
      this.database.exec('COMMIT');
      return profile;
    } catch (error) {
      this.database.exec('ROLLBACK');
      throw error;
    }
  }

  public saveRuntimeBundle(input: V7RuntimeBundleInput): V7RuntimeBundleResult {
    validateRuntimeBundle(input);
    const manifestSkillKeys = input.manifest.skillVersionIds.map((assetId) => {
      const asset = this.requireAsset(assetId);
      return String((asset.content as { skillKey?: string }).skillKey
        ?? asset.assetKey.replace(/^skill\./u, '').replace(/@.*$/u, ''));
    }).toSorted();
    if (stableStringify(manifestSkillKeys) !== stableStringify([...input.taskContract.selectedSkillKeys].toSorted())) {
      throw new Error('提示清单与任务合同选择的Skill不一致');
    }
    this.database.exec('BEGIN IMMEDIATE');
    try {
      const contractHash = sha256(stableStringify(taskContractSemantic(input.taskContract)));
      const contractCreated = this.insertTaskContract(input.taskContract, contractHash);
      const contextCreated = this.insertContextPack(input.contextPack);
      const manifestCreated = this.insertManifest(input.manifest);
      if (manifestCreated) {
        this.insertEvent(`runtime-bundle:${input.manifest.manifestId}`, input.manifest.memberKey,
          'runtime_bundle_recorded', 'prompt_manifest', input.manifest.manifestId, null, {
            ownerId: input.manifest.ownerId,
            bookId: input.manifest.bookId,
            taskId: input.manifest.taskId,
            taskContractId: input.taskContract.contractId,
            contextPackId: input.contextPack.contextPackId,
            compiledPromptHash: input.manifest.compiledPromptHash,
            modelBinding: {
              provider: input.manifest.provider,
              modelId: input.manifest.modelId,
              plan: input.manifest.plan,
              maxOutputTokens: input.manifest.maxOutputTokens
            }
          }, '冻结本次模型请求的任务合同、资料包与提示清单', input.manifest.createdAt);
      }
      this.database.exec('COMMIT');
      return {
        taskContractId: input.taskContract.contractId,
        contextPackId: input.contextPack.contextPackId,
        manifestId: input.manifest.manifestId,
        created: contractCreated || contextCreated || manifestCreated
      };
    } catch (error) {
      this.database.exec('ROLLBACK');
      throw error;
    }
  }

  /**
   * Returns the exact immutable runtime snapshot for a technical retry. Scope
   * is part of the SQL lookup and is checked again after reconstruction, so a
   * caller can never receive another owner's or another book's bundle by only
   * knowing its task id.
   */
  public runtimeBundleByTaskScope(scope: {
    ownerId: string;
    bookId: string;
    taskId: string;
  }): V7ImmutableRuntimeBundle | null {
    const manifestRow = this.database.prepare(`SELECT * FROM v7_prompt_manifests
      WHERE owner_id=? AND book_id=? AND task_id=?
      ORDER BY created_at DESC,manifest_id DESC LIMIT 1`).get(
      scope.ownerId, scope.bookId, scope.taskId
    ) as PromptManifestRow | undefined;
    if (manifestRow === undefined) return null;
    const contractRow = this.database.prepare(`SELECT * FROM v7_task_contracts
      WHERE contract_id=? AND owner_id=? AND book_id=? AND task_id=?`).get(
      manifestRow.task_contract_id, scope.ownerId, scope.bookId, scope.taskId
    ) as Record<string, unknown> | undefined;
    const contextRow = this.database.prepare(`SELECT * FROM v7_context_pack_traces
      WHERE context_pack_id=? AND owner_id=? AND book_id=? AND task_id=?`).get(
      manifestRow.context_pack_id, scope.ownerId, scope.bookId, scope.taskId
    ) as Record<string, unknown> | undefined;
    if (contractRow === undefined || contextRow === undefined) {
      throw new Error('冻结的运行快照缺少同书任务合同或资料包');
    }
    const sourceRows = this.database.prepare(`SELECT * FROM v7_context_source_traces
      WHERE context_pack_id=? AND owner_id=? AND book_id=? ORDER BY sequence`).all(
      manifestRow.context_pack_id, scope.ownerId, scope.bookId
    ) as unknown as Array<Record<string, unknown>>;
    const bundle: V7ImmutableRuntimeBundle = {
      taskContract: mapTaskContractRow(contractRow) as V7TaskContract,
      contextPack: mapContextPackRow(contextRow, sourceRows) as V7ContextPackTrace,
      manifest: mapManifest(manifestRow),
      fixedRoleKey: manifestRow.role_key
    };
    validateRuntimeBundle(bundle);
    return bundle;
  }

  public listManifests(filters: { ownerId?: string; bookId?: string; taskId?: string; limit: number }): object[] {
    const clauses: string[] = [];
    const values: string[] = [];
    if (filters.ownerId !== undefined) { clauses.push('owner_id=?'); values.push(filters.ownerId); }
    if (filters.bookId !== undefined) { clauses.push('book_id=?'); values.push(filters.bookId); }
    if (filters.taskId !== undefined) { clauses.push('task_id=?'); values.push(filters.taskId); }
    const where = clauses.length === 0 ? '' : `WHERE ${clauses.join(' AND ')}`;
    const rows = this.database.prepare(`SELECT * FROM v7_prompt_manifests ${where}
      ORDER BY created_at DESC,manifest_id DESC LIMIT ?`).all(...values, filters.limit) as unknown as PromptManifestRow[];
    const prebookRows = this.listPrebookPromptBundles(filters);
    return [
      ...rows.map((row) => ({
        ...(manifestSummary(row) as ManifestListItem),
        execution: this.executionForManifest(row)
      })),
      ...prebookRows.map((row) => prebookManifestSummary(row))
    ].toSorted((left, right) => right.createdAt.localeCompare(left.createdAt)
      || right.manifestId.localeCompare(left.manifestId)).slice(0, filters.limit);
  }

  public manifestDetail(manifestId: string): object | null {
    const row = this.database.prepare(`SELECT * FROM v7_prompt_manifests WHERE manifest_id=?`).get(manifestId) as PromptManifestRow | undefined;
    if (row === undefined) return this.prebookManifestDetail(manifestId);
    const contract = this.database.prepare(`SELECT * FROM v7_task_contracts WHERE contract_id=?`).get(row.task_contract_id) as
      Record<string, unknown> | undefined;
    const context = this.database.prepare(`SELECT * FROM v7_context_pack_traces WHERE context_pack_id=?`).get(row.context_pack_id) as
      Record<string, unknown> | undefined;
    const sources = this.database.prepare(`SELECT * FROM v7_context_source_traces WHERE context_pack_id=? ORDER BY sequence`)
      .all(row.context_pack_id) as unknown as Array<Record<string, unknown>>;
    const rolePrompt = this.assetById(row.role_prompt_version_id);
    const workstationPrompt = this.assetById(row.workstation_prompt_version_id);
    const skillIds = parseJson<string[]>(row.skill_version_ids_json);
    const skills = skillIds.map((assetId) => this.assetById(assetId)).filter((asset): asset is V7StoredPromptAssetVersion => asset !== null);
    const genreProfile = row.genre_profile_id === null ? null : this.database.prepare(`SELECT * FROM v7_book_genre_profiles
      WHERE profile_id=? AND owner_id=? AND book_id=?`)
      .get(row.genre_profile_id, row.owner_id, row.book_id) as Record<string, unknown> | undefined;
    return {
      manifest: mapManifest(row),
      taskContract: contract === undefined ? null : mapTaskContractRow(contract),
      contextPack: context === undefined ? null : mapContextPackRow(context, sources),
      promptAssets: { rolePrompt, workstationPrompt, skills },
      genreProfile: genreProfile == null ? null : mapGenreProfileRow(genreProfile),
      execution: this.executionForManifest(row)
    };
  }

  private executionForManifest(row: PromptManifestRow): V7PromptExecutionView {
    const linked = this.database.prepare(`SELECT state,output_text,failure_message,completed_at,updated_at,source_kind
      FROM (
        SELECT state,output_text,failure_message,completed_at,updated_at,'setting' AS source_kind
          FROM v7_setting_model_calls WHERE owner_id=? AND book_id=? AND prompt_hash=?
        UNION ALL
        SELECT state,output_text,failure_message,completed_at,updated_at,'planning' AS source_kind
          FROM v7_planning_model_calls WHERE owner_id=? AND book_id=? AND prompt_hash=?
        UNION ALL
        SELECT state,output_text,failure_message,completed_at,updated_at,'creation' AS source_kind
          FROM v7_creation_model_calls WHERE owner_id=? AND book_id=? AND prompt_hash=?
        UNION ALL
        SELECT state,output_text,failure_message,completed_at,updated_at,'character' AS source_kind
          FROM v7_character_model_calls WHERE owner_id=? AND book_id=? AND prompt_hash=?
        UNION ALL
        SELECT state,CASE WHEN state='succeeded' THEN options_json ELSE NULL END AS output_text,
          failure_message,completed_at,updated_at,'title' AS source_kind
          FROM v7_book_title_design_calls WHERE owner_id=? AND book_id=? AND prompt_hash=?
        UNION ALL
        SELECT state,CASE WHEN state='succeeded' THEN work_order_json ELSE NULL END AS output_text,
          failure_message,completed_at,updated_at,'cover' AS source_kind
          FROM v7_book_cover_designs WHERE owner_id=? AND book_id=? AND prompt_hash=?
      ) ORDER BY updated_at DESC LIMIT 1`).get(
        row.owner_id, row.book_id, row.compiled_prompt_hash,
        row.owner_id, row.book_id, row.compiled_prompt_hash,
        row.owner_id, row.book_id, row.compiled_prompt_hash,
        row.owner_id, row.book_id, row.compiled_prompt_hash,
        row.owner_id, row.book_id, row.compiled_prompt_hash,
        row.owner_id, row.book_id, row.compiled_prompt_hash
      ) as PromptExecutionRow | undefined;
    if (linked !== undefined) return executionView(linked, row.task_kind);

    // The cover brief is generated before the image request and has its own
    // immutable manifest.  Its prompt hash is intentionally not copied onto
    // the image row, so correlate it with the design task identity instead.
    if (row.task_kind === 'cover_brief') {
      const cover = this.database.prepare(`SELECT state,
        CASE WHEN state='succeeded' THEN work_order_json ELSE NULL END AS output_text,
        failure_message,completed_at,updated_at,'cover_brief' AS source_kind
        FROM v7_book_cover_designs
        WHERE owner_id=? AND book_id=? AND ? LIKE design_id || '-%'
        ORDER BY updated_at DESC LIMIT 1`).get(row.owner_id, row.book_id, row.task_id) as PromptExecutionRow | undefined;
      if (cover !== undefined) return executionView(cover, row.task_kind);
    }
    const artifactType = artifactLabel(null, row.task_kind);
    return {
      state: 'not_linked',
      summary: `${artifactType}的提示快照已经保存，但没有找到可核对的任务运行记录。`,
      completedAt: null,
      sourceKind: null,
      artifactType
    };
  }

  private listPrebookPromptBundles(
    filters: { ownerId?: string; bookId?: string; taskId?: string; limit: number }
  ): PrebookPromptBundleRow[] {
    const clauses = [
      'task_contract_json IS NOT NULL',
      'context_pack_json IS NOT NULL',
      'prompt_manifest_json IS NOT NULL'
    ];
    const values: string[] = [];
    if (filters.ownerId !== undefined) { clauses.push('owner_id=?'); values.push(filters.ownerId); }
    if (filters.bookId !== undefined) {
      clauses.push("json_extract(prompt_manifest_json,'$.bookId')=?");
      values.push(filters.bookId);
    }
    if (filters.taskId !== undefined) {
      clauses.push("(task_id=? OR json_extract(prompt_manifest_json,'$.taskId')=?)");
      values.push(filters.taskId, filters.taskId);
    }
    return this.database.prepare(`SELECT request_id,owner_id,task_id AS opening_task_id,member_key,model_id,state,
      governance_revision,temperature,task_contract_json,context_pack_json,prompt_manifest_json,
      failure_message,completed_at,created_at
      FROM v7_opening_agent_model_calls WHERE ${clauses.join(' AND ')}
      ORDER BY created_at DESC,request_id DESC LIMIT ?`).all(...values, filters.limit) as unknown as PrebookPromptBundleRow[];
  }

  private prebookManifestDetail(manifestId: string): object | null {
    const row = this.database.prepare(`SELECT request_id,owner_id,task_id AS opening_task_id,member_key,model_id,state,
      governance_revision,temperature,task_contract_json,context_pack_json,prompt_manifest_json,
      failure_message,completed_at,created_at
      FROM v7_opening_agent_model_calls
      WHERE prompt_manifest_json IS NOT NULL AND json_extract(prompt_manifest_json,'$.manifestId')=?
      LIMIT 1`).get(manifestId) as PrebookPromptBundleRow | undefined;
    if (row === undefined) return null;
    const bundle = parsePrebookPromptBundle(row);
    validateRuntimeBundle(bundle);
    const contextPack = {
      ...bundle.contextPack,
      sources: bundle.contextPack.sources.map((source) => ({
        ...source,
        ownerId: source.ownerId || bundle.contextPack.ownerId,
        bookId: source.bookId || bundle.contextPack.bookId
      }))
    };
    const rolePrompt = this.assetById(bundle.manifest.rolePromptVersionId);
    const workstationPrompt = this.assetById(bundle.manifest.workstationPromptVersionId);
    const skills = bundle.manifest.skillVersionIds.map((assetId) => this.assetById(assetId))
      .filter((asset): asset is V7StoredPromptAssetVersion => asset !== null);
    return {
      manifest: { ...bundle.manifest, lifecycleStatus: 'immutable' },
      taskContract: bundle.taskContract,
      contextPack,
      promptAssets: { rolePrompt, workstationPrompt, skills },
      genreProfile: null,
      execution: prebookExecution(row),
      storage: {
        kind: 'prebook_model_call',
        requestId: row.request_id,
        openingTaskId: row.opening_task_id,
        requestState: row.state,
        embeddedSnapshot: true
      }
    };
  }

  private insertDraft(input: {
    assetKey: string; kind: V7PromptAssetKind; title: string; summary: string;
    content: Readonly<Record<string, unknown>>; basedOnAssetId: string | null;
    expectedRevision: number; actorId: string; eventId: string; reason: string; now: string;
  }, governanceRevision: number): V7StoredPromptAssetVersion {
    const existingKind = this.database.prepare(`SELECT kind FROM v7_prompt_asset_versions WHERE asset_key=? LIMIT 1`).get(input.assetKey) as
      { kind: V7PromptAssetKind } | undefined;
    if (existingKind !== undefined && existingKind.kind !== input.kind) throw new Error('同一提示资产不能更换类型');
    if (input.basedOnAssetId !== null) {
      const base = this.requireAsset(input.basedOnAssetId);
      if (base.assetKey !== input.assetKey) throw new Error('草稿来源版本不属于当前提示资产');
    }
    assertSafe(input.content);
    const contentJson = stableStringify(input.content);
    const version = ((this.database.prepare(`SELECT MAX(version) AS version FROM v7_prompt_asset_versions WHERE asset_key=?`)
      .get(input.assetKey) as { version: number | null }).version ?? 0) + 1;
    const assetId = `${input.assetKey}@${version}`;
    this.database.prepare(`INSERT INTO v7_prompt_asset_versions(
      asset_id,asset_key,kind,version,status,governance_revision,title,summary,content_json,content_hash,
      based_on_asset_id,created_by,created_at,published_by,published_at,retired_by,retired_at
    ) VALUES(?,?,?,?, 'draft',?,?,?,?,?,?,?, ?,NULL,NULL,NULL,NULL)`).run(
      assetId, input.assetKey, input.kind, version, governanceRevision, input.title, input.summary,
      contentJson, sha256(contentJson), input.basedOnAssetId, input.actorId, input.now
    );
    return this.requireAsset(assetId);
  }

  private insertTaskContract(contract: V7TaskContract, contentHash: string): boolean {
    const existing = this.database.prepare(`SELECT content_hash,owner_id,book_id,task_id FROM v7_task_contracts WHERE contract_id=?`)
      .get(contract.contractId) as { content_hash: string; owner_id: string; book_id: string; task_id: string } | undefined;
    if (existing !== undefined) {
      if (existing.content_hash !== contentHash || existing.owner_id !== contract.ownerId
        || existing.book_id !== contract.bookId || existing.task_id !== contract.taskId) {
        throw new Error('任务合同编号已存在但内容或范围不同');
      }
      return false;
    }
    this.database.prepare(`INSERT INTO v7_task_contracts(
      contract_id,version,owner_id,book_id,task_id,task_kind,workstation_key,operation_mode,objective,
      must_preserve_json,allowed_changes_json,forbidden_changes_json,success_criteria_json,output_contract_json,
      selected_skill_keys_json,author_instruction_version,based_on_task_id,lifecycle_status,content_hash,created_at
    ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?, 'active',?,?)`).run(
      contract.contractId, contract.version, contract.ownerId, contract.bookId, contract.taskId, contract.taskKind,
      contract.workstationKey, contract.operationMode, contract.objective, JSON.stringify(contract.mustPreserve),
      JSON.stringify(contract.allowedChanges), JSON.stringify(contract.forbiddenChanges), JSON.stringify(contract.successCriteria),
      stableStringify(contract.outputContract), JSON.stringify(contract.selectedSkillKeys),
      contract.authorInstructionVersion, contract.basedOnTaskId, contentHash, contract.createdAt
    );
    return true;
  }

  private insertContextPack(context: V7ContextPackTrace): boolean {
    const existing = this.database.prepare(`SELECT * FROM v7_context_pack_traces WHERE context_pack_id=?`)
      .get(context.contextPackId) as Record<string, unknown> | undefined;
    if (existing !== undefined) {
      const sourceRows = this.database.prepare(`SELECT * FROM v7_context_source_traces WHERE context_pack_id=? ORDER BY sequence`)
        .all(context.contextPackId) as unknown as Array<Record<string, unknown>>;
      const stored = mapContextPackRow(existing, sourceRows);
      if (stableStringify(contextPackSemantic(stored)) !== stableStringify(contextPackSemantic(context))) {
        throw new Error('资料包编号已存在但内容或范围不同');
      }
      return false;
    }
    const computedHash = sha256(stableStringify(context.content));
    if (computedHash !== context.contentHash) throw new Error('资料包内容哈希不匹配');
    if (context.sources.some((source) => source.ownerId !== context.ownerId || source.bookId !== context.bookId)) {
      throw new Error('资料来源与资料包书籍范围不一致');
    }
    assertSafe(context.content);
    this.database.prepare(`INSERT INTO v7_context_pack_traces(
      context_pack_id,owner_id,book_id,task_id,policy_version,token_budget,estimated_tokens,
      content_json,content_hash,lifecycle_status,created_at
    ) VALUES(?,?,?,?,?,?,?,?,?,'active',?)`).run(
      context.contextPackId, context.ownerId, context.bookId, context.taskId, context.policyVersion,
      context.tokenBudget, context.estimatedTokens, stableStringify(context.content), context.contentHash, context.createdAt
    );
    const insertSource = this.database.prepare(`INSERT INTO v7_context_source_traces(
      trace_id,context_pack_id,owner_id,book_id,sequence,source_key,source_type,source_id,source_version,authority,
      decision,reason,content_hash,estimated_tokens
    ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
    context.sources.forEach((source, sequence) => insertSource.run(
      `${context.contextPackId}:${sequence}`, context.contextPackId, source.ownerId, source.bookId,
      sequence, source.sourceKey, source.sourceType,
      source.sourceId, source.sourceVersion, source.authority, source.decision, source.reason,
      source.contentHash, source.estimatedTokens
    ));
    return true;
  }

  private insertManifest(manifest: V7PromptManifest): boolean {
    const existing = this.database.prepare(`SELECT * FROM v7_prompt_manifests WHERE manifest_id=?`)
      .get(manifest.manifestId) as PromptManifestRow | undefined;
    if (existing !== undefined) {
      if (stableStringify(manifestSemantic(mapManifest(existing))) !== stableStringify(manifestSemantic(manifest))) {
        throw new Error('提示清单编号已存在但内容或范围不同');
      }
      return false;
    }
    if (sha256(manifest.compiledPrompt) !== manifest.compiledPromptHash) throw new Error('编译提示哈希不匹配');
    assertSafe(manifest.compiledBlocks);
    assertSafe(manifest.compiledPrompt);
    for (const assetId of [manifest.rolePromptVersionId, manifest.workstationPromptVersionId, ...manifest.skillVersionIds]) {
      const asset = this.requireAsset(assetId);
      if (asset.status !== 'published') throw new Error(`运行时只能引用已发布提示资产：${assetId}`);
    }
    if (manifest.genreProfileId !== null) {
      const profile = this.database.prepare(`SELECT version FROM v7_book_genre_profiles
        WHERE profile_id=? AND owner_id=? AND book_id=?`).get(
          manifest.genreProfileId, manifest.ownerId, manifest.bookId
        ) as { version: number } | undefined;
      if (profile === undefined || profile.version !== manifest.genreProfileVersion) throw new Error('提示清单引用的题材工作档案不存在或版本不符');
    }
    this.database.prepare(`INSERT INTO v7_prompt_manifests(
      manifest_id,owner_id,book_id,task_id,member_key,role_key,workstation_key,task_kind,operation_mode,
      role_prompt_version_id,workstation_prompt_version_id,genre_profile_id,genre_profile_version,
      skill_version_ids_json,task_contract_id,task_contract_version,context_pack_id,context_pack_hash,
       model_profile_key,provider,model_id,plan,max_output_tokens,governance_revision,temperature,allowed_tools_json,compiled_blocks_json,
       compiled_prompt,compiled_prompt_hash,lifecycle_status,created_at
    ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'active',?)`).run(
      manifest.manifestId, manifest.ownerId, manifest.bookId, manifest.taskId, manifest.memberKey, manifest.roleKey,
      manifest.workstationKey, manifest.taskKind, manifest.operationMode, manifest.rolePromptVersionId,
      manifest.workstationPromptVersionId, manifest.genreProfileId, manifest.genreProfileVersion,
      JSON.stringify(manifest.skillVersionIds), manifest.taskContractId, manifest.taskContractVersion,
      manifest.contextPackId, manifest.contextPackHash, manifest.modelProfileKey, manifest.provider,
      manifest.modelId, manifest.plan, manifest.maxOutputTokens, manifest.governanceRevision,
      manifest.temperature, JSON.stringify(manifest.allowedTools), stableStringify(manifest.compiledBlocks),
      manifest.compiledPrompt, manifest.compiledPromptHash, manifest.createdAt
    );
    return true;
  }

  private requireAsset(assetId: string): V7StoredPromptAssetVersion {
    const asset = this.assetById(assetId);
    if (asset === null) throw new Error('提示资产版本不存在');
    return asset;
  }

  private assertRevision(expectedRevision: number): void {
    const row = this.database.prepare(`SELECT revision FROM v7_prompt_governance_meta WHERE singleton=1`).get() as
      { revision: number } | undefined;
    if (row === undefined || row.revision !== expectedRevision) throw new Error('提示配置刚刚被其他操作更新，请刷新后再试');
  }

  private bumpRevision(expectedRevision: number, actorId: string, now: string): void {
    const result = this.database.prepare(`UPDATE v7_prompt_governance_meta SET revision=revision+1,updated_by=?,updated_at=?
      WHERE singleton=1 AND revision=?`).run(actorId, now, expectedRevision);
    if (result.changes !== 1) throw new Error('提示配置刚刚被其他操作更新，请刷新后再试');
  }

  private insertEvent(eventId: string, actorId: string, eventType: string, targetKind: string, targetKey: string,
    before: unknown, after: unknown, reason: string, now: string): void {
    this.database.prepare(`INSERT OR IGNORE INTO v7_prompt_governance_events(
      event_id,actor_id,event_type,target_kind,target_key,before_json,after_json,reason,created_at
    ) VALUES(?,?,?,?,?,?,?,?,?)`).run(eventId, actorId, eventType, targetKind, targetKey,
      before === null ? null : stableStringify(before), after === null ? null : stableStringify(after), reason, now);
  }
}

function mapAsset(row: PromptAssetRow | undefined): V7StoredPromptAssetVersion | null {
  if (row === undefined) return null;
  return {
    assetId: row.asset_id,
    assetKey: row.asset_key,
    kind: row.kind,
    version: row.version,
    status: row.status,
    title: row.title,
    summary: row.summary,
    content: parseJson<Record<string, unknown>>(row.content_json),
    createdAt: row.created_at,
    createdBy: row.created_by,
    basedOnVersion: row.based_on_asset_id === null ? null : versionFromAssetId(row.based_on_asset_id),
    governanceRevision: row.governance_revision,
    contentHash: row.content_hash,
    basedOnAssetId: row.based_on_asset_id,
    publishedBy: row.published_by,
    publishedAt: row.published_at,
    retiredBy: row.retired_by,
    retiredAt: row.retired_at
  };
}

function assetEventView(asset: V7StoredPromptAssetVersion): object {
  return {
    assetId: asset.assetId,
    assetKey: asset.assetKey,
    kind: asset.kind,
    version: asset.version,
    status: asset.status,
    contentHash: asset.contentHash
  };
}

function validateRuntimeBundle(input: V7RuntimeBundleInput): void {
  const { taskContract, contextPack, manifest } = input;
  assertSafe(taskContractSemantic(taskContract));
  assertSafe(contextPackSemantic(contextPack));
  assertSafe(manifestSemantic(manifest));
  const scopes = [taskContract, contextPack, manifest];
  if (scopes.some((item) => item.ownerId !== taskContract.ownerId || item.bookId !== taskContract.bookId || item.taskId !== taskContract.taskId)) {
    throw new Error('任务合同、资料包与提示清单范围不一致');
  }
  if (manifest.taskContractId !== taskContract.contractId || manifest.taskContractVersion !== taskContract.version) {
    throw new Error('提示清单引用的任务合同版本不一致');
  }
  if (manifest.contextPackId !== contextPack.contextPackId || manifest.contextPackHash !== contextPack.contentHash) {
    throw new Error('提示清单引用的资料包版本不一致');
  }
  if (manifest.taskKind !== taskContract.taskKind || manifest.workstationKey !== taskContract.workstationKey
    || manifest.operationMode !== taskContract.operationMode) {
    throw new Error('提示清单与任务合同的工位或操作类型不一致');
  }
  const expectedBinding = modelBindingForProfile(manifest.modelProfileKey);
  if (manifest.provider !== expectedBinding.provider || manifest.modelId !== expectedBinding.modelId
    || manifest.plan !== expectedBinding.plan) {
    throw new Error('提示清单的具体模型绑定与治理档案不一致');
  }
  if (!Number.isInteger(manifest.maxOutputTokens) || manifest.maxOutputTokens < 1
    || manifest.maxOutputTokens > 200_000) {
    throw new Error('提示清单的最大输出Token无效');
  }
}

function taskContractSemantic(contract: V7TaskContract): object {
  return {
    version: contract.version,
    ownerId: contract.ownerId,
    bookId: contract.bookId,
    taskId: contract.taskId,
    taskKind: contract.taskKind,
    workstationKey: contract.workstationKey,
    operationMode: contract.operationMode,
    objective: contract.objective,
    mustPreserve: contract.mustPreserve,
    allowedChanges: contract.allowedChanges,
    forbiddenChanges: contract.forbiddenChanges,
    successCriteria: contract.successCriteria,
    outputContract: contract.outputContract,
    selectedSkillKeys: contract.selectedSkillKeys,
    authorInstructionVersion: contract.authorInstructionVersion,
    basedOnTaskId: contract.basedOnTaskId
  };
}

function genreProfileSemantic(profile: V7BookGenreProfile): object {
  return {
    ownerId: profile.ownerId,
    bookId: profile.bookId,
    version: profile.version,
    primaryGenreKey: profile.primaryGenreKey,
    supportingGenreKeys: profile.supportingGenreKeys,
    sourceAssetVersionIds: profile.sourceAssetVersionIds,
    sourceBookVersion: profile.sourceBookVersion,
    publicLabel: profile.publicLabel,
    workingIdentity: profile.workingIdentity,
    primaryPromise: profile.primaryPromise,
    supportingFunctions: profile.supportingFunctions,
    writingPriorities: profile.writingPriorities,
    authenticityChecks: profile.authenticityChecks,
    avoidPatterns: profile.avoidPatterns,
    conflictResolutions: profile.conflictResolutions,
    compiledByTaskId: profile.compiledByTaskId
  };
}

function contextPackSemantic(context: V7ContextPackTrace | object): object {
  const value = context as Record<string, unknown>;
  return {
    contextPackId: value.contextPackId,
    ownerId: value.ownerId,
    bookId: value.bookId,
    taskId: value.taskId,
    policyVersion: value.policyVersion,
    tokenBudget: value.tokenBudget,
    estimatedTokens: value.estimatedTokens,
    sources: value.sources,
    content: value.content,
    contentHash: value.contentHash,
    createdAt: value.createdAt
  };
}

function manifestSemantic(manifest: V7PromptManifest | object): object {
  const value = manifest as Record<string, unknown>;
  return {
    manifestId: value.manifestId,
    ownerId: value.ownerId,
    bookId: value.bookId,
    taskId: value.taskId,
    memberKey: value.memberKey,
    roleKey: value.roleKey,
    workstationKey: value.workstationKey,
    taskKind: value.taskKind,
    operationMode: value.operationMode,
    rolePromptVersionId: value.rolePromptVersionId,
    workstationPromptVersionId: value.workstationPromptVersionId,
    genreProfileId: value.genreProfileId,
    genreProfileVersion: value.genreProfileVersion,
    skillVersionIds: value.skillVersionIds,
    taskContractId: value.taskContractId,
    taskContractVersion: value.taskContractVersion,
    contextPackId: value.contextPackId,
    contextPackHash: value.contextPackHash,
    modelProfileKey: value.modelProfileKey,
    provider: value.provider,
    modelId: value.modelId,
    plan: value.plan,
    maxOutputTokens: value.maxOutputTokens,
    governanceRevision: value.governanceRevision,
    temperature: value.temperature,
    allowedTools: value.allowedTools,
    compiledBlocks: value.compiledBlocks,
    compiledPrompt: value.compiledPrompt,
    compiledPromptHash: value.compiledPromptHash,
    createdAt: value.createdAt
  };
}

function assertSafe(value: unknown): void {
  const serialized = typeof value === 'string' ? value : JSON.stringify(value);
  if (SAFE_VALUE_PATTERN.test(serialized)) throw new Error('提示资产或运行快照包含疑似密钥，已拒绝保存');
  if (HIDDEN_REASONING_PATTERN.test(serialized)) throw new Error('不得保存模型思维链');
}

function manifestSummary(row: PromptManifestRow): object {
  return {
    manifestId: row.manifest_id,
    ownerId: row.owner_id,
    bookId: row.book_id,
    taskId: row.task_id,
    memberKey: row.member_key,
    roleKey: row.role_key,
    workstationKey: row.workstation_key,
    taskKind: row.task_kind,
    operationMode: row.operation_mode,
    modelProfileKey: row.model_profile_key,
    provider: row.provider,
    modelId: row.model_id,
    plan: row.plan,
    maxOutputTokens: row.max_output_tokens,
    governanceRevision: row.governance_revision,
    compiledPromptHash: row.compiled_prompt_hash,
    lifecycleStatus: row.lifecycle_status,
    createdAt: row.created_at
  };
}

function prebookManifestSummary(row: PrebookPromptBundleRow): ManifestListItem {
  const bundle = parsePrebookPromptBundle(row);
  validateRuntimeBundle(bundle);
  return {
    manifestId: bundle.manifest.manifestId,
    ownerId: bundle.manifest.ownerId,
    bookId: bundle.manifest.bookId,
    taskId: bundle.manifest.taskId,
    openingTaskId: row.opening_task_id,
    memberKey: bundle.manifest.memberKey,
    roleKey: bundle.manifest.roleKey,
    workstationKey: bundle.manifest.workstationKey,
    taskKind: bundle.manifest.taskKind,
    operationMode: bundle.manifest.operationMode,
    modelProfileKey: bundle.manifest.modelProfileKey,
    provider: bundle.manifest.provider,
    modelId: bundle.manifest.modelId,
    plan: bundle.manifest.plan,
    maxOutputTokens: bundle.manifest.maxOutputTokens,
    governanceRevision: bundle.manifest.governanceRevision,
    compiledPromptHash: bundle.manifest.compiledPromptHash,
    lifecycleStatus: 'immutable',
    requestState: row.state,
    execution: prebookExecution(row),
    storageKind: 'prebook_model_call',
    createdAt: bundle.manifest.createdAt || row.created_at
  };
}

function prebookExecution(row: PrebookPromptBundleRow): V7PromptExecutionView {
  return executionView({
    state: row.state,
    output_text: null,
    failure_message: row.failure_message,
    completed_at: row.completed_at,
    updated_at: row.created_at,
    source_kind: 'opening'
  }, 'opening_design');
}

function executionView(row: PromptExecutionRow, taskKind?: string): V7PromptExecutionView {
  const state = normalizeExecutionState(row.state);
  const artifactType = artifactLabel(row.source_kind, taskKind);
  if (state === 'working') {
    return { state, summary: `${artifactType}正在处理中，提示快照已经冻结。`, completedAt: null,
      sourceKind: row.source_kind, artifactType };
  }
  if (state === 'failed') {
    return {
      state,
      summary: safeFailureSummary(row.failure_message, artifactType),
      completedAt: row.completed_at,
      sourceKind: row.source_kind,
      artifactType
    };
  }
  if (state === 'unknown') {
    return {
      state,
      summary: `${artifactType}结果暂时无法确认，系统已保留快照，不能当作成功结果。`,
      completedAt: row.completed_at,
      sourceKind: row.source_kind,
      artifactType
    };
  }
  return {
    state: 'succeeded',
    summary: `${artifactType}已经完成并保存，可在对应创作页面查看。`,
    completedAt: row.completed_at,
    sourceKind: row.source_kind,
    artifactType
  };
}

function normalizeExecutionState(value: string): V7PromptExecutionView['state'] {
  if (value === 'working' || value === 'succeeded' || value === 'failed' || value === 'unknown') return value;
  if (value === 'interrupted') return 'failed';
  return 'unknown';
}

function safeFailureSummary(value: string | null, artifactType: string): string {
  const normalized = value?.trim() ?? '';
  if (normalized.length === 0 || normalized.length > 180 || SAFE_VALUE_PATTERN.test(normalized)
    || /(?:\bSQL\b|sqlite|stack|node_modules|\\private\\|[A-Za-z]:\\)/iu.test(normalized)) {
    return `对不起，这次${artifactType}没有完成；失败记录已经保留，可以按任务恢复方式继续处理。`;
  }
  return `对不起，这次${artifactType}没有完成：${normalized}`;
}

function artifactLabel(sourceKind: string | null, taskKind?: string): string {
  if (taskKind === 'cover_brief' || sourceKind === 'cover_brief') return '封面制作单';
  if (taskKind === 'cover_render') return '封面图片';
  if (taskKind === 'title_design' || sourceKind === 'title') return '书名候选';
  if (taskKind === 'opening_design' || taskKind === 'opening_review' || sourceKind === 'opening') return '开书资料';
  if (taskKind === 'setting_recommendation' || taskKind === 'setting_design'
    || taskKind === 'setting_review' || sourceKind === 'setting') return '设定方案';
  if (taskKind === 'chapter_outline') return '章纲';
  if (taskKind === 'manuscript' || taskKind === 'manuscript_review') return '正文与审查结果';
  if (taskKind === 'settlement' || taskKind === 'character_context'
    || taskKind === 'character_maintenance' || taskKind === 'planning_maintenance'
    || sourceKind === 'character') return '连续性记录';
  if (sourceKind === 'planning' || taskKind?.startsWith('planning_') === true) return '规划方案';
  if (sourceKind === 'creation') return '创作产物';
  if (sourceKind === 'cover') return '封面产物';
  return '任务产物';
}

function parsePrebookPromptBundle(row: PrebookPromptBundleRow): V7RuntimeBundleInput {
  return {
    taskContract: parseJson<V7TaskContract>(row.task_contract_json),
    contextPack: parseJson<V7ContextPackTrace>(row.context_pack_json),
    manifest: parseJson<V7PromptManifest>(row.prompt_manifest_json)
  };
}

function mapManifest(row: PromptManifestRow): V7PromptManifest & { lifecycleStatus: string } {
  return {
    manifestId: row.manifest_id,
    ownerId: row.owner_id,
    bookId: row.book_id,
    taskId: row.task_id,
    memberKey: row.member_key,
    roleKey: row.role_key,
    workstationKey: row.workstation_key,
    taskKind: row.task_kind,
    operationMode: row.operation_mode,
    rolePromptVersionId: row.role_prompt_version_id,
    workstationPromptVersionId: row.workstation_prompt_version_id,
    genreProfileId: row.genre_profile_id,
    genreProfileVersion: row.genre_profile_version,
    skillVersionIds: parseJson<string[]>(row.skill_version_ids_json),
    taskContractId: row.task_contract_id,
    taskContractVersion: row.task_contract_version,
    contextPackId: row.context_pack_id,
    contextPackHash: row.context_pack_hash,
    modelProfileKey: row.model_profile_key,
    provider: row.provider,
    modelId: row.model_id,
    plan: row.plan,
    maxOutputTokens: row.max_output_tokens,
    governanceRevision: row.governance_revision,
    temperature: row.temperature,
    allowedTools: parseJson<string[]>(row.allowed_tools_json),
    compiledBlocks: parseJson<Record<string, unknown>>(row.compiled_blocks_json),
    compiledPrompt: row.compiled_prompt,
    compiledPromptHash: row.compiled_prompt_hash,
    createdAt: row.created_at,
    lifecycleStatus: row.lifecycle_status
  };
}

function mapTaskContractRow(row: Record<string, unknown>): object {
  return {
    contractId: row.contract_id,
    version: row.version,
    ownerId: row.owner_id,
    bookId: row.book_id,
    taskId: row.task_id,
    taskKind: row.task_kind,
    workstationKey: row.workstation_key,
    operationMode: row.operation_mode,
    objective: row.objective,
    mustPreserve: parseJson(String(row.must_preserve_json)),
    allowedChanges: parseJson(String(row.allowed_changes_json)),
    forbiddenChanges: parseJson(String(row.forbidden_changes_json)),
    successCriteria: parseJson(String(row.success_criteria_json)),
    outputContract: parseJson(String(row.output_contract_json)),
    selectedSkillKeys: row.selected_skill_keys_json === undefined
      ? [] : parseJson(String(row.selected_skill_keys_json)),
    authorInstructionVersion: row.author_instruction_version,
    basedOnTaskId: row.based_on_task_id,
    lifecycleStatus: row.lifecycle_status,
    contentHash: row.content_hash,
    createdAt: row.created_at
  };
}

function mapContextPackRow(row: Record<string, unknown>, sources: Array<Record<string, unknown>>): object {
  return {
    contextPackId: row.context_pack_id,
    ownerId: row.owner_id,
    bookId: row.book_id,
    taskId: row.task_id,
    policyVersion: row.policy_version,
    tokenBudget: row.token_budget,
    estimatedTokens: row.estimated_tokens,
    content: parseJson(String(row.content_json)),
    contentHash: row.content_hash,
    lifecycleStatus: row.lifecycle_status,
    createdAt: row.created_at,
    sources: sources.map((source) => ({
      ownerId: source.owner_id,
      bookId: source.book_id,
      sourceKey: source.source_key,
      sourceType: source.source_type,
      sourceId: source.source_id,
      sourceVersion: source.source_version,
      authority: source.authority,
      decision: source.decision,
      reason: source.reason,
      contentHash: source.content_hash,
      estimatedTokens: source.estimated_tokens
    }))
  };
}

function mapGenreProfileRow(row: Record<string, unknown>): V7BookGenreProfile & { contentHash: string } {
  return {
    profileId: String(row.profile_id),
    ownerId: String(row.owner_id),
    bookId: String(row.book_id),
    version: Number(row.version),
    status: String(row.status) as V7BookGenreProfile['status'],
    primaryGenreKey: String(row.primary_genre_key),
    supportingGenreKeys: parseJson<string[]>(String(row.supporting_genre_keys_json)),
    sourceAssetVersionIds: parseJson<string[]>(String(row.source_asset_version_ids_json)),
    sourceBookVersion: Number(row.source_book_version),
    publicLabel: String(row.public_label),
    workingIdentity: String(row.working_identity),
    primaryPromise: String(row.primary_promise),
    supportingFunctions: parseJson<string[]>(String(row.supporting_functions_json)),
    writingPriorities: parseJson<string[]>(String(row.writing_priorities_json)),
    authenticityChecks: parseJson<string[]>(String(row.authenticity_checks_json)),
    avoidPatterns: parseJson<string[]>(String(row.avoid_patterns_json)),
    conflictResolutions: parseJson<string[]>(String(row.conflict_resolutions_json)),
    compiledByTaskId: String(row.compiled_by_task_id),
    contentHash: String(row.content_hash),
    createdAt: String(row.created_at)
  };
}

function parseJson<T = unknown>(value: string): T {
  return JSON.parse(value) as T;
}

function versionFromAssetId(assetId: string): number | null {
  const separator = assetId.lastIndexOf('@');
  if (separator < 0) return null;
  const parsed = Number(assetId.slice(separator + 1));
  return Number.isInteger(parsed) && parsed >= 1 ? parsed : null;
}
