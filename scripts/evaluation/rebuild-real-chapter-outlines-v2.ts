import { readFileSync } from 'node:fs';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { ArtifactService } from '../../apps/api/src/application/artifacts/artifact-service.js';
import { BudgetService } from '../../apps/api/src/application/budget/budget-service.js';
import { ModelCallService } from '../../apps/api/src/application/calls/model-call-service.js';
import { compileChapterOutlineForWriter } from '../../apps/api/src/application/creation/chapter-outline-compiler.js';
import { ContextPackService } from '../../apps/api/src/application/memory/context-pack-service.js';
import { NarrativeProjectionService } from '../../apps/api/src/application/projections/narrative-projection-service.js';
import { TaskService } from '../../apps/api/src/application/tasks/task-service.js';
import type { CreativeRoleKey } from '../../apps/api/src/contracts/agent-team-v2.js';
import {
  parseChapterOutlineV2,
  parseStageMasterOutlineV2,
  type ChapterOutlineV2,
  type StageMasterOutlineStage
} from '../../apps/api/src/domain/artifact-schemas.js';
import { SystemClock, UuidGenerator } from '../../apps/api/src/domain/ids.js';
import { openDatabase } from '../../apps/api/src/infrastructure/db/database.js';
import { ModelAdapterFactory } from '../../apps/api/src/infrastructure/models/model-adapter-factory.js';
import { loadRuntimeConfig } from '../../apps/api/src/infrastructure/runtime-config.js';

interface BookRow {
  owner_id: string;
  book_id: string;
  title: string;
  canon_revision: number;
  positioning_version: number;
}

interface AgentRow {
  agent_id: string;
  display_name: string;
  role_key: CreativeRoleKey;
  model_snapshot_id: string;
  provider: string;
  model_id: string;
}

interface ArtifactRow {
  artifact_id: string;
  artifact_version_id: string;
  version: number;
  title: string;
  content_json: string;
}

interface ChapterRow {
  chapter_id: string;
  chapter_number: number;
  title: string;
  manuscript_version_id: string;
  relative_path: string;
}

interface ChapterMaterial {
  artifactId: string;
  parentVersionId: string;
  chapterId: string;
  chapterNumber: number;
  title: string;
  sourceStage: StageMasterOutlineStage;
  legacyOutline: Record<string, unknown>;
  manuscriptVersionId: string;
  manuscript: string;
}

interface RebuiltOutline {
  material: ChapterMaterial;
  outline: ChapterOutlineV2;
  modelCallId: string;
  agent: AgentRow;
}

const config = loadRuntimeConfig(process.env);
if (process.env.WENMI_CONFIRM_REAL_OUTLINE_REBUILD?.trim().toUpperCase() !== 'YES') {
  throw new Error('这是可逆的正式资料升级。请设置 WENMI_CONFIRM_REAL_OUTLINE_REBUILD=YES 后执行。');
}
if (config.modelRuntime.activeMode !== 'subscription-plan'
  || config.modelRuntime.strictPlanOnly !== true
  || config.modelRuntime.cashFallbackAllowed !== false) {
  throw new Error('章纲升级只允许在严格套餐模式执行，禁止现金回退。');
}

const requestedBookId = process.argv[2]?.trim();
const targetCount = Number(process.argv[3] ?? '10');
if (!Number.isInteger(targetCount) || targetCount < 1 || targetCount > 50) {
  throw new Error('目标章数必须是1至50之间的整数。');
}

