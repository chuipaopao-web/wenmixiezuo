import { createHash, randomUUID } from "node:crypto";
import {
  bookLifecycleRequestSchema,
  bookListQuerySchema,
  bookProfileSchema,
  bookProfileUpdateRequestSchema,
  manualBookCreateSchema,
  manualBookReadSchema,
  openingBookCreateRequestSchema,
  openingBookCreateResultSchema,
  bookRecordSchema,
  type BookOpeningBlueprint,
  type BookLifecycleRequest,
  type BookListQuery,
  type BookProfile,
  type BookProfileUpdateRequest,
  type BookRecord as PublicBookContract,
  type OpeningBookCreateRequest,
  type OpeningPackage,
  type OpeningTaxonomy,
  type ManualBookCreate,
  type ManualBookRead
} from "@wenmi-rebuild/contracts";
import { DomainError } from "../../domain/errors.js";
import type {
  BookListCursor,
  BookListInput,
  BookListResult,
  BookListStatusFilter,
  BookRecord,
  ManualBookChapterDirectoryRecord,
  ManualBookSourceRecord,
  NormalizedBookListInput,
  PublicBookRecord
} from "../../domain/bookshelf/index.js";
import type { AccountCoreService, AuthenticatedAccountSession } from "../accounts/index.js";
import { PostgresBookshelfRepository } from "../../infrastructure/postgres/repositories/bookshelf-repository.js";
import type { PgClient, PgPool } from "../../infrastructure/postgres/client.js";
import { OPENING_TAXONOMY } from "./opening-taxonomy.js";

export interface CreateBookFromSessionInput {
  readonly title: string;
  readonly idempotencyKey: string;
}

export type CreateManualBookFromSessionInput = ManualBookCreate;

export type ConfirmManualOpeningBookInput = OpeningBookCreateRequest;

export class BookShelfService {
  private readonly repository: PostgresBookshelfRepository;

  public constructor(pool: PgPool, private readonly accounts: AccountCoreService) {
    this.repository = new PostgresBookshelfRepository(pool);
  }

  public async createBookFromSession(sessionToken: string, input: CreateBookFromSessionInput): Promise<PublicBookRecord> {
    const title = normalizeBookTitle(input.title);
    const idempotencyKey = normalizeIdempotencyKey(input.idempotencyKey);
    const idempotencyInputHash = hashIdempotencyInput({ title });
    const result = await this.accounts.withAuthenticatedSessionTransaction(sessionToken, async (client, session) => {
      const existing = await this.repository.findByOwnerAndIdempotencyKey(client, session.account.ownerId, idempotencyKey, true);
      if (existing !== null) {
        if (existing.idempotencyInputHash !== idempotencyInputHash) {
          await this.audit(client, "book_create_idempotency_conflict", "rejected", session, existing.bookId, {
            reason: "idempotency_input_conflict"
          });
          return { kind: "conflict" as const };
        }
        return { kind: "ok" as const, book: publicBook(existing) };
      }
      const book = await this.repository.insertBook(client, {
        bookId: randomUUID(),
        ownerId: session.account.ownerId,
        title,
        idempotencyKey,
        idempotencyInputHash
      });
      await this.audit(client, "book_created", "succeeded", session, book.bookId, { engine: "rebuild" });
      return { kind: "ok" as const, book: publicBook(book) };
    });
    if (result.kind === "conflict") throw new DomainError("BOOK_IDEMPOTENCY_CONFLICT", "这次建书请求和上次同编号请求内容不同。");
    return result.book;
  }

