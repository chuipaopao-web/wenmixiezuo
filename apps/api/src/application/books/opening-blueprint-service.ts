import type { Clock, IdGenerator } from '../../domain/ids.js';
import { DomainError, errorCodes } from '../../domain/errors.js';
import type { BookScope } from '../../domain/scope.js';
import { OPENING_TAXONOMY, validateOpeningBlueprint, type OpeningBlueprintInput } from '../../contracts/opening-blueprint.js';
import { hashJson } from './adaptation-rules.js';
import { BookRepository } from '../../infrastructure/db/repositories/book-repository.js';
import { OpeningBlueprintRepository } from '../../infrastructure/db/repositories/opening-blueprint-repository.js';
import { UnitOfWork } from '../../infrastructure/db/unit-of-work.js';

export interface OpeningBlueprintRevision {
  openingBlueprintId: string;
  version: number;
  previousVersion: number;
  title: string;
}

export class OpeningBlueprintService {
  public constructor(
    private readonly blueprints: OpeningBlueprintRepository,
    private readonly books: BookRepository,
    private readonly unitOfWork: UnitOfWork,
    private readonly ids: IdGenerator,
    private readonly clock: Clock
  ) {}

  public revise(scope: BookScope, input: {
    expectedVersion: number;
    title: string;
    openingBlueprint: OpeningBlueprintInput;
  }): OpeningBlueprintRevision {
    if (!Number.isInteger(input.expectedVersion) || input.expectedVersion < 1) {
      throw new DomainError(errorCodes.validation, '开书资料版本无效，请刷新后重试。');
    }
    const title = normalizeTitle(input.title);
    let blueprint: OpeningBlueprintInput;
    try {
      blueprint = validateOpeningBlueprint(input.openingBlueprint);
    } catch (error) {
      throw new DomainError(errorCodes.validation, error instanceof Error ? error.message : '开书资料格式无效。');
    }
    const category = OPENING_TAXONOMY.categories.find((item) => item.key === blueprint.categoryKey);
    if (category === undefined || category.channel !== blueprint.channel) {
      throw new DomainError(errorCodes.validation, '开书分类目录与频道不匹配，请刷新后重试。');
    }
    const now = this.clock.now().toISOString();
    return this.unitOfWork.run(() => {
      const book = this.books.require(scope);
      if (book.status !== 'active' && book.status !== 'draft') {
        throw new DomainError(errorCodes.bookStatusConflict, '只有创作中或草稿状态的书可以修改开书资料。', { status: book.status }, false, 409);
      }
      const current = this.blueprints.active(scope);
      if (current === undefined) {
        throw new DomainError(errorCodes.validation, '本书尚无可修改的开书资料。', {}, false, 404);
      }
      if (current.version !== input.expectedVersion) {
        throw new DomainError(
          errorCodes.bookVersionConflict,
          '开书资料已经被修改，请刷新后再保存。',
          { expectedVersion: input.expectedVersion, actualVersion: current.version },
          false,
          409
        );
      }
      const currentBlueprint = JSON.parse(current.blueprint_json) as OpeningBlueprintInput;
      if ((currentBlueprint.creationMode ?? 'new') !== (blueprint.creationMode ?? 'new')) {
        throw new DomainError(errorCodes.validation, '建书后不能切换“从零创作”和“已有正文续写”。');
      }
      if (!this.blueprints.supersedeActive(scope, input.expectedVersion)) {
        throw new DomainError(errorCodes.bookVersionConflict, '开书资料已经被修改，请刷新后再保存。', { expectedVersion: input.expectedVersion }, false, 409);
      }
      const version = this.blueprints.nextVersion(scope);
      const openingBlueprintId = this.ids.next();
      this.blueprints.insert(scope, {
        openingBlueprintId,
        version,
        taxonomyVersion: blueprint.taxonomyVersion,
        channel: blueprint.channel,
        categoryKey: blueprint.categoryKey,
        categoryName: category.name,
        blueprintJson: JSON.stringify(blueprint),
        contentHash: hashJson(blueprint),
        now
      });
      this.books.updateTitle(scope, book.version, title, now);
      return { openingBlueprintId, version, previousVersion: current.version, title };
    });
  }
}

function normalizeTitle(value: unknown): string {
  if (typeof value !== 'string') throw new DomainError(errorCodes.validation, '书名格式无效。');
  const title = value.trim();
  if (title.length === 0) throw new DomainError(errorCodes.validation, '请填写书名。');
  if (title.length > 120) throw new DomainError(errorCodes.validation, '书名不能超过120个字符。');
  return title;
}