const database = openDatabase(config.databasePath);
const ids = new UuidGenerator();
const clock = new SystemClock();
const rebuildRunId = ids.next();
try {
  const book = requireBook(database, requestedBookId);
  const scope = { ownerId: book.owner_id, bookId: book.book_id };
  const agents = requireAgents(database, scope.ownerId, scope.bookId);
  const master = requireMasterOutline(database, scope.ownerId, scope.bookId);
  const masterOutline = parseStageMasterOutlineV2(JSON.parse(master.content_json) as Record<string, unknown>);
  const materials = loadMaterials(database, config.dataDir, book, masterOutline.majorStages, targetCount);
  const legacyMaterials = materials.filter((material) => material.legacyOutline.outlineSchema !== 'chapter_outline_v2');
  if (legacyMaterials.length === 0) {
    process.stdout.write(`${JSON.stringify({
      bookId: book.book_id,
      title: book.title,
      changed: 0,
      message: '目标章节已全部使用章纲V2，无需重复升级。'
    })}\n`);
    process.exitCode = 0;
  } else {
    const adapterFactory = new ModelAdapterFactory(config.modelRuntime);
    const rebuilt: RebuiltOutline[] = [];
    const batches = chunk(legacyMaterials, 2);
    for (const [index, batch] of batches.entries()) {
      const roleKey: CreativeRoleKey = index % 2 === 0 ? 'lead_screenwriter' : 'second_screenwriter';
      const agent = agents.get(roleKey);
      if (agent === undefined) throw new Error(`当前书缺少可用的${roleKey}成员`);
      process.stdout.write(`${JSON.stringify({
        event: 'outline_batch_started',
        batch: index + 1,
        chapters: batch.map((item) => item.chapterNumber),
        agent: agent.display_name,
        provider: agent.provider,
        modelId: agent.model_id
      })}\n`);
      rebuilt.push(...await rebuildBatch(database, book, master, batch, agent, adapterFactory));
    }

    database.exec('BEGIN IMMEDIATE');
    try {
      const artifacts = new ArtifactService(database, ids, clock);
      for (const item of rebuilt.sort((left, right) => left.material.chapterNumber - right.material.chapterNumber)) {
        const content: Record<string, unknown> = {
          ...item.outline,
          provenance: {
            kind: 'retrospective_outline_reconstruction',
            sourceMasterOutlineVersionId: master.artifact_version_id,
            sourceManuscriptVersionId: item.material.manuscriptVersionId,
            sourceLegacyOutlineVersionId: item.material.parentVersionId,
            sourceAgentId: item.agent.agent_id,
            sourceModelSnapshotId: item.agent.model_snapshot_id,
            sourceModelCallId: item.modelCallId,
            reconstructedAt: clock.now().toISOString()
          }
        };
        const version = artifacts.addVersion(
          scope,
          item.material.artifactId,
          content,
          item.material.parentVersionId
        );
        artifacts.select(scope, item.material.artifactId, version.artifactVersionId);
        process.stdout.write(`${JSON.stringify({
          event: 'outline_selected',
          chapterNumber: item.material.chapterNumber,
          artifactId: item.material.artifactId,
          artifactVersionId: version.artifactVersionId,
          version: version.version,
          sourceModelCallId: item.modelCallId
        })}\n`);
      }
      database.exec('COMMIT');
    } catch (error) {
      if (database.isTransaction) database.exec('ROLLBACK');
      throw error;
    }

    const narrative = new NarrativeProjectionService(database, ids, clock).rebuild(scope);
    const selected = database.prepare(`
      SELECT
        COUNT(*) AS total,
        SUM(CASE WHEN json_extract(v.content_json, '$.outlineSchema') = 'chapter_outline_v2' THEN 1 ELSE 0 END) AS v2_count
      FROM artifacts a
      JOIN artifact_versions v ON v.artifact_version_id = a.active_version_id
      WHERE a.owner_id = ? AND a.book_id = ? AND a.artifact_type = 'chapter_outline'
        AND CAST(json_extract(v.content_json, '$.chapterNumber') AS INTEGER) BETWEEN 1 AND ?
    `).get(scope.ownerId, scope.bookId, targetCount) as { total: number; v2_count: number };
    if (Number(selected.total) !== targetCount || Number(selected.v2_count) !== targetCount) {
      throw new Error(`升级后前${targetCount}章的V2章纲数量不完整`);
    }
    process.stdout.write(`${JSON.stringify({
      event: 'outline_rebuild_completed',
      releaseId: config.releaseId,
      bookId: book.book_id,
      title: book.title,
      canonRevision: book.canon_revision,
      targetCount,
      changed: rebuilt.length,
      selectedV2: Number(selected.v2_count),
      narrativeProjection: narrative,
      cashFallbackAllowed: config.modelRuntime.cashFallbackAllowed
    })}\n`);
  }
} finally {
  database.close();
}

