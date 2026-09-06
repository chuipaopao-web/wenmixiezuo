import type { FastifyInstance, FastifyRequest } from "fastify";
import {
  editorialDepartmentSchema,
  openingBookCreateRequestSchema,
  openingBookCreateResultSchema,
  openingTaxonomySchema
} from "@wenmi-rebuild/contracts";
import {
  DomainError,
  type BookShelfService,
  type EditorialDepartmentService
} from "@wenmi-rebuild/backend";
import { registerLocalProtectedHooks, requireSessionToken } from "./local-security.js";

interface Envelope<T> {
  readonly data: T;
  readonly meta: { readonly requestId: string };
}

export async function registerOpeningRoutes(
  app: FastifyInstance,
  books: BookShelfService,
  editorialDepartment: EditorialDepartmentService
): Promise<void> {
  await app.register(async (openingApp) => {
    registerLocalProtectedHooks(openingApp);

    openingApp.get("/opening-taxonomy", async (request) => {
      const token = requireSessionToken(request);
      return envelope(openingTaxonomySchema.parse(await books.getOpeningTaxonomy(token)), request);
    });

    openingApp.get("/editorial-department", async (request) => {
      const token = requireSessionToken(request);
      return envelope(editorialDepartmentSchema.parse(await editorialDepartment.getEditorialDepartment(token)), request);
    });

    openingApp.post<{ Body: unknown }>("/opening-books", {
      bodyLimit: 2 * 1024 * 1024
    }, async (request) => {
      const token = requireSessionToken(request);
      const parsed = openingBookCreateRequestSchema.safeParse(request.body);
      if (!parsed.success) throw new DomainError("BOOK_INPUT_INVALID", "手动开书内容没有通过检查。");
      const result = await books.confirmManualOpeningBookFromSession(token, parsed.data);
      return envelope(openingBookCreateResultSchema.parse(result), request);
    });
  }, { prefix: "/v1/v7" });
}

function envelope<T>(data: T, request: FastifyRequest): Envelope<T> {
  return { data, meta: { requestId: request.id } };
}
