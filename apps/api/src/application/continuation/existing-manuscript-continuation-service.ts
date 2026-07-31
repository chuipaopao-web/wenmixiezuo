import { createHash } from 'node:crypto';
import { closeSync, copyFileSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync } from 'node:fs';
import { dirname } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import type { Clock, IdGenerator } from '../../domain/ids.js';
import { DomainError, errorCodes } from '../../domain/errors.js';
import { assertBookScope, type BookScope } from '../../domain/scope.js';
import { ContinuationImportRepository, type ContinuationImportChapterRow, type ContinuationImportRow } from '../../infrastructure/db/repositories/continuation-import-repository.js';
import { OwnerManuscriptRepository } from '../../infrastructure/db/repositories/owner-manuscript-repository.js';
import { resolveInside, sha256File } from '../../infrastructure/files/file-utils.js';
import { PromotionService } from '../../infrastructure/recovery/promotion-service.js';
import { ChapterCatalogService } from '../chapters/chapter-catalog-service.js';
import { CanonService } from '../knowledge/canon-service.js';
import { TaskService } from '../tasks/task-service.js';
import { countCharacters, existingManuscriptParserVersion, parseExistingManuscript } from './existing-manuscript-parser.js';

const maximumSourceCharacters = 5_000_000;
const maximumSourceNameCharacters = 240;
const maximumChapterTitleCharacters = 120;

export interface ContinuationImportChapterView {
  importChapterId: string;
  ordinal: number;
  detectedTitle: string;
  title: string;
  characterCount: number;
  contentHash: string;
  included: boolean;
  status: string;
  targetChapterNumber: number | null;
  targetChapterId: string | null;
  targetManuscriptVersionId: string | null;
}

export interface ContinuationImportView {
  importId: string;
  sourceName: string;
  sourceHash: string;
  parserVersion: string;
  status: string;
  sourceCharacterCount: number;
  includedChapterCount: number;
  importedChapterCount: number;
  lastCompletedOrdinal: number;
  warnings: string[];
  errorCode: string | null;
  errorMessage: string | null;
  createdAt: string;
  confirmedAt: string | null;
  completedAt: string | null;
  chapters: ContinuationImportChapterView[];
}

export interface ContinuationConfirmationChapter {
  importChapterId: string;
  title: string;
  included: boolean;
}

export class ExistingManuscriptContinuationService {
  private readonly repository: ContinuationImportRepository;

  public constructor(
    private readonly database: DatabaseSync,
    private readonly dataDir: string,
    private readonly releaseId: string,
    private readonly ids: IdGenerator,
    private readonly clock: Clock
  ) {
    this.repository = new ContinuationImportRepository(database);
  }

