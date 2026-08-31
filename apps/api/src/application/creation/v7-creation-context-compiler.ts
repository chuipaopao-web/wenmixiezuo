import { createHash } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import {
  V7_CREATION_CONTEXT_CHAR_BUDGETS,
  creationPromptContext,
  contextSelectionPrompt,
  creationFallbackChain,
  parseContextSelection,
  projectPlanningTreeForChild,
  retrievePlanningMethodCandidates,
  V7_CREATION_CONTEXT_SCHEMA,
  type V7ContextSourceTrace,
  type V7CreationContextPack,
  type V7CreationMethodPlan,
  type V7CreationContextSelection,
  type V7CreationMemberDefinition,
  type V7CreationSourceCandidate,
  type PlanningTreeDocument
} from '@wenmi/v7-backend';
import { DomainError, errorCodes } from '../../domain/errors.js';
import type { Clock, IdGenerator } from '../../domain/ids.js';
import { V7CharacterMemoryRepository } from '../../infrastructure/db/repositories/v7-character-memory-repository.js';
import {
  V7CreationRuntimeRepository,
  type V7CreationContextPackRow
} from '../../infrastructure/db/repositories/v7-creation-runtime-repository.js';
import { V7PlanningRuntimeRepository } from '../../infrastructure/db/repositories/v7-planning-runtime-repository.js';
import {
  V7CreationModelError,
  V7CreationModelGateway,
  type V7CreationModelAdapterResolver
} from '../../infrastructure/models/v7-creation-model-gateway.js';
import {
  type V7SettingContextProjection
} from '../books/v7-setting-context-projection.js';
import { V7SettingLedgerReader } from '../books/v7-setting-ledger-reader.js';

const MAXIMUM_SELECTED_SOURCES = 12;
const CONTEXT_PROJECTION_VERSION = 'layered-context-projection-v8';

interface FormalOpeningRow {
  opening_blueprint_id: string;
  version: number;
  blueprint_json: string;
  content_hash: string;
  title: string;
}

interface ConfirmedSettingRow {
  item_key: string;
  item_label: string;
  version_id: string;
  revision: number;
  content_json: string;
}

interface ConfirmedTreeRow {
  tree_version_id: string;
  tree_kind: 'book' | 'volume' | 'chain';
  scope_id: string;
  revision: number;
  content_hash: string;
  content_json: string;
}

export interface V7CreationContextCompileInput {
  ownerId: string;
  bookId: string;
  workflowId: string;
  taskKind: V7CreationContextPack['taskKind'];
  taskId: string;
  taskBrief: string;
  firstVolume: boolean;
  authorInput?: string | null;
  requiredTree?: { treeKind: 'book' | 'volume' | 'chain'; scopeId: string };
  extraSources?: readonly V7CreationSourceCandidate[];
}

export interface V7CompiledCreationContext {
  contextPackId: string;
  sourceFingerprint: string;
  selection: V7CreationContextSelection;
  content: V7CreationContextPack;
  /** 本轮采用/排除决定、任务期题材身份与方法检索意图，全部由资料策划 Agent 冻结。 */
  sourceTraces: V7ContextSourceTrace[];
}

/**
 * 程序只按书籍归属、版本和父子层级召回合法来源，不判断故事语义。
 * 资料策划 Agent 负责语义取舍、任务期题材身份和方法检索意图；系统只做
 * 合法候选召回、版本冻结、硬预算与结果校验。同一来源指纹会复用成功结果，
 * 因此重试与同任务多席不会重复消耗资料策划调用。
 */
export class V7CreationContextCompiler {
  private readonly creation: V7CreationRuntimeRepository;
  private readonly planning: V7PlanningRuntimeRepository;
  private readonly characters: V7CharacterMemoryRepository;
  private readonly models: V7CreationModelGateway;
  private readonly settingLedger: V7SettingLedgerReader;

  public constructor(
    database: DatabaseSync,
    adapters: V7CreationModelAdapterResolver,
    private readonly ids: IdGenerator,
    private readonly clock: Clock,
    private readonly members: () => readonly V7CreationMemberDefinition[]
  ) {
    this.creation = new V7CreationRuntimeRepository(database);
    this.planning = new V7PlanningRuntimeRepository(database);
    this.characters = new V7CharacterMemoryRepository(database);
    this.models = new V7CreationModelGateway(database, adapters, clock);
    this.settingLedger = new V7SettingLedgerReader(database);
  }

  public cancelWorkflow(workflowId: string): void {
    this.models.cancelWorkflow(workflowId);
  }

