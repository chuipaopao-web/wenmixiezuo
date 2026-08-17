import { createHash } from 'node:crypto';
import { DomainError, errorCodes } from '../../domain/errors.js';
import type { Clock, IdGenerator } from '../../domain/ids.js';
import { assertBookScope, type BookScope } from '../../domain/scope.js';
import { UnitOfWork } from '../../infrastructure/db/unit-of-work.js';
import {
  BookBrandingDesignRepository,
  type BookBrandingDesignKind,
  type BookBrandingDesignRow
} from '../../infrastructure/db/repositories/book-branding-design-repository.js';
import {
  VolumePlanGenerationRepository,
  type VolumePlanGenerationSeat
} from '../../infrastructure/db/repositories/volume-plan-generation-repository.js';
import { TaskService } from '../tasks/task-service.js';

export interface BookBrandingOption {
  text: string;
  note: string;
}

export interface BookBrandingDesignBrief {
  schema: 'book-branding-design-v1';
  designId: string;
  kind: BookBrandingDesignKind;
  volumePlanId: string;
  sourceFingerprint: string;
  currentText: string;
  seat: VolumePlanGenerationSeat;
}

export interface BookBrandingDesignView {
  designId: string;
  kind: BookBrandingDesignKind;
  status: 'working' | 'succeeded' | 'failed' | 'cancelled';
  taskId: string;
  taskStatus: string;
  currentPhase: string;
  errorCode: string | null;
  options: BookBrandingOption[];
  member: {
    roleKey: string;
    agentId: string;
    displayName: string;
    provider: string;
    modelId: string;
  } | null;
  createdAt: string;
  updatedAt: string;
}

export class BookBrandingDesignService {
  public constructor(
    private readonly repository: BookBrandingDesignRepository,
    private readonly generationRepository: VolumePlanGenerationRepository,
    private readonly tasks: TaskService,
    private readonly unitOfWork: UnitOfWork,
    private readonly ids: IdGenerator,
    private readonly clock: Clock
  ) {}

  public start(scope: BookScope, input: {
    kind: BookBrandingDesignKind;
    idempotencyKey: string;
  }): BookBrandingDesignView {
    assertBookScope(scope);
    const kind = input.kind;
    if (kind !== 'title' && kind !== 'synopsis') {
      throw new DomainError(errorCodes.validation, '主编设计类型无效。');
    }
    if (typeof input.idempotencyKey !== 'string' || input.idempotencyKey.trim().length < 8) {
      throw new DomainError(errorCodes.validation, '缺少有效的幂等键。');
    }
    const firstVolume = this.repository.firstVolumePlan(scope);
    if (
      firstVolume === undefined
      || firstVolume.status !== 'active'
      || firstVolume.activeVersionId === null
      || firstVolume.activeVersionContent === null
    ) {
      throw new DomainError(
        errorCodes.operationIncomplete,
        '主编需要依据第一卷的故事和设定来设计。请先在「卷设计」里确认第一卷方案，再让主编设计书名和简介。',
        {},
        false,
        409
      );
    }
    const snapshot = this.generationRepository.sourceSnapshot(scope, firstVolume.volumePlanId);
    if (snapshot === undefined) {
      throw new DomainError(
        errorCodes.operationIncomplete,
        '开书信息或设定基线不完整，无法为主编准备资料包。',
        {},
        false,
        409
      );
    }
    const team = this.generationRepository.generationSeats(scope);
    const editor = team.seats.find((seat) => seat.editor);
    if (editor === undefined) {
      throw new DomainError(
        errorCodes.operationIncomplete,
        '当前主编不可用，请先在团队设置里恢复主编。',
        {},
        false,
        409
      );
    }
    const budgetId = this.generationRepository.activeBudgetId(scope);
    if (budgetId === undefined) {
      throw new DomainError(errorCodes.operationIncomplete, '当前书籍没有可用预算。', {}, false, 409);
    }
    const working = this.repository.working(scope, kind);
    if (working !== undefined) return this.view(scope, working);
    const currentText = kind === 'title'
      ? snapshot.bookTitle
      : currentSynopsis(snapshot.opening.content);
    const sourceFingerprint = createHash('sha256').update([
      kind,
      snapshot.opening.hash,
      snapshot.setting.hash,
      firstVolume.activeVersionHash ?? '',
      currentText
    ].join('\n')).digest('hex');
    const designId = this.ids.next();
    const brief: BookBrandingDesignBrief = {
      schema: 'book-branding-design-v1',
      designId,
      kind,
      volumePlanId: firstVolume.volumePlanId,
      sourceFingerprint,
      currentText,
      seat: editor
    };
    const now = this.clock.now().toISOString();
    this.unitOfWork.run(() => {
      let task = this.tasks.create(scope, {
        taskId: this.ids.next(),
        taskType: 'book_branding_design',
        assignedAgentId: editor.agentId,
        idempotencyKey: `book-branding:${kind}:${input.idempotencyKey.trim()}`,
        budgetId,
        requiredEditorEpoch: team.editorEpoch,
        initialPhase: 'chief_editor_design',
        brief: brief as unknown as Record<string, unknown>
      });
      this.repository.insert(scope, { designId, kind, taskId: task.taskId, sourceFingerprint, now });
      if (task.status === 'pending') task = this.tasks.queue(scope, task.taskId);
    });
    const created = this.repository.findById(scope, designId);
    if (created === undefined) throw new Error('主编设计任务创建失败。');
    return this.view(scope, created);
  }