  public async createManualBookFromSession(sessionToken: string, input: CreateManualBookFromSessionInput): Promise<ManualBookRead> {
    const parsed = parseManualCreate(input);
    const title = normalizeBookTitle(parsed.openingPackage.title);
    const idempotencyKey = normalizeIdempotencyKey(parsed.idempotencyKey);
    const openingIdea = parsed.openingIdea ?? null;
    const inputHash = hashIdempotencyInput({
      kind: "manual_opening_package",
      openingIdea,
      openingPackage: parsed.openingPackage
    });
    const result = await this.accounts.withAuthenticatedSessionTransaction(sessionToken, async (client, session) => {
      const existing = await this.repository.findByOwnerAndIdempotencyKey(client, session.account.ownerId, idempotencyKey, true);
      if (existing !== null) {
        if (existing.idempotencyInputHash !== inputHash) {
          await this.audit(client, "manual_book_create_idempotency_conflict", "rejected", session, existing.bookId, {
            reason: "idempotency_input_conflict"
          });
          return { kind: "conflict" as const };
        }
        const read = await this.readManualBookInsideTransaction(client, session, existing.bookId);
        return read === null ? { kind: "conflict" as const } : { kind: "ok" as const, value: read };
      }
      const book = await this.repository.insertBook(client, {
        bookId: randomUUID(),
        ownerId: session.account.ownerId,
        title,
        idempotencyKey,
        idempotencyInputHash: inputHash
      });
      const source = await this.repository.insertManualOpeningSource(client, {
        sourceId: randomUUID(),
        ownerId: session.account.ownerId,
        bookId: book.bookId,
        openingIdea,
        openingPackage: parsed.openingPackage,
        inputHash
      });
      const directory = await this.repository.insertManualChapterDirectory(client, {
        directoryId: randomUUID(),
        ownerId: session.account.ownerId,
        bookId: book.bookId
      });
      const profile = profileFromManualPackage(book, source.openingPackage as OpeningPackage, source.openingIdea, 1);
      await this.repository.insertBookProfileVersion(client, {
        profileVersionId: randomUUID(),
        ownerId: session.account.ownerId,
        bookId: book.bookId,
        version: 1,
        profile
      });
      await this.audit(client, "manual_book_created", "succeeded", session, book.bookId, {
        sourceVersion: source.sourceVersion,
        directoryVersion: directory.directoryVersion,
        profileVersion: 1
      });
      return { kind: "ok" as const, value: manualBookRead(book, source, directory) };
    });
    if (result.kind === "conflict") throw new DomainError("BOOK_IDEMPOTENCY_CONFLICT", "这次手动建书请求和上次同编号请求内容不同。");
    return result.value;
  }

  public async confirmManualOpeningBookFromSession(
    sessionToken: string,
    input: ConfirmManualOpeningBookInput
  ): Promise<{ readonly bookId: string; readonly title: string; readonly status: "active"; readonly nextView: "information" }> {
    const parsed = openingBookCreateRequestSchema.safeParse(input);
    if (!parsed.success) throw new DomainError("BOOK_INPUT_INVALID", "手动开书内容没有通过检查。");
    validatePublicManualOpening(parsed.data.openingPackage);
    const created = await this.createManualBookFromSession(sessionToken, parsed.data);
    if (created.book.status === "archived") {
      throw new DomainError("BOOK_VERSION_CONFLICT", "这本书已归档，请先在书架恢复。");
    }
    return openingBookCreateResultSchema.parse({
      bookId: created.book.bookId,
      title: created.book.title,
      status: "active",
      nextView: "information"
    });
  }

  public async readManualBookFromSession(sessionToken: string, bookId: string): Promise<ManualBookRead> {
    const normalizedBookId = parseBookId(bookId);
    const result = await this.accounts.withAuthenticatedSessionTransaction(sessionToken, async (client, session) =>
      this.readManualBookInsideTransaction(client, session, normalizedBookId)
    );
    if (result === null) throw new DomainError("BOOK_NOT_FOUND", "没有找到这本书。");
    return result;
  }

  public async getOpeningTaxonomy(sessionToken: string): Promise<OpeningTaxonomy> {
    const auth = await this.accounts.authenticateToken(sessionToken);
    if (auth === null) throw new DomainError("AUTHENTICATION_REQUIRED", "请先登录。");
    return OPENING_TAXONOMY;
  }

  public async getBookProfileFromSession(sessionToken: string, bookId: string): Promise<BookProfile> {
    const normalizedBookId = parseBookId(bookId);
    const result = await this.accounts.withAuthenticatedSessionTransaction(sessionToken, async (client, session) => {
      const book = await this.repository.findByOwnerAndBookId(client, session.account.ownerId, normalizedBookId, false);
      if (book === null || book.status !== "active") return null;
      const latest = await this.repository.findLatestBookProfileVersion(client, session.account.ownerId, book.bookId);
      if (latest !== null) return bookProfileSchema.parse(latest.profile);
      const source = await this.repository.findManualOpeningSource(client, session.account.ownerId, book.bookId);
      if (source === null) return null;
      return profileFromManualPackage(book, source.openingPackage as OpeningPackage, source.openingIdea, 1);
    });
    if (result === null) throw new DomainError("BOOK_NOT_FOUND", "没有找到这本书。");
    return result;
  }