  public async compile(input: V7CreationContextCompileInput): Promise<V7CompiledCreationContext> {
    const candidates = this.candidates(input);
    const requiredCount = candidates.filter((item) => item.required).length;
    const maximumSources = Math.max(MAXIMUM_SELECTED_SOURCES, requiredCount);
    const sourceFingerprint = sha256(stableJson({
      projectionVersion: CONTEXT_PROJECTION_VERSION,
      taskKind: input.taskKind,
      taskId: input.taskId,
      firstVolume: input.firstVolume,
      sources: candidates.map((item) => ({
        sourceKey: item.sourceKey,
        sourceVersion: item.sourceVersion,
        contentHash: item.contentHash,
        required: item.required
      }))
    }));
    const existing = this.creation.contextPackByFingerprint({
      ownerId: input.ownerId,
      bookId: input.bookId,
      workflowId: input.workflowId,
      taskKind: input.taskKind,
      taskId: input.taskId,
      sourceFingerprint
    });
    if (existing?.status === 'active') return activeView(existing);
    if (existing?.status === 'unknown' || existing?.status === 'working') {
      throw new DomainError(
        errorCodes.validation,
        '资料整理结果还没有确认，已停止重复下单。',
        {},
        false,
        409
      );
    }

    const firstMember = creationFallbackChain('context_editor', undefined, this.members())[0];
    if (firstMember === undefined) throw new Error('资料编辑部没有可用成员');
    const pack = existing ?? this.creation.createContextPack({
      contextPackId: this.ids.next(),
      ownerId: input.ownerId,
      bookId: input.bookId,
      workflowId: input.workflowId,
      taskKind: input.taskKind,
      taskId: input.taskId,
      taskBrief: taskBrief(input.taskBrief),
      candidates,
      sourceFingerprint,
      assignedMemberKey: firstMember.memberKey,
      now: this.now()
    });

    const failures: string[] = [];
    const workflowCalls = this.creation.modelCallsForWorkflow(input.ownerId, input.bookId, input.workflowId);
    const recovered = workflowCalls.toReversed().find((call) => call.run_kind === 'context'
      && call.request_id.startsWith(`creation-context:${pack.context_pack_id}:`)
      && call.state === 'succeeded'
      && call.output_text !== null);
    if (recovered?.output_text !== null && recovered?.output_text !== undefined) {
      try {
        const selection = parseContextSelection(recovered.output_text, candidates, maximumSources, input.taskKind);
        const content = compilePack(input, candidates, selection);
        this.creation.activateContext({
          ownerId: input.ownerId,
          bookId: input.bookId,
          contextPackId: pack.context_pack_id,
          selection,
          content,
          contentHash: sha256(stableJson(content)),
          now: this.now()
        });
        return {
          contextPackId: pack.context_pack_id,
          sourceFingerprint,
          selection,
          content,
          sourceTraces: contextSourceTraces(input.ownerId, input.bookId, candidates, selection)
        };
      } catch {
        // The prior answer may predate a parser or budget contract.  Only in
        // that case is a fresh context-editor call justified.
      }
    }
    const attemptMarker = String(workflowCalls
      .filter((call) => call.run_kind === 'context' && call.node_key === `${input.taskKind}:${input.taskId}`).length);
    for (const member of creationFallbackChain('context_editor', undefined, this.members())) {
      const requestId = `creation-context:${pack.context_pack_id}:${attemptMarker}:${member.memberKey}`;
      this.creation.markContextWorking({
        ownerId: input.ownerId,
        bookId: input.bookId,
        contextPackId: pack.context_pack_id,
        memberKey: member.memberKey,
        requestId,
        now: this.now()
      });
      try {
        const result = await this.models.generate({
          requestId,
          ownerId: input.ownerId,
          bookId: input.bookId,
          workflowId: input.workflowId,
          runKind: 'context',
          nodeKey: `${input.taskKind}:${input.taskId}`,
          workstationKey: contextWorkstation(input.taskKind),
          member,
          purpose: 'structured_planning',
          operationMode: 'fresh',
          basedOnTaskId: null,
          authorInstructionVersion: null,
          // The selection Agent is producing the fine-grained evidence in
          // this call, so only the aggregate candidate payload exists yet.
          sourceTraces: [],
          prompt: contextSelectionPrompt({
            taskKind: input.taskKind,
            taskBrief: taskBrief(input.taskBrief),
            candidates,
            maximumSources,
            maximumCharacters: V7_CREATION_CONTEXT_CHAR_BUDGETS[input.taskKind]
          }),
          maxOutputTokens: 3_000,
          temperature: 0.18
        });
        const selection = parseContextSelection(result.output, candidates, maximumSources, input.taskKind);
        const content = compilePack(input, candidates, selection);
        const contentHash = sha256(stableJson(content));
        this.creation.activateContext({
          ownerId: input.ownerId,
          bookId: input.bookId,
          contextPackId: pack.context_pack_id,
          selection,
          content,
          contentHash,
          now: this.now()
        });
        return {
          contextPackId: pack.context_pack_id,
          sourceFingerprint,
          selection,
          content,
          sourceTraces: contextSourceTraces(input.ownerId, input.bookId, candidates, selection)
        };
      } catch (error) {
        if (error instanceof V7CreationModelError && error.outcomeUnknown) {
          this.creation.failContext({
            ownerId: input.ownerId,
            bookId: input.bookId,
            contextPackId: pack.context_pack_id,
            status: 'unknown',
            message: publicFailure(error),
            now: this.now()
          });
          throw new DomainError(errorCodes.validation, publicFailure(error), {}, true, 503);
        }
        if (error instanceof DomainError) {
          this.creation.failContext({
            ownerId: input.ownerId,
            bookId: input.bookId,
            contextPackId: pack.context_pack_id,
            status: 'failed',
            message: error.message,
            now: this.now()
          });
          throw error;
        }
        failures.push(publicFailure(error));
      }
    }
    const message = `对不起，这次资料没有整理完成。${failures.at(-1) ?? '编辑部没有交回可用结果。'}`;
    this.creation.failContext({
      ownerId: input.ownerId,
      bookId: input.bookId,
      contextPackId: pack.context_pack_id,
      status: 'failed',
      message,
      now: this.now()
    });
    throw new DomainError(errorCodes.validation, message, {}, true, 503);
  }