  public preview(scope: BookScope, input: { sourceName: string; text: string }): ContinuationImportView {
    assertBookScope(scope);
    this.repository.assertBookExists(scope);
    if (this.repository.hasChapters(scope)) {
      throw new DomainError(errorCodes.operationIncomplete, '这本书已经有章节，不能再导入整本前文基线', {}, false, 409);
    }
    if (this.repository.hasActiveChapterTask(scope)) {
      throw new DomainError(errorCodes.taskAlreadyRunning, '这本书有正在处理的章节任务，请先完成或取消后再导入', {}, false, 409);
    }
    if (typeof input.text !== 'string' || input.text.trim().length === 0) {
      throw new DomainError(errorCodes.validation, '请粘贴已有正文或选择TXT文件');
    }
    const parsed = parseExistingManuscript(input.text);
    if (parsed.normalizedText.length > maximumSourceCharacters) {
      throw new DomainError(errorCodes.validation, `已有正文最多${maximumSourceCharacters.toLocaleString('zh-CN')}字符`);
    }
    const sourceName = normalizeSourceName(input.sourceName);
    const existing = this.repository.findBySourceHash(scope, parsed.sourceHash);
    if (existing !== undefined) return this.get(scope, existing.continuation_import_id);

    const importId = this.ids.next();
    const staged = new PromotionService(this.database, this.dataDir, this.clock)
      .stageText(`continuation-${importId}`, parsed.normalizedText);
    if (staged.contentHash !== parsed.sourceHash) throw new Error('导入源文本哈希不一致');
    const sourceRelativePath = this.persistSource(scope, importId, staged.stagedRelativePath, staged.contentHash);
    const now = this.clock.now().toISOString();
    this.repository.runInTransaction(() => {
      this.repository.insertImport(scope, {
        importId,
        sourceName,
        sourceRelativePath,
        sourceHash: staged.contentHash,
        parserVersion: existingManuscriptParserVersion,
        sourceCharacterCount: parsed.sourceCharacterCount,
        warningsJson: JSON.stringify(parsed.warnings),
        now
      });
      for (const chapter of parsed.chapters) {
        this.repository.insertChapter(scope, {
          importChapterId: this.ids.next(),
          importId,
          ordinal: chapter.ordinal,
          detectedTitle: chapter.detectedTitle,
          contentStart: chapter.contentStart,
          contentEnd: chapter.contentEnd,
          contentHash: chapter.contentHash,
          characterCount: chapter.characterCount,
          now
        });
      }
    });
    return this.get(scope, importId);
  }

  public get(scope: BookScope, importId: string): ContinuationImportView {
    assertBookScope(scope);
    const record = this.repository.requireImport(scope, importId);
    if (record === undefined) throw new DomainError(errorCodes.bookScopeViolation, '续写导入不存在或不属于当前书籍', {}, false, 404);
    return mapImport(record, this.repository.chapters(scope, importId));
  }

  public latest(scope: BookScope): ContinuationImportView | null {
    assertBookScope(scope);
    this.repository.assertBookExists(scope);
    const record = this.repository.latest(scope);
    return record === undefined ? null : mapImport(record, this.repository.chapters(scope, record.continuation_import_id));
  }

  public confirm(scope: BookScope, importId: string, input: { chapters: ContinuationConfirmationChapter[] }): ContinuationImportView {
    assertBookScope(scope);
    const record = this.repository.requireImport(scope, importId);
    if (record === undefined) throw new DomainError(errorCodes.bookScopeViolation, '续写导入不存在或不属于当前书籍', {}, false, 404);
    if (record.status === 'ready') return this.get(scope, importId);
    if (record.status === 'cancelled') throw new DomainError(errorCodes.operationIncomplete, '这次导入已经取消', {}, false, 409);
    if (!['parsed', 'failed', 'importing'].includes(record.status)) {
      throw new DomainError(errorCodes.operationIncomplete, '这次导入当前不能确认', { status: record.status }, false, 409);
    }
    const stored = this.repository.chapters(scope, importId);
    const confirmation = validateConfirmation(stored, input.chapters, record.status === 'parsed');
    if (record.status === 'parsed') {
      if (this.repository.hasChapters(scope)) {
        throw new DomainError(errorCodes.operationIncomplete, '这本书已经有章节，不能覆盖或追加整本前文', {}, false, 409);
      }
      if (this.repository.hasActiveChapterTask(scope)) {
        throw new DomainError(errorCodes.taskAlreadyRunning, '这本书有正在处理的章节任务，请先完成或取消后再导入', {}, false, 409);
      }
      this.repository.runInTransaction(() => this.repository.applyConfirmation(scope, importId, confirmation, this.clock.now().toISOString()));
    } else if (this.repository.hasUnrelatedChapter(scope, importId)) {
      throw new DomainError(errorCodes.operationIncomplete, '检测到不属于本次导入的章节，已停止恢复以避免覆盖', {}, false, 409);
    }

    const refreshedChapters = this.repository.chapters(scope, importId);
    const included = refreshedChapters.filter((chapter) => chapter.included === 1 && chapter.status !== 'excluded');
    if (included.length === 0) throw new DomainError(errorCodes.validation, '至少保留一个章节才能建立前文基线');
    if (included.some((chapter) => chapter.character_count === 0)) {
      throw new DomainError(errorCodes.validation, '纳入的章节中存在空正文，请排除或修正章节识别');
    }
    const attemptNo = record.attempt_count + 1;
    const taskId = this.ids.next();
    const tasks = new TaskService(this.database, this.releaseId, this.clock);
    this.repository.runInTransaction(() => {
      tasks.create(scope, {
        taskId,
        taskType: 'existing_manuscript_import',
        assignedAgentId: null,
        chapterId: null,
        idempotencyKey: `continuation-import:${importId}:attempt:${attemptNo}`,
        initialPhase: 'importing',
        brief: { importId, sourceHash: record.source_hash, chapterCount: included.length, parserVersion: record.parser_version }
      });
      this.repository.beginAttempt(scope, importId, included.length, taskId, this.clock.now().toISOString());
    });
    try {
      this.performImport(scope, importId, taskId);
      tasks.completeSynchronous(scope, taskId, 'imported');
      this.repository.markReady(scope, importId, this.clock.now().toISOString());
    } catch (error) {
      const now = this.clock.now().toISOString();
      this.repository.markFailed(scope, importId, 'CONTINUATION_IMPORT_FAILED', safeMessage(error), now);
      this.repository.markTaskFailed(scope, taskId, now);
      throw error;
    }
    return this.get(scope, importId);
  }