  public async updateBookProfileFromSession(sessionToken: string, bookId: string, input: BookProfileUpdateRequest): Promise<BookProfile> {
    const normalizedBookId = parseBookId(bookId);
    const parsed = bookProfileUpdateRequestSchema.safeParse(input);
    if (!parsed.success) throw new DomainError("BOOK_INPUT_INVALID", "书籍资料没有通过检查。");
    const title = normalizeBookTitle(parsed.data.title);
    const result = await this.accounts.withAuthenticatedSessionTransaction(sessionToken, async (client, session) => {
      const book = await this.repository.findByOwnerAndBookId(client, session.account.ownerId, normalizedBookId, true);
      if (book === null || book.status !== "active") return { kind: "not-found" as const };
      const source = await this.repository.findManualOpeningSource(client, session.account.ownerId, book.bookId);
      if (source === null) return { kind: "not-found" as const };
      const latest = await this.repository.findLatestBookProfileVersion(client, session.account.ownerId, book.bookId);
      const current = latest === null
        ? profileFromManualPackage(book, source.openingPackage as OpeningPackage, source.openingIdea, 1)
        : bookProfileSchema.parse(latest.profile);
      const currentProfileVersion = current.version ?? 1;
      if (currentProfileVersion !== parsed.data.expectedVersion) {
        await this.audit(client, "book_profile_update", "rejected", session, book.bookId, {
          reason: "version_conflict",
          expectedVersion: parsed.data.expectedVersion,
          currentVersion: currentProfileVersion
        });
        return { kind: "conflict" as const };
      }
      const blueprint = preserveServerOpeningIdea(parsed.data.openingBlueprint, source.openingIdea);
      const candidate = profileFromBlueprint(title, blueprint, currentProfileVersion, current);
      if (profileFingerprint(candidate) === profileFingerprint(current)) {
        return { kind: "ok" as const, profile: current };
      }
      if (latest === null) {
        await this.repository.insertBookProfileVersion(client, {
          profileVersionId: randomUUID(),
          ownerId: session.account.ownerId,
          bookId: book.bookId,
          version: currentProfileVersion,
          profile: current
        });
      }
      const updatedBook = await this.repository.updateBookTitle(client, session.account.ownerId, book.bookId, title);
      const nextProfileVersion = currentProfileVersion + 1;
      const updatedProfile = profileFromBlueprint(updatedBook.title, blueprint, nextProfileVersion, current);
      await this.repository.insertBookProfileVersion(client, {
        profileVersionId: randomUUID(),
        ownerId: session.account.ownerId,
        bookId: book.bookId,
        version: nextProfileVersion,
        profile: updatedProfile
      });
      await this.audit(client, "book_profile_update", "succeeded", session, book.bookId, {
        previousVersion: currentProfileVersion,
        nextVersion: nextProfileVersion,
        bookVersion: updatedBook.version
      });
      return { kind: "ok" as const, profile: updatedProfile };
    });
    if (result.kind === "not-found") throw new DomainError("BOOK_NOT_FOUND", "没有找到这本书。");
    if (result.kind === "conflict") throw new DomainError("BOOK_VERSION_CONFLICT", "书籍已经更新，请刷新后重试。");
    return result.profile;
  }