  private candidates(input: V7CreationContextCompileInput): V7CreationSourceCandidate[] {
    const opening = this.planning.formalOpening(input.ownerId, input.bookId) as unknown as FormalOpeningRow | undefined;
    if (opening === undefined) throw gate('请先完成并确认开书资料。');
    const settings = this.planning.confirmedSettings(input.ownerId, input.bookId) as unknown as ConfirmedSettingRow[];
    if (settings.length === 0) throw gate('请先确认本书设定，再继续创作。');
    const ledger = this.settingLedger.readCurrent({
      ownerId: input.ownerId,
      bookId: input.bookId,
      openingVersion: opening.version,
      settings
    });
    const openingContent = { title: opening.title, ...jsonObject(opening.blueprint_json, '开书资料') };
    const settingProjections: V7SettingContextProjection[] = ledger.projections;
    const reviewedFacts = new Map(ledger.content.factLedger.map((entry) => [entry.itemKey, entry.facts]));

    const candidates: V7CreationSourceCandidate[] = [candidate({
      sourceKey: 'formal:opening',
      sourceKind: 'opening',
      sourceId: opening.opening_blueprint_id,
      sourceVersion: String(opening.version),
      authority: 'formal',
      label: '当前正式开书资料',
      content: openingContent,
      selectionContent: openingContextProjection(openingContent),
      contentHash: opening.content_hash,
      required: ['volume', 'manuscript', 'review'].includes(input.taskKind),
      includedReason: '这是作者已经确认的开书资料。'
    }), candidate({
      sourceKey: 'formal:setting-ledger',
      sourceKind: 'setting',
      sourceId: ledger.sourceId,
      sourceVersion: ledger.sourceVersion,
      authority: 'formal',
      label: '当前设定事实账本',
      content: ledger.content,
      selectionContent: settingLedgerContextProjection(ledger.content, input.taskKind),
      contentHash: ledger.contentHash,
      required: input.taskKind !== 'settlement',
      includedReason: '这是主编签发的整书摘要和分组边界；完整设定仍按条目保存，需要时才回查。'
    })];
    settings.forEach((setting, index) => {
      const projection = settingProjections[index]!;
      candidates.push(candidate({
        sourceKey: `formal:setting:${setting.item_key}`,
        sourceKind: 'setting',
        sourceId: setting.version_id,
        sourceVersion: String(setting.revision),
        authority: 'formal',
        label: `设定原文：${setting.item_label}`,
        content: jsonObject(setting.content_json, `设定“${setting.item_label}”`),
        selectionContent: {
          schema: 'v7-setting-fact-source-v1',
          itemKey: projection.itemKey,
          label: projection.label,
          contextSummary: projection.contextSummary,
          factCount: (reviewedFacts.get(projection.itemKey) ?? projection.factEntries).length,
          projectionSource: projection.projectionSource
        },
        contentHash: sha256(setting.content_json),
        required: false,
        includedReason: '只有当前任务确实需要核对该条目的完整措辞时才回查。'
      }));
    });

    const bookTree = this.planning.confirmedTree(input.ownerId, input.bookId, 'book', input.bookId) as unknown as ConfirmedTreeRow | undefined;
    if (bookTree === undefined) throw gate('请先确认全书方向树。');
    // The whole-book tree may contain many future nodes.  Every downstream
    // task receives its Agent-authored responsibility projection, while the
    // current parent tree below remains exact.  This is structural projection,
    // not a programmatic story summary.
    candidates.push(treeCandidate(
      bookTree,
      '已确认全书方向',
      input.taskKind === 'volume',
      true,
      input.taskKind === 'volume' ? input.taskId : undefined
    ));

    if (input.requiredTree !== undefined && !(input.requiredTree.treeKind === 'book' && input.requiredTree.scopeId === input.bookId)) {
      const required = this.planning.confirmedTree(
        input.ownerId,
        input.bookId,
        input.requiredTree.treeKind,
        input.requiredTree.scopeId
      ) as unknown as ConfirmedTreeRow | undefined;
      if (required === undefined) throw gate('请先确认当前步骤的上一级规划。');
      candidates.push(treeCandidate(
        required,
        required.tree_kind === 'volume' ? '已确认本卷方向' : '已确认当前单元链',
        true,
        input.taskKind === 'chain' && required.tree_kind === 'volume',
        input.taskKind === 'chain' && required.tree_kind === 'volume' ? input.taskId : undefined,
        ['outline', 'manuscript', 'review', 'settlement'].includes(input.taskKind) && required.tree_kind === 'chain'
      ));
    }

    const actuals = this.planning.confirmedTrees(input.ownerId, input.bookId)
      .flatMap((tree) => this.planning.latestNodeActuals(
        input.ownerId,
        input.bookId,
        String(tree.tree_kind) as 'book' | 'volume' | 'chain',
        String(tree.scope_id)
      ));
    if (actuals.length > 0) {
      candidates.push(candidate({
        sourceKey: 'actual:planning', sourceKind: 'planning_actual', sourceId: `planning-actual:${input.bookId}`,
        sourceVersion: sha256(stableJson(actuals.map((item) => [item.actual_id, item.revision]))), authority: 'actual',
        label: '正文已经写出的规划进展', content: actuals,
        selectionContent: planningActualContextProjection(actuals),
        contentHash: sha256(stableJson(actuals)), required: false,
        includedReason: '这是正文结算后的实际进展，后续规划不得覆盖。'
      }));
    }

    const recentSettlements = this.creation.recentChapterSettlements(input.ownerId, input.bookId, 8);
    if (recentSettlements.length > 0) {
      const latestFirst = recentSettlements.map((row) => ({
        chapterNumber: row.chapter_number,
        settlementId: row.settlement_id,
        settlementHash: row.settlement_hash,
        content: jsonObject(row.settlement_json, `第${row.chapter_number}章正式结算`)
      }));
      const chronological = latestFirst.toReversed();
      const recentIds = new Set(latestFirst.slice(0, 2).map((item) => item.settlementId));
      const history = chronological.map((item) => ({
        chapterNumber: item.chapterNumber,
        settlementId: item.settlementId,
        settlementHash: item.settlementHash,
        publicSummary: typeof item.content.publicSummary === 'string' ? item.content.publicSummary : '本章已经完成正式结算。',
        ...(recentIds.has(item.settlementId) ? { detail: item.content } : {})
      }));
      const content = {
        schema: 'v7-recent-chapter-actuals-v1',
        note: '较早章节只保留结算员写出的公开摘要；最近两章保留完整实际变化。计划内容不在这里。',
        chapters: history
      };
      const sourceVersion = latestFirst[0]!.settlementHash;
      const contentHash = sha256(stableJson(content));
      const projectedHistory = input.taskKind === 'outline'
        ? history.slice(-1)
        : input.taskKind === 'chain'
          ? history.slice(-3)
          : history;
      candidates.push(candidate({
        sourceKey: 'actual:recent-chapter-settlements', sourceKind: 'chapter_settlement',
        sourceId: latestFirst[0]!.settlementId, sourceVersion, authority: 'actual',
        label: '最近正文的正式结算', content,
        selectionContent: {
          schema: 'v7-recent-chapter-actual-index-v1',
          // 新链只需承接上一链末端，不重复搬运整条已完成链。最近三章足以
          // 保留现场、人物和未决问题；完整八章结算仍在正式记录中可追溯。
          chapters: projectedHistory.map((item, index) => ({
            chapterNumber: item.chapterNumber,
            publicSummary: item.publicSummary,
            // 下一章只需要最近一章的精确变化索引；完整证据引用和多个分类副本
            // 仍保留在正式结算中，不在每次写作/审校时重复塞给模型。
            ...(index === projectedHistory.length - 1 && 'detail' in item
              ? { detail: chapterSettlementContextProjection(item.detail) }
              : {})
          }))
        },
        contentHash,
        required: ['manuscript', 'review'].includes(input.taskKind),
        includedReason: '这是结算编辑从定稿正文提取并绑定正文哈希的实际变化，下一章必须承接。'
      }));
    }

    const characterBook = this.characters.book(input.ownerId, input.bookId);
    const characters = this.characters.listProfiles(input.ownerId, input.bookId, false).map((profile) => {
      const active = this.characters.activeProfileVersion(input.ownerId, input.bookId, profile.profile_id);
      return {
        profileId: profile.profile_id,
        entityId: profile.entity_id,
        displayName: profile.display_name,
        narrativeTier: profile.narrative_tier,
        stableProfile: active === undefined ? null : jsonObject(active.content_json, `人物“${profile.display_name}”`),
        currentState: this.characters.currentState(input.ownerId, input.bookId, profile.entity_id, characterBook?.canon_revision ?? 0),
        relationships: this.characters.relationships(input.ownerId, input.bookId, profile.entity_id, characterBook?.canon_revision ?? 0),
        knowledge: this.characters.knowledge(input.ownerId, input.bookId, profile.entity_id)
      };
    });
    if (characters.length > 0) {
      candidates.push(candidate({
        sourceKey: 'actual:characters', sourceKind: 'character', sourceId: `characters:${input.bookId}`,
        sourceVersion: sha256(stableJson(characters.map((item) => [item.profileId, item.currentState]))), authority: 'actual',
        label: '当前人物资料', content: characters,
        selectionContent: characterContextProjection(characters),
        contentHash: sha256(stableJson(characters)), required: false,
        includedReason: '用于核对人物身份、当前状态、关系和知情边界。'
      }));
    }

    const storyState = this.creation.storyState(input.ownerId, input.bookId).map((item) => ({
      kind: item.item_kind,
      stableKey: item.stable_key,
      title: item.title,
      state: item.state,
      revision: item.revision,
      content: parseMaybeJson(item.content_json),
      evidenceRefs: parseMaybeJson(item.evidence_refs_json),
      sourceSettlementId: item.source_settlement_id,
      updatedAt: item.created_at
    }));
    if (storyState.length > 0) {
      candidates.push(candidate({
        sourceKey: 'actual:story-state', sourceKind: 'story_state', sourceId: `story-state:${input.bookId}`,
        sourceVersion: sha256(stableJson(storyState.map((item) => [item.stableKey, item.revision, item.sourceSettlementId]))), authority: 'actual',
        label: '当前故事线、伏笔和开放问题', content: storyState,
        selectionContent: storyStateContextProjection(storyState),
        contentHash: sha256(stableJson(storyState)), required: false,
        includedReason: '用于承接已经形成的线路、伏笔和未解决问题。'
      }));
    }

    const authorInput = optionalText(input.authorInput, 2_000);
    if (authorInput !== null) {
      const contentHash = sha256(authorInput);
      candidates.push(candidate({
        sourceKey: 'goal:author-input', sourceKind: 'author_input', sourceId: `author-input:${contentHash.slice(0, 24)}`,
        sourceVersion: contentHash, authority: 'goal', label: '作者本次补充想法', content: { text: authorInput },
        contentHash, required: true, includedReason: '这是作者本次明确交给当前任务的方向，必须保留，但不会直接写成正史。'
      }));
    }

    const decisionKinds = input.taskKind === 'volume'
      ? []
      : input.taskKind === 'chain'
        ? ['volume_option'] as const
        : ['volume_option', 'chain_option'] as const;
    for (const decisionKind of decisionKinds) {
      const decision = this.creation.decision(input.ownerId, input.bookId, input.workflowId, decisionKind);
      const note = optionalText(decision?.author_note, 2_000);
      if (decision === undefined || note === null) continue;
      const contentHash = sha256(note);
      candidates.push(candidate({
        sourceKey: `goal:${decisionKind}-note`, sourceKind: 'author_input', sourceId: decision.decision_id,
        sourceVersion: contentHash, authority: 'goal',
        label: decisionKind === 'volume_option' ? '作者选定本卷时的补充意见' : '作者选定本链时的补充意见',
        content: { text: note }, contentHash, required: true,
        includedReason: '这是作者选定上一级方案时明确交给下一层的补充方向。'
      }));
    }

    const route = this.planning.activeRoute(input.ownerId, input.bookId, 'confirmed');
    const recipe = this.planning.activeRecipe(input.ownerId, input.bookId, 'confirmed');
    if (route !== undefined) candidates.push(candidate({
      sourceKey: 'reference:route', sourceKind: 'method', sourceId: route.route_version_id,
      sourceVersion: String(route.revision), authority: 'reference', label: '作者已确认的全书路线',
      content: jsonObject(route.route_json, '全书路线'), contentHash: route.route_hash, required: false,
      includedReason: '它提供全书长期方向，但不能覆盖正文实际。'
    }));
    if (recipe !== undefined) candidates.push(candidate({
      sourceKey: 'reference:recipe', sourceKind: 'method', sourceId: recipe.recipe_version_id,
      sourceVersion: String(recipe.revision), authority: 'reference', label: '已确认的方法配方',
      content: jsonObject(recipe.recipe_json, '方法配方'), contentHash: recipe.recipe_hash, required: false,
      includedReason: '只提供当前层需要的创作方法，不发送整座方法库。'
    }));

    for (const source of input.extraSources ?? []) candidates.push(candidate(source));
    const unique = new Map<string, V7CreationSourceCandidate>();
    for (const item of candidates) {
      if (unique.has(item.sourceKey)) throw new Error(`资料标识重复：${item.sourceKey}`);
      unique.set(item.sourceKey, item);
    }
    return [...unique.values()];
  }