  public latest(scope: BookScope, kind: BookBrandingDesignKind): BookBrandingDesignView | null {
    assertBookScope(scope);
    if (kind !== 'title' && kind !== 'synopsis') {
      throw new DomainError(errorCodes.validation, '主编设计类型无效。');
    }
    const row = this.repository.latest(scope, kind);
    return row === undefined ? null : this.view(scope, row);
  }

  private view(scope: BookScope, row: BookBrandingDesignRow): BookBrandingDesignView {
    const task = this.tasks.require(scope, row.task_id);
    if (row.status === 'working' && ['cancelled'].includes(task.status)) {
      this.repository.markCancelled(scope, row.design_id, this.clock.now().toISOString());
      row = { ...row, status: 'cancelled' };
    }
    const brief = task.brief as unknown as Partial<BookBrandingDesignBrief>;
    const seat = brief.seat;
    return {
      designId: row.design_id,
      kind: row.kind,
      status: row.status,
      taskId: row.task_id,
      taskStatus: task.status,
      currentPhase: task.currentPhase,
      errorCode: row.error_code ?? task.errorCode,
      options: parseOptions(row.options_json),
      member: seat === undefined ? null : {
        roleKey: seat.roleKey,
        agentId: seat.agentId,
        displayName: seat.displayName,
        provider: seat.provider,
        modelId: seat.modelId
      },
      createdAt: row.created_at,
      updatedAt: row.updated_at
    };
  }
}

function currentSynopsis(openingContent: string): string {
  try {
    const blueprint = JSON.parse(openingContent) as { fullBookOutline?: unknown };
    return typeof blueprint.fullBookOutline === 'string' ? blueprint.fullBookOutline.trim() : '';
  } catch {
    return '';
  }
}

function parseOptions(optionsJson: string): BookBrandingOption[] {
  try {
    const value = JSON.parse(optionsJson) as unknown;
    if (!Array.isArray(value)) return [];
    return value.flatMap((item) => {
      if (typeof item !== 'object' || item === null) return [];
      const record = item as Record<string, unknown>;
      return typeof record.text === 'string'
        ? [{ text: record.text, note: typeof record.note === 'string' ? record.note : '' }]
        : [];
    });
  } catch {
    return [];
  }
}