function requireBook(database: DatabaseSync, requestedBookId: string | undefined): BookRow {
  const row = requestedBookId === undefined
    ? database.prepare(`
        SELECT owner_id, book_id, title, canon_revision, positioning_version
        FROM books
        WHERE status = 'active'
        ORDER BY updated_at DESC
        LIMIT 1
      `).get() as BookRow | undefined
    : database.prepare(`
        SELECT owner_id, book_id, title, canon_revision, positioning_version
        FROM books
        WHERE book_id = ? AND status = 'active'
      `).get(requestedBookId) as BookRow | undefined;
  if (row === undefined) throw new Error('没有找到可升级的活动书籍');
  return row;
}

function requireAgents(database: DatabaseSync, ownerId: string, bookId: string): Map<CreativeRoleKey, AgentRow> {
  const rows = database.prepare(`
    SELECT a.agent_id, a.display_name, r.role_key, a.model_snapshot_id, m.provider, m.model_id
    FROM agent_instances a
    JOIN role_templates r
      ON r.role_template_id = a.role_template_id
     AND r.version = a.role_template_version
    JOIN model_config_snapshots m ON m.model_snapshot_id = a.model_snapshot_id
    WHERE a.owner_id = ? AND a.book_id = ? AND a.enabled = 1
      AND r.role_key IN ('lead_screenwriter', 'second_screenwriter')
  `).all(ownerId, bookId) as unknown as AgentRow[];
  const agents = new Map<CreativeRoleKey, AgentRow>();
  for (const row of rows) agents.set(row.role_key, row);
  if (!agents.has('lead_screenwriter') || !agents.has('second_screenwriter')) {
    throw new Error('当前书必须同时具备DeepSeek主编剧与GLM第二编剧');
  }
  if (agents.get('lead_screenwriter')?.model_id === agents.get('second_screenwriter')?.model_id) {
    throw new Error('两名编剧必须使用不同模型，不能伪造异模型协作');
  }
  return agents;
}

function requireMasterOutline(database: DatabaseSync, ownerId: string, bookId: string): ArtifactRow {
  const row = database.prepare(`
    SELECT a.artifact_id, a.title, v.artifact_version_id, v.version, v.content_json
    FROM artifacts a
    JOIN artifact_versions v ON v.artifact_version_id = a.active_version_id
    WHERE a.owner_id = ? AND a.book_id = ? AND a.artifact_type = 'master_outline'
      AND v.status = 'selected'
    ORDER BY v.version DESC
    LIMIT 1
  `).get(ownerId, bookId) as ArtifactRow | undefined;
  if (row === undefined) throw new Error('当前书缺少已选定的剧情总纲');
  return row;
}

function loadMaterials(
  database: DatabaseSync,
  dataDir: string,
  book: BookRow,
  stages: StageMasterOutlineStage[],
  targetCount: number
): ChapterMaterial[] {
  const artifactRows = database.prepare(`
    SELECT a.artifact_id, a.title, v.artifact_version_id, v.version, v.content_json
    FROM artifacts a
    JOIN artifact_versions v ON v.artifact_version_id = a.active_version_id
    WHERE a.owner_id = ? AND a.book_id = ? AND a.artifact_type = 'chapter_outline'
      AND v.status = 'selected'
  `).all(book.owner_id, book.book_id) as unknown as ArtifactRow[];
  const artifactByChapter = new Map<number, ArtifactRow>();
  for (const artifact of artifactRows) {
    const content = JSON.parse(artifact.content_json) as Record<string, unknown>;
    const chapterNumber = Number(content.chapterNumber);
    if (Number.isInteger(chapterNumber)) artifactByChapter.set(chapterNumber, artifact);
  }
  const chapterRows = database.prepare(`
    SELECT c.chapter_id, c.chapter_number, c.title,
      mv.manuscript_version_id, f.relative_path
    FROM chapters c
    JOIN manuscript_versions mv ON mv.manuscript_version_id = c.canon_manuscript_version_id
    JOIN file_registry f ON f.file_id = mv.file_id
    WHERE c.owner_id = ? AND c.book_id = ? AND c.chapter_number BETWEEN 1 AND ?
      AND c.settlement_status = 'settled' AND mv.status = 'canon' AND f.status = 'active'
    ORDER BY c.chapter_number
  `).all(book.owner_id, book.book_id, targetCount) as unknown as ChapterRow[];
  if (chapterRows.length !== targetCount) {
    throw new Error(`需要前${targetCount}章完整的定稿正文，当前仅找到${chapterRows.length}章`);
  }
  const root = resolve(dataDir);
  return chapterRows.map((chapter) => {
    const artifact = artifactByChapter.get(chapter.chapter_number);
    if (artifact === undefined) throw new Error(`第${chapter.chapter_number}章缺少已选定章纲`);
    const stage = stages.find((candidate) =>
      chapter.chapter_number >= candidate.chapterRange.start
      && chapter.chapter_number <= candidate.chapterRange.end);
    if (stage === undefined) throw new Error(`剧情总纲没有覆盖第${chapter.chapter_number}章`);
    const absolutePath = isAbsolute(chapter.relative_path)
      ? resolve(chapter.relative_path)
      : resolve(root, chapter.relative_path);
    const relativePath = relative(root, absolutePath);
    if (relativePath.startsWith(`..${sep}`) || relativePath === '..' || isAbsolute(relativePath)) {
      throw new Error(`第${chapter.chapter_number}章正文文件越出数据目录`);
    }
    return {
      artifactId: artifact.artifact_id,
      parentVersionId: artifact.artifact_version_id,
      chapterId: chapter.chapter_id,
      chapterNumber: chapter.chapter_number,
      title: chapter.title,
      sourceStage: stage,
      legacyOutline: JSON.parse(artifact.content_json) as Record<string, unknown>,
      manuscriptVersionId: chapter.manuscript_version_id,
      manuscript: readFileSync(absolutePath, 'utf8')
    };
  });
}