  private now(): string { return this.clock.now().toISOString(); }
}

function compilePack(
  input: V7CreationContextCompileInput,
  candidates: readonly V7CreationSourceCandidate[],
  selection: V7CreationContextSelection,
  useCompactIndexes = false
): V7CreationContextPack {
  const selectedCandidates = candidates.filter((item) => selection.selectedSourceKeys.includes(item.sourceKey));
  let compactIndexesUsed = useCompactIndexes;
  let selected = selectedCandidates
    .map((source) => compactIndexesUsed ? compactPackSource(source) : exactSource(source));
  const reasons = new Map(selection.selectionReasons.map((item) => [item.sourceKey, item.reason]));
  const excluded = candidates.filter((item) => !selection.selectedSourceKeys.includes(item.sourceKey)).map((item) => ({
    sourceKey: item.sourceKey,
    reason: reasons.get(item.sourceKey) ?? '本次任务不需要这项资料。'
  }));
  const budgetChars = V7_CREATION_CONTEXT_CHAR_BUDGETS[input.taskKind];
  const methodPlan = compileMethodPlan(selection);
  let characterCount = packedCharacterCount(input, selected, selection, methodPlan);
  // A context editor chooses semantic sources from compact indexes.  Some
  // exact upstream documents (especially the book-wide setting ledger and a
  // confirmed chain tree) legitimately exceed a chapter workstation's whole
  // attention budget even after irrelevant sources were removed.  Keep the
  // exact source and hash in the trace/audit store, but send its upstream
  // Agent-authored projection to the next workstation when the exact payload
  // is too large.  This is an explicit transport projection, never a new
  // canon version and never a programmatic semantic summary.
  if (characterCount > budgetChars && !compactIndexesUsed) {
    compactIndexesUsed = true;
    selected = selectedCandidates.map(compactPackSource);
    characterCount = packedCharacterCount(input, selected, selection, methodPlan);
  }
  if (characterCount > budgetChars) {
    throw new DomainError(
      errorCodes.validation,
      `对不起，当前资料仍有${characterCount}字，超过本步骤${budgetChars}字的安全范围。请减少原文回查项，或先让主编重建设定事实账本。`,
      { characterCount, budgetChars, taskKind: input.taskKind },
      true,
      409
    );
  }
  const content: V7CreationContextPack = {
    schema: V7_CREATION_CONTEXT_SCHEMA,
    taskKind: input.taskKind,
    taskId: input.taskId,
    taskBrief: taskBrief(input.taskBrief),
    firstVolume: input.firstVolume,
    selectedSources: selected,
    excludedSources: excluded,
    openQuestions: selection.openQuestions,
    taskPersona: selection.taskPersona,
    taskResponsibilities: selection.taskResponsibilities,
    creativeSpace: selection.creativeSpace,
    methodPlan,
    sourceRefs: selectedCandidates.flatMap(sourceRef),
    contextPolicyVersion: compactIndexesUsed ? 'layered-context-v3' : 'layered-context-v2',
    characterCount,
    budgetChars,
    estimatedTokens: estimateV7Tokens(stableJson(creationPromptContext({
      schema: V7_CREATION_CONTEXT_SCHEMA,
      taskKind: input.taskKind,
      taskId: input.taskId,
      taskBrief: taskBrief(input.taskBrief),
      firstVolume: input.firstVolume,
      selectedSources: selected,
      excludedSources: excluded,
      openQuestions: selection.openQuestions,
      taskPersona: selection.taskPersona,
      taskResponsibilities: selection.taskResponsibilities,
      creativeSpace: selection.creativeSpace,
      methodPlan,
      sourceRefs: [],
      contextPolicyVersion: compactIndexesUsed ? 'layered-context-v3' : 'layered-context-v2',
      characterCount,
      budgetChars,
      estimatedTokens: 0
    })))
  };
  return content;
}