  public async listBooks(sessionToken: string, input: BookListInput): Promise<BookListResult> {
    const auth = await this.accounts.authenticateToken(sessionToken);
    if (auth === null) throw new DomainError("AUTHENTICATION_REQUIRED", "请先登录。");
    const normalized = normalizeListInput(input, auth.ownerId);
    const rows = await this.repository.withTransaction(async (client) => this.repository.listBooks(client, {
      ownerId: auth.ownerId,
      status: normalized.status,
      q: normalized.q,
      limit: normalized.limit,
      cursor: normalized.cursor
    }));
    const page = rows.slice(0, normalized.limit);
    const nextCursor = rows.length > normalized.limit && page.length > 0
      ? encodeCursor({
        ownerId: auth.ownerId,
        status: normalized.status,
        q: normalized.q,
        createdAt: page[page.length - 1]!.createdAt.toISOString(),
        bookId: page[page.length - 1]!.bookId
      })
      : null;
    return { books: page.map(publicBook), nextCursor };
  }

  public async archiveBook(sessionToken: string, bookId: string, input: BookLifecycleRequest): Promise<PublicBookRecord> {
    return this.setBookStatus(sessionToken, bookId, "archived", input.expectedVersion, "book_archived");
  }

  public async restoreBook(sessionToken: string, bookId: string, input: BookLifecycleRequest): Promise<PublicBookRecord> {
    return this.setBookStatus(sessionToken, bookId, "active", input.expectedVersion, "book_restored");
  }

  private async setBookStatus(
    sessionToken: string,
    bookId: string,
    targetStatus: "active" | "archived",
    expectedVersion: number,
    eventType: "book_archived" | "book_restored"
  ): Promise<PublicBookRecord> {
    const normalizedBookId = parseBookId(bookId);
    const version = validateExpectedVersion(expectedVersion);
    const result = await this.accounts.withAuthenticatedSessionTransaction(sessionToken, async (client, session) => {
      const book = await this.repository.findByOwnerAndBookId(client, session.account.ownerId, normalizedBookId, true);
      if (book === null) return { kind: "not-found" as const };
      if (book.version !== version) {
        await this.audit(client, eventType, "rejected", session, book.bookId, {
          reason: "version_conflict",
          expectedVersion: version,
          currentVersion: book.version
        });
        return { kind: "conflict" as const };
      }
      if (book.status === targetStatus) {
        return { kind: "ok" as const, book: publicBook(book) };
      }
      const updated = await this.repository.updateBookStatus(client, session.account.ownerId, book.bookId, targetStatus);
      await this.audit(client, eventType, "succeeded", session, updated.bookId, {
        previousVersion: book.version,
        nextVersion: updated.version
      });
      return { kind: "ok" as const, book: publicBook(updated) };
    });
    if (result.kind === "not-found") throw new DomainError("BOOK_NOT_FOUND", "没有找到这本书。");
    if (result.kind === "conflict") throw new DomainError("BOOK_VERSION_CONFLICT", "书籍已经更新，请刷新后重试。");
    return result.book;
  }

  private async readManualBookInsideTransaction(
    client: PgClient,
    session: AuthenticatedAccountSession,
    bookId: string
  ): Promise<ManualBookRead | null> {
    const book = await this.repository.findByOwnerAndBookId(client, session.account.ownerId, bookId, false);
    if (book === null) return null;
    const source = await this.repository.findManualOpeningSource(client, session.account.ownerId, book.bookId);
    const directory = await this.repository.findManualChapterDirectory(client, session.account.ownerId, book.bookId);
    if (source === null || directory === null) return null;
    return manualBookRead(book, source, directory);
  }

  private async audit(
    client: PgClient,
    eventType: string,
    result: "succeeded" | "failed" | "rejected",
    session: AuthenticatedAccountSession,
    bookId: string | null,
    detail: Record<string, unknown>
  ): Promise<void> {
    await this.repository.recordAudit(client, {
      auditId: randomUUID(),
      bookId,
      ownerId: session.account.ownerId,
      actorUserId: session.account.userId,
      eventType,
      result,
      detail
    });
  }
}

export function createBookShelfService(pool: PgPool, accounts: AccountCoreService): BookShelfService {
  return new BookShelfService(pool, accounts);
}

function normalizeBookTitle(title: string): string {
  const parsed = bookRecordSchema.shape.title.safeParse(title);
  if (!parsed.success) throw new DomainError("BOOK_INPUT_INVALID", "书名没有通过检查。");
  return parsed.data;
}

function normalizeIdempotencyKey(key: string): string {
  const value = key.trim();
  if (Array.from(value).length < 1 || Array.from(value).length > 160 || value.includes("\u0000")) {
    throw new DomainError("BOOK_INPUT_INVALID", "建书请求编号没有通过检查。");
  }
  return value;
}