async function rebuildBatch(
  database: DatabaseSync,
  book: BookRow,
  master: ArtifactRow,
  materials: ChapterMaterial[],
  agent: AgentRow,
  adapterFactory: ModelAdapterFactory
): Promise<RebuiltOutline[]> {
  const scope = { ownerId: book.owner_id, bookId: book.book_id };
  const budgets = new BudgetService(database, ids, clock);
  const budget = budgets.create(scope, 'standard', 70_000, 0);
  const tasks = new TaskService(database, config.releaseId, clock);
  const taskId = ids.next();
  const task = tasks.create(scope, {
    taskId,
    taskType: 'chapter_outline_v2_reconstruction',
    assignedAgentId: agent.agent_id,
    idempotencyKey: `chapter-outline-v2:${rebuildRunId}:${master.artifact_version_id}:${agent.agent_id}:${materials.map((item) => item.chapterNumber).join('-')}`,
    budgetId: budget.budgetId,
    initialPhase: 'reconstructing_outline',
    brief: {
      purpose: '依据已定稿正文和剧情总纲重建作者可读章纲，不改正文与正史',
      chapters: materials.map((item) => item.chapterNumber),
      sourceMasterOutlineVersionId: master.artifact_version_id
    }
  });
  if (task.status === 'succeeded') {
    throw new Error(`批次${materials.map((item) => item.chapterNumber).join(',')}已经执行过，但章纲仍未升级；请先核对任务记录`);
  }
  const basePrompt = buildPrompt(book, materials);
  const calls = new ModelCallService(database, clock, budgets);
  const contextPacks = new ContextPackService(database, ids, clock);
  const adapter = adapterFactory.resolve(agent.provider, agent.model_id, 'discussion', agent.role_key);
  if (process.env.WENMI_REUSE_LAST_RECONSTRUCTION_OUTPUT?.trim().toUpperCase() === 'YES') {
    for (const reusable of loadReusableModelOutputs(database, book, master, materials, agent)) {
      try {
        const outlines = parseBatchOutput(reusable.output, materials);
        tasks.completeSynchronous(scope, task.taskId, 'outline_reconstruction_reused');
        process.stdout.write(`${JSON.stringify({
          event: 'outline_model_output_reused',
          chapters: materials.map((item) => item.chapterNumber),
          sourceModelCallId: reusable.requestId
        })}\n`);
        return outlines.map((outline, index) => ({
          material: materials[index]!,
          outline,
          modelCallId: reusable.requestId,
          agent
        }));
      } catch {
        // 只有完整通过当前Schema和长度门禁的历史输出才允许复用。
      }
    }
  }
  let previousOutput = '';
  let previousError = '';
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    const prompt = attempt === 1
      ? basePrompt
      : `${basePrompt}

上一次输出未通过结构或长度校验。请修正后重新输出完整JSON数组。
校验错误：${previousError}
上一次输出：
${previousOutput.slice(0, 18_000)}`;
    const pack = contextPacks.build(scope, {
      taskId: task.taskId,
      agentId: agent.agent_id,
      canonRevision: book.canon_revision,
      positioningVersion: book.positioning_version,
      outlineVersionId: master.artifact_version_id,
      tokenBudget: 30_000,
      characterBudget: 35_000,
      policyVersion: 'chapter-outline-reconstruction-v2',
      hardSources: [
        {
          sourceType: 'chapter_outline_reconstruction_prompt',
          sourceId: `batch-${materials.map((item) => item.chapterNumber).join('-')}-attempt-${attempt}`,
          content: prompt,
          reason: '真实编剧重建章纲所需的完整且有界资料包',
          priority: 100
        }
      ],
      optionalSources: []
    });
    const requestId = ids.next();
    const reservationId = budgets.reserve(scope, budget.budgetId, requestId, 30_000, 0);
    try {
      const result = await calls.execute(scope, {
        requestId,
        taskId: task.taskId,
        phaseKey: `outline_reconstruction_attempt_${attempt}`,
        agentId: agent.agent_id,
        modelSnapshotId: agent.model_snapshot_id,
        provider: agent.provider,
        modelId: agent.model_id,
        input: prompt,
        parameters: JSON.stringify({
          purpose: 'chapter_outline_reconstruction',
          schema: 'chapter_outline_v2',
          maxOutputTokens: 4_500,
          attempt
        }),
        reservationId,
        contextPackId: pack.contextPackId
      }, adapter, {
        requestId,
        taskId: task.taskId,
        ownerId: scope.ownerId,
        bookId: scope.bookId,
        agentId: agent.agent_id,
        prompt,
        maxOutputTokens: 4_500
      });
      if (result.cashCostCny !== 0) throw new Error('模型返回非零现金成本，拒绝保存章纲');
      const outlines = parseBatchOutput(result.output, materials);
      tasks.completeSynchronous(scope, task.taskId, 'outline_reconstruction_completed');
      return outlines.map((outline, index) => ({
        material: materials[index]!,
        outline,
        modelCallId: requestId,
        agent
      }));
    } catch (error) {
      previousOutput = loadModelOutput(database, requestId) ?? previousOutput;
      previousError = error instanceof Error ? error.message : String(error);
      if (attempt === 2) {
        database.prepare(`
          UPDATE tasks
          SET status = 'failed', error_code = 'CHAPTER_OUTLINE_V2_RECONSTRUCTION_FAILED',
              current_phase = 'outline_reconstruction_failed', updated_at = ?
          WHERE task_id = ? AND owner_id = ? AND book_id = ? AND status = 'pending'
        `).run(clock.now().toISOString(), task.taskId, scope.ownerId, scope.bookId);
        throw error;
      }
    }
  }
  throw new Error('章纲重建未返回有效结果');
}