function packedCharacterCount(
  input: V7CreationContextCompileInput,
  selectedSources: readonly V7CreationSourceCandidate[],
  selection: V7CreationContextSelection,
  methodPlan: V7CreationMethodPlan
): number {
  return Array.from(stableJson(creationPromptContext({
    schema: V7_CREATION_CONTEXT_SCHEMA,
    taskKind: input.taskKind,
    taskId: input.taskId,
    taskBrief: taskBrief(input.taskBrief),
    firstVolume: input.firstVolume,
    selectedSources,
    excludedSources: [],
    openQuestions: selection.openQuestions,
    taskPersona: selection.taskPersona,
    taskResponsibilities: selection.taskResponsibilities,
    creativeSpace: selection.creativeSpace,
    methodPlan,
    sourceRefs: [],
    contextPolicyVersion: 'layered-context-v3',
    characterCount: 0,
    budgetChars: V7_CREATION_CONTEXT_CHAR_BUDGETS[input.taskKind],
    estimatedTokens: 0
  }))).length;
}

function compileMethodPlan(selection: V7CreationContextSelection): V7CreationMethodPlan {
  const request = selection.methodStrategy.searchRequest;
  const retrieval = request === null ? null : retrievePlanningMethodCandidates(request);
  return {
    ...selection.methodStrategy,
    candidates: (retrieval?.candidates ?? []).map((candidate) => ({
      methodKey: candidate.methodKey,
      publicExplanation: candidate.publicExplanation,
      dimension: candidate.dimension,
      kind: candidate.kind,
      planningLayers: candidate.planningLayers,
      responsibilities: candidate.responsibilities.slice(0, 3),
      combinationGuidance: candidate.combinationGuidance,
      caution: candidate.cautionSignals.slice(0, 2)
    })),
    retrievalVersion: retrieval?.retrievalVersion ?? null,
    policy: {
      candidateOnly: true,
      executorMayCombine: true,
      executorMayIgnore: true,
      originalDesignAllowed: true
    }
  };
}