function normalizeListInput(input: BookListInput, ownerId: string): NormalizedBookListInput {
  const parsed = bookListQuerySchema.safeParse(input);
  if (!parsed.success) throw new DomainError("BOOK_INPUT_INVALID", "书架查询参数没有通过检查。");
  const q = parsed.data.q?.trim() ?? "";
  const normalized: NormalizedBookListInput = {
    status: parsed.data.status ?? "all",
    q: q.length === 0 ? null : q,
    limit: parsed.data.limit ?? 50,
    cursor: parsed.data.cursor === undefined ? null : decodeCursor(parsed.data.cursor, ownerId, parsed.data.status ?? "all", q.length === 0 ? null : q)
  };
  return normalized;
}

function validateExpectedVersion(version: number): number {
  const parsed = bookLifecycleRequestSchema.shape.expectedVersion.safeParse(version);
  if (!parsed.success) throw new DomainError("BOOK_INPUT_INVALID", "书籍版本没有通过检查。");
  return parsed.data;
}

function parseBookId(bookId: string): string {
  const parsed = bookRecordSchema.shape.bookId.safeParse(bookId);
  if (!parsed.success) throw new DomainError("BOOK_NOT_FOUND", "没有找到这本书。");
  return parsed.data;
}

function publicBook(book: BookRecord): PublicBookRecord {
  return bookRecordSchema.parse({
    bookId: book.bookId,
    title: book.title,
    status: book.status,
    version: book.version,
    updatedAt: book.updatedAt.toISOString()
  }) satisfies PublicBookContract;
}

function manualBookRead(
  book: BookRecord,
  source: ManualBookSourceRecord,
  directory: ManualBookChapterDirectoryRecord
): ManualBookRead {
  return manualBookReadSchema.parse({
    book: publicBook(book),
    source: {
      sourceVersion: source.sourceVersion,
      sourceType: source.sourceType,
      openingIdea: source.openingIdea,
      openingPackage: source.openingPackage,
      createdAt: source.createdAt.toISOString()
    },
    chapterDirectory: {
      directoryVersion: directory.directoryVersion,
      entryCount: directory.entryCount,
      updatedAt: directory.updatedAt.toISOString()
    }
  });
}

function profileFromManualPackage(
  book: BookRecord,
  openingPackage: OpeningPackage,
  openingIdea: string | null,
  version: number
): BookProfile {
  const channel = openingPackage.positioning.channel === "female" ? "female" : "male";
  const blueprint = preserveServerOpeningIdea({
    creationMode: "new",
    taxonomyVersion: OPENING_TAXONOMY.version,
    channel,
    categoryKey: categoryKeyFor(channel, openingPackage.positioning.category),
    auxiliaryCategoryKeys: [],
    targetAudience: openingPackage.positioning.targetReaders ?? "",
    planningProfile: {
      publishingPlatform: openingPackage.positioning.publishingPlatform,
      expectedTotalWords: openingPackage.positioning.expectedTotalWords,
      ...(openingPackage.positioning.volumePlan === undefined ? {} : { volumePlan: openingPackage.positioning.volumePlan }),
      ...(openingPackage.positioning.targetReaders === undefined ? {} : { commercialAudience: openingPackage.positioning.targetReaders }),
      ...(openingPackage.positioning.retentionPositioning === undefined ? {} : { retentionPositioning: openingPackage.positioning.retentionPositioning })
    },
    protagonists: openingPackage.protagonists.map((item, index) => ({
      role: protagonistRole(channel, index, item.identity),
      name: item.name,
      age: item.age,
      background: item.background,
      familyBackground: item.familyBackground ?? item.background,
      careerBackground: item.careerBackground ?? item.identity,
      goldenFinger: item.goldenFinger ?? "",
      ...(item.visualIdentity === undefined ? {} : { visualIdentity: item.visualIdentity }),
      personalities: [...item.personality]
    })),
    storyDirection: openingPackage.longTermDirection.centralConflict,
    openingStart: "",
    storyEnding: openingPackage.possibleEnding.direction,
    worldBackground: openingPackage.backgrounds.eraAndWorld,
    openingBackground: "",
    stageOne: {
      start: "",
      development: "",
      end: ""
    },
    fullBookOutline: [
      openingPackage.longTermDirection.centralConflict,
      openingPackage.possibleEnding.direction
    ].filter(Boolean).join("\n"),
    mainTags: [...openingPackage.positioning.tags],
    auxiliaryTags: [...openingPackage.positioning.genres],
    storyTraits: openingPackage.positioning.coreAppeal.length === 0 ? [] : [openingPackage.positioning.coreAppeal],
    customTags: [],
    mustFollow: manualMustFollow(openingPackage)
  }, openingIdea);
  return profileFromBlueprint(book.title, blueprint, version, null, openingPackage.positioning.category);
}