function buildPrompt(book: BookRow, materials: ChapterMaterial[]): string {
  const chapterMaterials = materials.map((item) => ({
    chapterNumber: item.chapterNumber,
    fixedTitle: item.title,
    authoritativeStage: item.sourceStage,
    oldOutlineForIntentOnly: item.legacyOutline,
    settledManuscriptAsTruth: item.manuscript
  }));
  return `你是文秘写作团队的编剧。请为《${book.title}》重建第${materials.map((item) => item.chapterNumber).join('、')}章章纲。

这是对已经定稿章节的回溯整理，不是续写：
1. 正文是本章事件、人物、结果的唯一事实；不得补写正文中没有发生的事件。
2. 剧情总纲只提供阶段方向；旧章纲只提供当时意图，若与正文冲突，以正文为准。
3. 只输出JSON数组，不要Markdown，不要解释，不要思维过程。
4. 每章必须短而准：3个plotBeats；只列实际出场且有作用的人物，最多4人。
5. chapterFunction、openingState、requiredEndingState和冲突字段每项不超过36个汉字；人物的每个字段不超过18个汉字；节拍的每个字段不超过18个汉字。
6. 情绪曲线1—4项；爽点与压力点各最多2项；伏笔动作最多2项，正文无明确依据就留空数组；所有数组短语不超过18个汉字。
7. 每章整个JSON对象不超过3200个字符，不要复述正文，不要解释同一事实两次。
8. 必须遵守与不得违反各1—3项；自由创作区至少1项，说明将来写作时可自由处理的表达空间。
9. 每章编译后的硬信息不得超过1350个中文字符。

每个数组元素必须严格符合：
{
  "outlineSchema": "chapter_outline_v2",
  "chapterNumber": 1,
  "title": "固定章名",
  "sourceStage": {"stageNumber": 1, "title": "阶段名", "chapterRange": {"start": 1, "end": 50}},
  "chapterFunction": "本章在阶段中的作用",
  "openingState": "开场人物与局势",
  "requiredEndingState": "章末必须落到的局势",
  "cast": [
    {"name": "人物名", "objective": "本章目标", "knowledgeBoundary": "本章知道与不知道什么", "chapterRole": "本章作用", "stateChange": "可选变化"}
  ],
  "conflict": {
    "surface": "表层冲突",
    "underlying": "可选深层冲突",
    "oppositionGoal": "可选对手目标",
    "failureCost": "失败代价",
    "successCost": "可选成功代价"
  },
  "plotBeats": [
    {"order": 1, "trigger": "触发", "action": "行动", "resistance": "可选阻力", "turn": "可选转折", "result": "结果"},
    {"order": 2, "trigger": "触发", "action": "行动", "resistance": "可选阻力", "turn": "可选转折", "result": "结果"},
    {"order": 3, "trigger": "触发", "action": "行动", "resistance": "可选阻力", "turn": "可选转折", "result": "结果"}
  ],
  "experience": {
    "primaryTone": "本章主情绪",
    "emotionalCurve": ["情绪1", "情绪2"],
    "payoffPoints": ["爽点，最多2项"],
    "pressurePoints": ["压力或虐点，最多2项"],
    "readerEffect": "希望读者留下的感受"
  },
  "descriptionFocus": {
    "primary": ["主要描写"],
    "secondary": ["次要描写"],
    "compress": ["应压缩略写"]
  },
  "informationControl": {
    "reveals": ["本章明确揭示"],
    "concealed": ["本章仍保留"],
    "gaps": ["谁知道、谁不知道"]
  },
  "threadActions": [
    {"action": "plant|advance|payoff", "summary": "有正文依据的伏笔动作"}
  ],
  "ending": {
    "result": "章末事件结果",
    "stateChanges": ["人物或资源变化"],
    "hook": "一句章末钩子",
    "nextChapterInterface": "下一章从哪里承接"
  },
  "mustImplement": ["本章不可缺少的事实"],
  "mustNotViolate": ["不得违背的既成事实"],
  "allowedCandidates": ["只允许未来考虑、不可当成本章事实的候选"],
  "creativeFreedom": ["对白、句式、细节等可以自由发挥的范围"]
}

资料包：
${JSON.stringify(chapterMaterials)}`;
}

