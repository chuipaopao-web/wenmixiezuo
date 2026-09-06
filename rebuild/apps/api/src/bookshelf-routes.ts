import type { FastifyInstance, FastifyRequest } from "fastify";
import {
  bookLifecycleRequestSchema,
  bookListQuerySchema,
  bookProfileSchema,
  bookProfileUpdateRequestSchema,
  bookRecordSchema
} from "@wenmi-rebuild/contracts";
import {
  DomainError,
  type BookShelfService
} from "@wenmi-rebuild/backend";
import { registerLocalProtectedHooks, requireSessionToken } from "./local-security.js";

interface Envelope<T> {
  readonly data: T;
  readonly meta: { readonly requestId: string };
}

interface BookListEnvelope<T> {
  readonly data: T;
  readonly meta: { readonly requestId: string; readonly nextCursor: string | null };
}

export async function registerBookshelfRoutes(app: FastifyInstance, books: BookShelfService): Promise<void> {
  await app.register(async (booksApp) => {
    registerLocalProtectedHooks(booksApp);

    booksApp.get("", async (request) => {
      const token = requireSessionToken(request);
      const input = parseListQuery(request.query);
      const result = await books.listBooks(token, input);
      return listEnvelope(result.books.map((book) => bookRecordSchema.parse(book)), request, result.nextCursor);
    });

    booksApp.post<{ Params: { bookId?: unknown }; Body: unknown }>("/:bookId/archive", async (request) => {
      const token = requireSessionToken(request);
      const result = await books.archiveBook(token, readBookId(request.params.bookId), parseLifecycleRequest(request.body));
      return envelope(bookRecordSchema.parse(result), request);
    });

    booksApp.post<{ Params: { bookId?: unknown }; Body: unknown }>("/:bookId/restore", async (request) => {
      const token = requireSessionToken(request);
      const result = await books.restoreBook(token, readBookId(request.params.bookId), parseLifecycleRequest(request.body));
      return envelope(bookRecordSchema.parse(result), request);
    });

    booksApp.get<{ Params: { bookId?: unknown } }>("/:bookId/book-profile", async (request) => {
      const token = requireSessionToken(request);
      const result = await books.getBookProfileFromSession(token, readBookId(request.params.bookId));
      return envelope(bookProfileSchema.parse(result), request);
    });

    booksApp.put<{ Params: { bookId?: unknown }; Body: unknown }>("/:bookId/book-profile", {
      bodyLimit: 2 * 1024 * 1024
    }, async (request) => {
      const token = requireSessionToken(request);
      const result = await books.updateBookProfileFromSession(token, readBookId(request.params.bookId), parseProfileUpdate(request.body));
      return envelope(bookProfileSchema.parse(result), request);
    });
  }, { prefix: "/v1/v7/books" });
}

function parseListQuery(value: unknown) {
  const parsed = bookListQuerySchema.safeParse(value);
  if (!parsed.success) throw new DomainError("BOOK_INPUT_INVALID", "书架查询参数没有通过检查。");
  return parsed.data;
}

function parseLifecycleRequest(value: unknown) {
  const parsed = bookLifecycleRequestSchema.safeParse(value);
  if (!parsed.success) throw new DomainError("BOOK_INPUT_INVALID", "书籍操作请求没有通过检查。");
  return parsed.data;
}

function parseProfileUpdate(value: unknown) {
  const parsed = bookProfileUpdateRequestSchema.safeParse(value);
  if (!parsed.success) throw new DomainError("BOOK_INPUT_INVALID", "书籍资料没有通过检查。");
  return parsed.data;
}

function readBookId(value: unknown): string {
  if (typeof value !== "string") throw new DomainError("BOOK_NOT_FOUND", "没有找到这本书。");
  return value;
}

function envelope<T>(data: T, request: FastifyRequest): Envelope<T> {
  return {
    data,
    meta: { requestId: request.id }
  };
}

function listEnvelope<T>(data: T, request: FastifyRequest, nextCursor: string | null): BookListEnvelope<T> {
  return {
    data,
    meta: { requestId: request.id, nextCursor }
  };
}