function estimateV7Tokens(value: string): number {
  let tokens = 0;
  for (const character of value) tokens += /[\u3400-\u9fff]/u.test(character) ? 1 : 0.25;
  return Math.max(1, Math.ceil(tokens));
}

function compactPackSource(source: V7CreationSourceCandidate): V7CreationSourceCandidate {
  if (source.selectionContent === undefined) return exactSource(source);
  const { selectionContent, ...rest } = source;
  return {
    ...rest,
    label: `${source.label}（轻量索引）`,
    content: selectionContent,
    includedReason: `${source.includedReason} 当前工位只读取上游成员整理的语义索引，原始版本仍保留并可追溯。`
  };
}

function exactSource(source: V7CreationSourceCandidate): V7CreationSourceCandidate {
  const { selectionContent: ignoredSelectionContent, ...exact } = source;
  void ignoredSelectionContent;
  return exact;
}

function sourceRef(source: V7CreationSourceCandidate): V7CreationContextPack['sourceRefs'] {
  if (source.sourceKind === 'opening') return [{ sourceKind: 'opening', sourceId: source.sourceId, version: source.sourceVersion }];
  if (source.sourceKey === 'formal:setting-ledger') {
    const entries = source.content !== null && typeof source.content === 'object' && !Array.isArray(source.content)
      ? (source.content as { factLedger?: unknown }).factLedger
      : undefined;
    if (!Array.isArray(entries)) return [];
    return entries.flatMap((entry) => {
      if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) return [];
      const value = entry as { versionId?: unknown; revision?: unknown };
      return typeof value.versionId === 'string' && Number.isInteger(value.revision)
        ? [{ sourceKind: 'setting' as const, sourceId: value.versionId, version: String(value.revision) }]
        : [];
    });
  }
  if (source.sourceKind === 'setting') return [{ sourceKind: 'setting', sourceId: source.sourceId, version: source.sourceVersion }];
  if (source.sourceKind === 'author_input') return [{ sourceKind: 'author_goal', sourceId: source.sourceId, version: source.sourceVersion }];
  if (source.sourceKind === 'planning_tree' && source.sourceKey.startsWith('formal:tree:')) {
    return [{ sourceKind: 'confirmed_tree', sourceId: source.sourceId, version: source.sourceVersion }];
  }
  if (source.sourceKind === 'planning_actual') return [{ sourceKind: 'settlement', sourceId: source.sourceId, version: source.sourceVersion }];
  if (source.sourceKind === 'chapter_settlement') return [{ sourceKind: 'settlement', sourceId: source.sourceId, version: source.sourceVersion }];
  return [];
}

function activeView(row: V7CreationContextPackRow): V7CompiledCreationContext {
  if (row.selection_json === null || row.content_json === null) throw new Error('活动资料包内容不完整');
  const selection = JSON.parse(row.selection_json) as V7CreationContextSelection;
  return {
    contextPackId: row.context_pack_id,
    sourceFingerprint: row.source_fingerprint,
    selection,
    content: JSON.parse(row.content_json) as V7CreationContextPack,
    sourceTraces: historicalContextSourceTraces(row, selection)
  };
}

function historicalContextSourceTraces(
  row: V7CreationContextPackRow,
  selection: V7CreationContextSelection
): V7ContextSourceTrace[] {
  try {
    const parsed = JSON.parse(row.candidate_sources_json) as unknown;
    if (!Array.isArray(parsed) || !parsed.every(isTraceableCandidate)) return [];
    return contextSourceTraces(row.owner_id, row.book_id, parsed, selection);
  } catch {
    // Older active tasks may only have the aggregate compiled payload.  An
    // explicit empty trace list tells the runtime compiler to preserve that
    // payload as one compatibility snapshot instead of inventing source rows.
    return [];
  }
}