function parseBatchOutput(output: string, materials: ChapterMaterial[]): ChapterOutlineV2[] {
  const parsed = parseJsonEnvelope(output);
  const candidates = Array.isArray(parsed)
    ? parsed
    : isRecord(parsed) && Array.isArray(parsed.outlines)
      ? parsed.outlines
      : null;
  if (candidates === null || candidates.length !== materials.length) {
    throw new Error(`必须返回${materials.length}个章纲对象`);
  }
  const candidateByChapter = new Map<number, Record<string, unknown>>();
  for (const candidate of candidates) {
    if (!isRecord(candidate) || !Number.isInteger(candidate.chapterNumber)) {
      throw new Error('章纲数组中的元素缺少有效章号');
    }
    candidateByChapter.set(Number(candidate.chapterNumber), candidate);
  }
  return materials.map((material) => {
    const candidate = candidateByChapter.get(material.chapterNumber);
    if (candidate === undefined) throw new Error(`模型输出缺少第${material.chapterNumber}章`);
    const normalized: Record<string, unknown> = {
      ...normalizeSoftCardinality(candidate),
      outlineSchema: 'chapter_outline_v2',
      chapterNumber: material.chapterNumber,
      title: material.title,
      sourceStage: {
        stageNumber: material.sourceStage.stageNumber,
        title: material.sourceStage.title,
        chapterRange: material.sourceStage.chapterRange
      }
    };
    const outline = parseChapterOutlineV2(normalized);
    compileChapterOutlineForWriter(outline as unknown as Record<string, unknown>, 1_350);
    return outline;
  });
}