  private performImport(scope: BookScope, importId: string, taskId: string): void {
    const record = this.repository.requireImport(scope, importId);
    if (record === undefined) throw new Error('导入记录丢失');
    const sourcePath = resolveInside(this.dataDir, record.source_relative_path);
    if (sha256File(sourcePath) !== record.source_hash) throw new Error('导入源文件缺失或哈希不匹配');
    const source = readFileSync(sourcePath, 'utf8');
    const chapters = this.repository.chapters(scope, importId)
      .filter((chapter) => chapter.included === 1 && chapter.status !== 'excluded')
      .sort((left, right) => left.ordinal - right.ordinal);
    const catalog = new ChapterCatalogService(this.database, this.ids, this.clock);
    let volumeId = this.repository.firstVolumeId(scope);
    if (volumeId === null) volumeId = catalog.createVolume(scope, 1, '正文');
    const stewardAgentId = new OwnerManuscriptRepository(this.database).leadWriterAgentId(scope);
    if (stewardAgentId === null) throw new DomainError(errorCodes.agentCapabilityUnavailable, '本书缺少可登记导入正文的主笔岗位', {}, false, 409);
    const promotion = new PromotionService(this.database, this.dataDir, this.clock);
    const canon = new CanonService(this.database, this.ids, this.clock);

    for (let targetIndex = 0; targetIndex < chapters.length; targetIndex += 1) {
      let chapter = this.repository.chapters(scope, importId).find((candidate) => candidate.continuation_import_chapter_id === chapters[targetIndex]!.continuation_import_chapter_id)!;
      const chapterNumber = targetIndex + 1;
      if (chapter.status === 'preview') {
        this.repository.runInTransaction(() => {
          const created = catalog.createChapter(scope, volumeId, chapterNumber, chapter.edited_title);
          this.repository.markChapterCreated(scope, chapter.continuation_import_chapter_id, chapterNumber, created.chapterId, this.clock.now().toISOString());
        });
        chapter = this.requireImportChapter(scope, importId, chapter.continuation_import_chapter_id);
      }
      if (chapter.target_chapter_id === null) throw new Error('导入章节缺少目标章节检查点');
      const targetChapterId = chapter.target_chapter_id;
      const content = source.slice(chapter.content_start, chapter.content_end);
      if (hashMatches(content, chapter.content_hash) === false) throw new Error(`第${chapter.ordinal}项正文哈希不一致`);
      const manuscriptVersionId = `manuscript-${chapter.continuation_import_chapter_id}`;
      const fileId = `file-${chapter.continuation_import_chapter_id}`;
      if (chapter.status === 'chapter_created') {
        const staged = promotion.stageText(`continuation-chapter-${chapter.continuation_import_chapter_id}`, content);
        promotion.promote(scope, {
          ...staged,
          operationId: `promote-${chapter.continuation_import_chapter_id}`,
          fileId,
          chapterId: targetChapterId,
          versionId: manuscriptVersionId
        });
        this.repository.runInTransaction(() => {
          if (!this.repository.manuscriptExists(scope, manuscriptVersionId)) {
            catalog.registerManuscript(scope, {
              manuscriptVersionId,
              chapterId: targetChapterId,
              parentVersionId: null,
              authorAgentId: stewardAgentId,
              modelProvider: 'import',
              modelId: 'author-existing-manuscript',
              sourceTaskId: taskId,
              fileId,
              contentHash: chapter.content_hash,
              wordCount: countCharacters(content),
              status: 'approved',
              creatorKind: 'import',
              editNote: `作者确认导入：${record.source_name}`,
              expectedCurrentVersionId: null
            });
          }
          this.repository.markManuscriptRegistered(scope, chapter.continuation_import_chapter_id, manuscriptVersionId, this.clock.now().toISOString());
          });
        chapter = this.requireImportChapter(scope, importId, chapter.continuation_import_chapter_id);
      }
      if (chapter.status === 'manuscript_registered') {
        const settlement = this.repository.chapterSettlement(scope, targetChapterId);
        if (settlement?.status !== 'settled') {
          canon.settleChapter(scope, targetChapterId, manuscriptVersionId, {
            source: 'existing_manuscript_import',
            importId,
            sourceHash: record.source_hash,
            chapterNumber,
            title: chapter.edited_title,
            imported: true,
            summaryStatus: 'not_generated'
          });
        } else if (settlement.canonManuscriptVersionId !== manuscriptVersionId) {
          throw new Error('目标章节已经由其他正文结算');
        }
        this.repository.markImported(scope, importId, chapter.continuation_import_chapter_id, chapter.ordinal, this.clock.now().toISOString());
      }
    }
  }