function contextSourceTraces(
  ownerId: string,
  bookId: string,
  candidates: readonly V7CreationSourceCandidate[],
  selection: V7CreationContextSelection
): V7ContextSourceTrace[] {
  if (!Array.isArray(selection.selectedSourceKeys) || !Array.isArray(selection.excludedSourceKeys)
    || !Array.isArray(selection.selectionReasons)) return [];
  const selected = new Set(selection.selectedSourceKeys);
  const explicitlyExcluded = new Set(selection.excludedSourceKeys);
  const reasons = new Map(selection.selectionReasons.map((item) => [item.sourceKey, item.reason]));
  const directSameCall = selection.publicSummary.includes('同一次任务');
  return candidates.map((source) => {
    const included = selected.has(source.sourceKey);
    return {
      ownerId,
      bookId,
      sourceKey: source.sourceKey,
      sourceType: source.sourceKind,
      sourceId: source.sourceId,
      sourceVersion: source.sourceVersion,
      authority: traceAuthority(source.authority),
      decision: included ? 'included' : 'excluded',
      reason: included
        ? reasons.get(source.sourceKey) ?? source.includedReason
        : explicitlyExcluded.has(source.sourceKey)
          ? directSameCall
            ? '轻量编排未发送该条原文：正式设定事实账本已提供其语义事实，需要时仍可追溯原版本。'
            : '资料策划明确排除：本次任务不需要这项资料。'
          : directSameCall
            ? '轻量编排没有发送该来源。'
            : '资料策划没有将此来源选入本次最小资料包。',
      contentHash: source.contentHash,
      estimatedTokens: Math.max(1, Math.ceil(Array.from(stableJson(source.content)).length / 2.5))
    } satisfies V7ContextSourceTrace;
  });
}

function traceAuthority(authority: V7CreationSourceCandidate['authority']): V7ContextSourceTrace['authority'] {
  if (authority === 'formal') return 'confirmed';
  if (authority === 'actual') return 'derived';
  if (authority === 'goal') return 'author_source';
  return 'reference';
}

function contextWorkstation(taskKind: V7CreationContextPack['taskKind']): 'volume' | 'chain' {
  // planning_context is published only for the volume/chain planning
  // workstations.  All chapter-level context continues the current chain; the
  // mapping comes from the structured task kind, never from a node name.
  return taskKind === 'volume' ? 'volume' : 'chain';
}

function isTraceableCandidate(value: unknown): value is V7CreationSourceCandidate {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const item = value as Partial<V7CreationSourceCandidate>;
  return typeof item.sourceKey === 'string' && typeof item.sourceKind === 'string'
    && typeof item.sourceId === 'string' && typeof item.sourceVersion === 'string'
    && typeof item.authority === 'string' && typeof item.label === 'string'
    && typeof item.contentHash === 'string' && typeof item.required === 'boolean'
    && typeof item.includedReason === 'string';
}

function treeCandidate(
  row: ConfirmedTreeRow,
  label: string,
  required: boolean,
  compact = false,
  focusChildScopeId?: string,
  chapterProjection = false
): V7CreationSourceCandidate {
  const document = jsonObject(row.content_json, label);
  return candidate({
    sourceKey: `formal:tree:${row.tree_kind}:${row.scope_id}`,
    sourceKind: 'planning_tree', sourceId: row.tree_version_id, sourceVersion: String(row.revision), authority: 'formal',
    label,
    content: chapterProjection
      ? chapterTreeProjection(document)
      : compact
        ? projectPlanningTreeForChild(document as unknown as PlanningTreeDocument, focusChildScopeId)
        : document,
    contentHash: row.content_hash, required,
    includedReason: '当前任务必须承接这份作者确认的规划。'
  });
}

function openingContextProjection(content: Record<string, unknown>): Record<string, unknown> {
  return {
    schema: 'v7-opening-context-projection-v1',
    title: content.title,
    openingIdea: content.openingIdea,
    protagonists: content.protagonists,
    storyDirection: content.storyDirection,
    worldBackground: content.worldBackground,
    styleIntent: content.styleIntent,
    mainTags: content.mainTags,
    auxiliaryTags: content.auxiliaryTags,
    mustFollow: content.mustFollow
  };
}

function settingLedgerContextProjection(
  content: Record<string, unknown>,
  taskKind: V7CreationContextPack['taskKind']
): Record<string, unknown> {
  const groups = Array.isArray(content.groups)
    ? content.groups.flatMap((value) => {
        if (typeof value !== 'object' || value === null || Array.isArray(value)) return [];
        const group = value as Record<string, unknown>;
        return [{ groupTitle: group.groupTitle, summary: group.summary }];
      })
    : [];
  const items = groups.length === 0 && Array.isArray(content.itemIndex)
    ? content.itemIndex.flatMap((value) => {
        if (typeof value !== 'object' || value === null || Array.isArray(value)) return [];
        const item = value as Record<string, unknown>;
        return [{ itemKey: item.itemKey, label: item.label, summary: item.summary }];
      })
    : [];
  const common = {
    schema: 'v7-setting-ledger-context-projection-v1',
    summary: content.summary,
    unifiedDecisions: content.unifiedDecisions,
    unresolvedConflicts: content.unresolvedConflicts
  };
  // 章纲只能展开已经确认的当前链，不能在此重新理解整本设定。链方案
  // 已经读取过分组边界；章纲工位只保留主编签发的整书摘要和统一决定，
  // 避免同一份设定以摘要、分组和最近结算三种形态重复争夺注意力。
  return taskKind === 'outline' ? common : { ...common, groups, items };
}

function chapterSettlementContextProjection(value: unknown): Record<string, unknown> {
  const content = typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
  const summaries = (field: string): string[] => Array.isArray(content[field])
    ? (content[field] as unknown[]).flatMap((entry) => {
      if (typeof entry === 'string') return entry.trim().length > 0 ? [entry] : [];
      if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) return [];
      const summary = (entry as Record<string, unknown>).summary;
      return typeof summary === 'string' && summary.trim().length > 0 ? [summary] : [];
    })
    : [];
  const stateItems = (field: string, titleField: 'title' | 'question'): Array<Record<string, unknown>> => Array.isArray(content[field])
    ? (content[field] as unknown[]).flatMap((entry) => {
      if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) return [];
      const item = entry as Record<string, unknown>;
      return [{
        stableKey: item.stableKey,
        [titleField]: item[titleField],
        state: item.state,
        summary: item.summary,
        answer: titleField === 'question' ? item.answer : undefined
      }];
    })
    : [];
  return {
    schema: 'v7-chapter-settlement-context-projection-v1',
    publicSummary: content.publicSummary,
    irreversibleResults: summaries('irreversibleResults'),
    entityStates: summaries('entityStates'),
    relationshipChanges: summaries('relationshipChanges'),
    knowledgeChanges: summaries('knowledgeChanges'),
    resourceChanges: summaries('resourceChanges'),
    ruleChanges: summaries('ruleChanges'),
    storyLines: stateItems('storyLines', 'title'),
    foreshadowing: stateItems('foreshadowing', 'title'),
    openQuestions: stateItems('openQuestions', 'question')
  };
}