function normalizeSoftCardinality(candidate: Record<string, unknown>): Record<string, unknown> {
  const normalized = { ...candidate };
  if (isRecord(candidate.experience)) {
    normalized.experience = {
      ...candidate.experience,
      emotionalCurve: first(candidate.experience.emotionalCurve, 5),
      payoffPoints: first(candidate.experience.payoffPoints, 2),
      pressurePoints: first(candidate.experience.pressurePoints, 2)
    };
  }
  if (isRecord(candidate.descriptionFocus)) {
    normalized.descriptionFocus = {
      ...candidate.descriptionFocus,
      primary: first(candidate.descriptionFocus.primary, 5),
      secondary: first(candidate.descriptionFocus.secondary, 5),
      compress: first(candidate.descriptionFocus.compress, 5)
    };
  }
  if (isRecord(candidate.informationControl)) {
    normalized.informationControl = {
      ...candidate.informationControl,
      reveals: first(candidate.informationControl.reveals, 5),
      concealed: first(candidate.informationControl.concealed, 5),
      gaps: first(candidate.informationControl.gaps, 5)
    };
  }
  normalized.threadActions = first(candidate.threadActions, 2);
  normalized.allowedCandidates = first(candidate.allowedCandidates, 8);
  return normalized;
}

function first(value: unknown, maximum: number): unknown {
  return Array.isArray(value) ? value.slice(0, maximum) : value;
}

function parseJsonEnvelope(output: string): unknown {
  const trimmed = output.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '');
  try {
    return JSON.parse(trimmed);
  } catch {
    const arrayStart = trimmed.indexOf('[');
    const arrayEnd = trimmed.lastIndexOf(']');
    if (arrayStart >= 0 && arrayEnd > arrayStart) {
      return JSON.parse(trimmed.slice(arrayStart, arrayEnd + 1));
    }
    const objectStart = trimmed.indexOf('{');
    const objectEnd = trimmed.lastIndexOf('}');
    if (objectStart >= 0 && objectEnd > objectStart) {
      return JSON.parse(trimmed.slice(objectStart, objectEnd + 1));
    }
    throw new Error('模型没有返回可解析的JSON');
  }
}

function loadReusableModelOutputs(
  database: DatabaseSync,
  book: BookRow,
  master: ArtifactRow,
  materials: ChapterMaterial[],
  agent: AgentRow
): Array<{ requestId: string; output: string }> {
  const rows = database.prepare(`
    SELECT m.request_id, r.output_text, t.task_brief_json
    FROM model_calls m
    JOIN model_call_results r ON r.request_id = m.request_id
    JOIN tasks t ON t.task_id = m.task_id
    WHERE m.owner_id = ? AND m.book_id = ? AND m.agent_id = ?
      AND t.task_type = 'chapter_outline_v2_reconstruction'
      AND m.state = 'succeeded'
    ORDER BY m.created_at DESC
    LIMIT 20
  `).all(book.owner_id, book.book_id, agent.agent_id) as unknown as Array<{
    request_id: string;
    output_text: string;
    task_brief_json: string;
  }>;
  const expectedChapters = materials.map((item) => item.chapterNumber);
  return rows.flatMap((row) => {
    const brief = JSON.parse(row.task_brief_json) as Record<string, unknown>;
    const chapters = Array.isArray(brief.chapters) ? brief.chapters.map(Number) : [];
    if (String(brief.sourceMasterOutlineVersionId) !== master.artifact_version_id
      || JSON.stringify(chapters) !== JSON.stringify(expectedChapters)) return [];
    return [{ requestId: row.request_id, output: row.output_text }];
  });
}

function loadModelOutput(database: DatabaseSync, requestId: string): string | null {
  const row = database.prepare(`
    SELECT output_text
    FROM model_call_results
    WHERE request_id = ?
  `).get(requestId) as { output_text: string } | undefined;
  return row?.output_text ?? null;
}

function chunk<T>(items: T[], size: number): T[][] {
  const batches: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    batches.push(items.slice(index, index + size));
  }
  return batches;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