  private requireImportChapter(scope: BookScope, importId: string, importChapterId: string): ContinuationImportChapterRow {
    const row = this.repository.chapters(scope, importId).find((candidate) => candidate.continuation_import_chapter_id === importChapterId);
    if (row === undefined) throw new Error('导入章节检查点丢失');
    return row;
  }

  private persistSource(scope: BookScope, importId: string, stagedRelativePath: string, contentHash: string): string {
    const stagedPath = resolveInside(this.dataDir, stagedRelativePath);
    if (!existsSync(stagedPath) || sha256File(stagedPath) !== contentHash) {
      throw new Error('导入源暂存文件缺失或哈希不匹配');
    }
    const targetRelativePath = `books/${scope.bookId}/continuation-imports/${importId}/${contentHash}.txt`;
    const targetPath = resolveInside(this.dataDir, targetRelativePath);
    mkdirSync(dirname(targetPath), { recursive: true });
    if (!existsSync(targetPath)) {
      const temporaryPath = `${targetPath}.${importId}.tmp`;
      copyFileSync(stagedPath, temporaryPath);
      const descriptor = openSync(temporaryPath, 'r+');
      try { fsyncSync(descriptor); } finally { closeSync(descriptor); }
      renameSync(temporaryPath, targetPath);
    }
    if (sha256File(targetPath) !== contentHash) throw new Error('持久化导入源文件哈希不匹配');
    return targetRelativePath;
  }
}