function profileFromBlueprint(
  title: string,
  blueprint: BookOpeningBlueprint,
  version: number,
  previous: BookProfile | null,
  categoryFallback = ""
): BookProfile {
  const channel = blueprint.channel === "female" ? "女频" : "男频";
  const category = categoryNameFor(blueprint.channel ?? "male", blueprint.categoryKey) || previous?.category || categoryFallback;
  return bookProfileSchema.parse({
    title,
    channel,
    category,
    subjects: [...(blueprint.auxiliaryTags ?? previous?.subjects ?? [])],
    mainTags: [...(blueprint.mainTags ?? previous?.mainTags ?? [])],
    customTags: [...(blueprint.customTags ?? previous?.customTags ?? [])],
    protagonists: [...(blueprint.protagonists ?? previous?.protagonists ?? [])],
    synopsis: blueprint.fullBookOutline ?? previous?.synopsis ?? "",
    storyDirection: blueprint.storyDirection ?? previous?.storyDirection ?? "",
    openingStart: blueprint.openingStart ?? previous?.openingStart ?? "",
    storyEnding: blueprint.storyEnding ?? previous?.storyEnding ?? "",
    stylePrimary: blueprint.stylePrimary ?? previous?.stylePrimary ?? "",
    styleSecondary: blueprint.styleSecondary ?? previous?.styleSecondary ?? "",
    mustFollow: [...(blueprint.mustFollow ?? previous?.mustFollow ?? [])],
    style: blueprint.styleIntent ?? previous?.style ?? { languageTones: [], emotionalTones: [], pacingAndPayoff: [], atmospheres: [], custom: [] },
    source: previous?.source ?? "manual_opening_package",
    version,
    openingBlueprint: blueprint
  });
}

function preserveServerOpeningIdea(blueprint: BookOpeningBlueprint, openingIdea: string | null): BookOpeningBlueprint {
  const { openingIdea: _clientOpeningIdea, ...rest } = blueprint;
  return {
    ...rest,
    ...(openingIdea === null ? {} : { openingIdea })
  };
}

function profileFingerprint(profile: BookProfile): string {
  const { version: _version, ...withoutVersion } = profile;
  return stableStringify(withoutVersion);
}

function parseManualCreate(input: CreateManualBookFromSessionInput): ManualBookCreate {
  const parsed = manualBookCreateSchema.safeParse(input);
  if (!parsed.success) throw new DomainError("BOOK_INPUT_INVALID", "手动建书内容没有通过检查。");
  if (Array.from(stableStringify({
    openingIdea: parsed.data.openingIdea ?? null,
    openingPackage: parsed.data.openingPackage
  })).length > 256_000) {
    throw new DomainError("BOOK_INPUT_INVALID", "手动建书内容过大。");
  }
  return parsed.data;
}