function planningActualContextProjection(actuals: readonly Record<string, unknown>[]): Record<string, unknown> {
  return {
    schema: 'v7-planning-actual-context-projection-v1',
    actuals: actuals.map((item) => ({
      treeKind: item.tree_kind,
      scopeId: item.scope_id,
      nodeKey: item.node_key,
      revision: item.revision,
      state: item.state,
      summary: item.summary,
      emotionResult: item.emotion_result,
      experienceResult: item.experience_result,
      outcome: item.outcome
    }))
  };
}

function characterContextProjection(characters: readonly Record<string, unknown>[]): Record<string, unknown> {
  return {
    schema: 'v7-character-context-projection-v1',
    characters: characters.map((item) => ({
      entityId: item.entityId,
      displayName: item.displayName,
      narrativeTier: item.narrativeTier,
      stableProfile: item.stableProfile,
      currentState: item.currentState,
      relationships: item.relationships,
      knowledge: item.knowledge
    }))
  };
}

function storyStateContextProjection(items: readonly Record<string, unknown>[]): Record<string, unknown> {
  const terminalStates = new Set(['answered', 'closed', 'resolved', 'cancelled', 'archived']);
  return {
    schema: 'v7-story-state-context-projection-v1',
    // The full ledger, revisions and evidence remain in the audited source.
    // A workstation only needs active semantic state. Sending already-closed
    // questions and revision counters on every chapter diluted attention and
    // made the pack grow forever even though no live story obligation changed.
    items: items.filter((item) => !terminalStates.has(String(item.state ?? '').toLowerCase())).map((item) => {
      const content = typeof item.content === 'object' && item.content !== null && !Array.isArray(item.content)
        ? item.content as Record<string, unknown>
        : {};
      return {
        kind: item.kind,
        stableKey: item.stableKey,
        title: item.title,
        state: item.state,
        summary: content.summary ?? content.question ?? content.answer ?? item.title
      };
    })
  };
}

function chapterTreeProjection(document: Record<string, unknown>): Record<string, unknown> {
  const projectNode = (value: unknown): unknown => {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return value;
    const node = value as Record<string, unknown>;
    const record = (field: string): Record<string, unknown> => {
      const source = node[field];
      return typeof source === 'object' && source !== null && !Array.isArray(source)
        ? source as Record<string, unknown>
        : {};
    };
    const story = record('story');
    const emotion = record('emotion');
    const experience = record('experience');
    const causality = record('causality');
    const threads = record('threads');
    const isRoot = node.kind === 'chain';
    return {
      key: node.key,
      sequence: node.sequence,
      title: node.title,
      story: {
        summary: story.summary,
        protagonistChange: story.protagonistChange,
        outcome: story.outcome,
        nextStep: isRoot ? story.nextStep : undefined
      },
      emotion: isRoot ? undefined : {
        pressureMovement: emotion.pressureMovement,
        releaseEmotion: emotion.releaseEmotion
      },
      experience: isRoot ? { payoffCadence: experience.payoffCadence } : undefined,
      causality: {
        trigger: isRoot ? undefined : causality.trigger,
        coreConflict: causality.coreConflict,
        turningPoint: isRoot ? undefined : causality.turningPoint
      },
      threads: {
        foreshadowing: threads.foreshadowing,
        openQuestions: threads.openQuestions
      },
      budget: node.budget,
      children: Array.isArray(node.children) ? node.children.map(projectNode) : []
    };
  };
  return {
    schema: 'v7-chain-chapter-context-projection-v1',
    treeKind: document.treeKind,
    scopeId: document.scopeId,
    title: document.title,
    root: projectNode(document.root)
  };
}

function candidate(value: V7CreationSourceCandidate): V7CreationSourceCandidate {
  if (!/^[A-Za-z0-9][A-Za-z0-9:_.-]{0,180}$/u.test(value.sourceKey)) throw new Error('资料标识无效');
  if (value.label.trim().length === 0 || value.sourceId.trim().length === 0 || value.sourceVersion.trim().length === 0) {
    throw new Error('资料来源信息不完整');
  }
  return structuredClone(value);
}

function gate(message: string): DomainError {
  return new DomainError(errorCodes.validation, message, {}, false, 409);
}

function taskBrief(value: string): string {
  const text = value.trim();
  if (text.length === 0 || Array.from(text).length > 1_000) throw new DomainError(errorCodes.validation, '当前任务说明不完整。');
  return text;
}

function optionalText(value: string | null | undefined, maximum: number): string | null {
  const text = value?.trim() ?? '';
  if (text.length === 0) return null;
  if (Array.from(text).length > maximum) throw new DomainError(errorCodes.validation, `补充想法最多${maximum}字。`);
  return text;
}

function jsonObject(value: string, label: string): Record<string, unknown> {
  const parsed = JSON.parse(value) as unknown;
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) throw gate(`${label}内容不完整。`);
  return parsed as Record<string, unknown>;
}

function parseMaybeJson(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  try { return JSON.parse(value) as unknown; } catch { return value; }
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (typeof value === 'object' && value !== null) {
    return `{${Object.entries(value as Record<string, unknown>).sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function sha256(value: string): string { return createHash('sha256').update(value).digest('hex'); }

function publicFailure(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.length > 240 ? `${message.slice(0, 237)}…` : message;
}