function validateConfirmation(
  stored: ContinuationImportChapterRow[],
  submitted: ContinuationConfirmationChapter[],
  editable: boolean
): ContinuationConfirmationChapter[] {
  if (!Array.isArray(submitted) || submitted.length !== stored.length) {
    throw new DomainError(errorCodes.validation, '确认清单与当前预览不一致，请重新载入');
  }
  const storedById = new Map(stored.map((chapter) => [chapter.continuation_import_chapter_id, chapter]));
  const ids = new Set<string>();
  const result = submitted.map((item) => {
    if (typeof item.importChapterId !== 'string' || ids.has(item.importChapterId)) {
      throw new DomainError(errorCodes.validation, '确认清单包含重复或无效章节');
    }
    ids.add(item.importChapterId);
    const current = storedById.get(item.importChapterId);
    if (current === undefined) throw new DomainError(errorCodes.validation, '确认清单包含未知章节');
    const title = normalizeTitle(item.title);
    const included = item.included === true;
    if (!editable && (title !== current.edited_title || included !== (current.included === 1))) {
      throw new DomainError(errorCodes.operationIncomplete, '导入已经开始，恢复时不能再修改章节清单', {}, false, 409);
    }
    return { importChapterId: item.importChapterId, title, included };
  });
  const includedTitles = result.filter((item) => item.included).map((item) => item.title.toLocaleLowerCase('zh-CN'));
  if (new Set(includedTitles).size !== includedTitles.length) throw new DomainError(errorCodes.validation, '纳入章节的标题不能重复');
  return result;
}

function normalizeTitle(value: string): string {
  if (typeof value !== 'string') throw new DomainError(errorCodes.validation, '章节标题格式无效');
  const title = value.trim().normalize('NFC');
  if (title.length === 0 || title.length > maximumChapterTitleCharacters) {
    throw new DomainError(errorCodes.validation, `章节标题必须为1—${maximumChapterTitleCharacters}个字符`);
  }
  return title;
}

function normalizeSourceName(value: string): string {
  const sourceName = typeof value === 'string' ? value.trim().normalize('NFC') : '';
  if (sourceName.length === 0) return '粘贴的已有正文.txt';
  if (sourceName.length > maximumSourceNameCharacters) throw new DomainError(errorCodes.validation, '文件名过长');
  return sourceName.replace(/[\\/\u0000-\u001f]/gu, '_');
}

function mapImport(record: ContinuationImportRow, chapters: ContinuationImportChapterRow[]): ContinuationImportView {
  return {
    importId: record.continuation_import_id,
    sourceName: record.source_name,
    sourceHash: record.source_hash,
    parserVersion: record.parser_version,
    status: record.status,
    sourceCharacterCount: record.source_character_count,
    includedChapterCount: record.included_chapter_count,
    importedChapterCount: record.imported_chapter_count,
    lastCompletedOrdinal: record.last_completed_ordinal,
    warnings: parseWarnings(record.warnings_json),
    errorCode: record.error_code,
    errorMessage: record.error_message,
    createdAt: record.created_at,
    confirmedAt: record.confirmed_at,
    completedAt: record.completed_at,
    chapters: chapters.map((chapter) => ({
      importChapterId: chapter.continuation_import_chapter_id,
      ordinal: chapter.ordinal,
      detectedTitle: chapter.detected_title,
      title: chapter.edited_title,
      characterCount: chapter.character_count,
      contentHash: chapter.content_hash,
      included: chapter.included === 1,
      status: chapter.status,
      targetChapterNumber: chapter.target_chapter_number,
      targetChapterId: chapter.target_chapter_id,
      targetManuscriptVersionId: chapter.target_manuscript_version_id
    }))
  };
}

function parseWarnings(value: string): string[] {
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : [];
  } catch {
    return [];
  }
}

function hashMatches(content: string, expected: string): boolean {
  return createHash('sha256').update(content, 'utf8').digest('hex') === expected;
}

function safeMessage(error: unknown): string {
  if (error instanceof DomainError || error instanceof Error) return error.message;
  return String(error);
}