function validatePublicManualOpening(openingPackage: OpeningPackage): void {
  const titleLength = Array.from(openingPackage.title.trim()).length;
  const channel = openingPackage.positioning.channel;
  const categoryValid = (channel === "male" || channel === "female") && OPENING_TAXONOMY.categories.some((item) => (
    item.channel === channel && item.name === openingPackage.positioning.category
  ));
  const mustFollow = openingPackage.mustFollow ?? [];
  const endingLength = Array.from(openingPackage.possibleEnding.direction.trim()).length;
  const protagonists = openingPackage.protagonists;
  const invalid = titleLength < 2 ||
    titleLength > 15 ||
    channel === "general" ||
    !categoryValid ||
    openingPackage.positioning.expectedTotalWords < 100_000 ||
    openingPackage.positioning.expectedTotalWords > 10_000_000 ||
    protagonists.length < 1 ||
    protagonists.length > 2 ||
    protagonists.some((item) => item.name.trim().length === 0 ||
      item.age.trim().length === 0 ||
      item.background.trim().length === 0 ||
      item.personality.length === 0) ||
    mustFollow.length < 1 ||
    mustFollow.length > 15 ||
    endingLength === 1;
  if (invalid) throw new DomainError("BOOK_INPUT_INVALID", "手动开书内容没有通过检查。");
}

function hashIdempotencyInput(input: unknown): string {
  return createHash("sha256").update(stableStringify(input)).digest("hex");
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, entryValue]) => entryValue !== undefined)
    .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0);
  return `{${entries.map(([key, entryValue]) => `${JSON.stringify(key)}:${stableStringify(entryValue)}`).join(",")}}`;
}

function encodeCursor(cursor: BookListCursor): string {
  return Buffer.from(JSON.stringify({ v: 1, ...cursor }), "utf8").toString("base64url");
}

function decodeCursor(
  value: string,
  ownerId: string,
  status: BookListStatusFilter,
  q: string | null
): BookListCursor {
  try {
    if (!/^[A-Za-z0-9_-]+$/.test(value)) throw new Error("cursor encoding");
    const parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as Partial<BookListCursor> & { v?: unknown };
    const parsedDate = typeof parsed.createdAt === "string" ? new Date(parsed.createdAt) : null;
    if (
      parsed.v !== 1 ||
      parsed.ownerId !== ownerId ||
      parsed.status !== status ||
      parsed.q !== q ||
      typeof parsed.createdAt !== "string" ||
      !validCursorIsoTimestamp(parsed.createdAt) ||
      parsedDate === null ||
      Number.isNaN(parsedDate.getTime()) ||
      parsedDate.toISOString() !== parsed.createdAt ||
      typeof parsed.bookId !== "string" ||
      !bookRecordSchema.shape.bookId.safeParse(parsed.bookId).success
    ) {
      throw new Error("cursor mismatch");
    }
    return {
      ownerId,
      status,
      q,
      createdAt: parsed.createdAt,
      bookId: parsed.bookId
    };
  } catch {
    throw new DomainError("BOOK_INPUT_INVALID", "书架分页游标没有通过检查。");
  }
}

function validCursorIsoTimestamp(value: string): boolean {
  const match = /^(\d{4})-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.exec(value);
  if (match === null) return false;
  const year = Number(match[1]);
  return year >= 1 && year <= 9999;
}

function categoryKeyFor(channel: "male" | "female", name: string): string {
  return OPENING_TAXONOMY.categories.find((entry) => entry.channel === channel && entry.name === name)?.key ?? "";
}

function categoryNameFor(channel: "male" | "female" | "general", key: string | undefined): string {
  if (channel === "general" || key === undefined) return "";
  return OPENING_TAXONOMY.categories.find((entry) => entry.channel === channel && entry.key === key)?.name ?? "";
}

function protagonistRole(channel: "male" | "female", index: number, identity: string): string {
  const selectedRoles: Record<string, string> = {
    "男主": "male_lead", "女主": "female_lead", "共同主角": "co_lead",
    "群像主角": "ensemble", "非人主角": "non_human"
  };
  if (Object.hasOwn(selectedRoles, identity)) return selectedRoles[identity]!;
  if (index === 0) return channel === "female" ? "female_lead" : "male_lead";
  if (index === 1) return channel === "female" ? "male_lead" : "female_lead";
  return "co_lead";
}

function manualMustFollow(openingPackage: OpeningPackage): string[] {
  const boundaries = openingPackage.protagonists
    .filter((item) => item.boundary.trim().length > 0)
    .map((item) => `${item.name}：${item.boundary}`);
  const merged = [...new Set([...(openingPackage.mustFollow ?? []), ...boundaries])];
  return merged.length > 0 ? merged : ["作者原始开书思路不得被后续设计覆盖；未确认细节保持开放"];
}
