import { z } from "zod";

export const serviceNameSchema = z.enum(["author-web", "admin-web", "api", "worker"]);

export const foundationStatusSchema = z.object({
  service: serviceNameSchema,
  rebuildEnvironment: z.literal("rebuild-local"),
  foundation: z.literal("batch-108"),
  database: z.object({
    required: z.literal(true),
    configured: z.boolean(),
    marker: z.literal("wenmi-rebuild-local-v1")
  }),
  capabilities: z.object({
    login: z.enum(["implemented", "not-implemented"]),
    registration: z.literal("not-implemented"),
    taskExecution: z.literal("not-implemented"),
    migrations: z.literal("implemented")
  })
});

export const safeErrorResponseSchema = z.object({
  code: z.string().min(1),
  message: z.string().min(1),
  retryable: z.boolean()
});

export const accountRoleSchema = z.enum(["user", "admin"]);
export const accountStatusSchema = z.enum(["active", "suspended"]);
export const accountEmailSchema = z.string()
  .trim()
  .toLowerCase()
  .pipe(z.email().max(254));
export const accountDisplayNameSchema = z.string()
  .trim()
  .refine((value) => {
    const length = Array.from(value).length;
    return length >= 1 && length <= 80;
  }, "displayName must contain 1 to 80 Unicode characters");

export const publicAccountSchema = z.object({
  userId: z.uuid(),
  email: accountEmailSchema,
  displayName: accountDisplayNameSchema,
  role: accountRoleSchema,
  status: accountStatusSchema,
  emailVerified: z.boolean()
});

export const authSessionResultSchema = z.object({
  account: publicAccountSchema,
  expiresInSeconds: z.number().int().positive()
});

export const currentAccountSchema = publicAccountSchema;

export const passwordChangedSchema = z.object({
  changed: z.literal(true),
  revokedSessions: z.number().int().min(0)
});

export const revokeOtherSessionsSchema = z.object({
  revoked: z.number().int().min(0)
});

export const accountProfileSchema = z.object({
  displayName: accountDisplayNameSchema,
  profileVersion: z.number().int().positive().max(2_147_483_647)
});

export const accountProfileUpdateSchema = z.strictObject({
  displayName: accountDisplayNameSchema,
  expectedVersion: z.number().int().positive().max(2_147_483_647)
});

export const bookTitleSchema = z.string()
  .trim()
  .refine((value) => {
    const length = Array.from(value).length;
    return length >= 1 && length <= 200 && !value.includes("\u0000");
  }, "book title must contain 1 to 200 Unicode characters");

export const bookStatusSchema = z.enum(["active", "archived"]);
export const bookListStatusFilterSchema = z.enum(["all", "active", "archived"]);

export const bookRecordSchema = z.object({
  bookId: z.uuid(),
  title: bookTitleSchema,
  status: bookStatusSchema,
  version: z.number().int().positive().max(2_147_483_647),
  updatedAt: z.iso.datetime()
});

export const bookListQuerySchema = z.strictObject({
  status: bookListStatusFilterSchema.optional(),
  q: z.string().refine((value) => Array.from(value).length <= 200 && !value.includes("\u0000"), "q must contain at most 200 Unicode characters").optional(),
  limit: z.coerce.number().int().positive().max(100).optional(),
  cursor: z.string().min(1).max(2048).regex(/^[A-Za-z0-9_-]+$/).optional()
});

export const bookLifecycleRequestSchema = z.strictObject({
  expectedVersion: z.number().int().positive().max(2_147_483_647)
});

export type ServiceName = z.infer<typeof serviceNameSchema>;
export type FoundationStatus = z.infer<typeof foundationStatusSchema>;
export type SafeErrorResponse = z.infer<typeof safeErrorResponseSchema>;
export type PublicAccount = z.infer<typeof publicAccountSchema>;
export type AuthSessionResult = z.infer<typeof authSessionResultSchema>;
export type AccountProfile = z.infer<typeof accountProfileSchema>;
export type AccountProfileUpdate = z.infer<typeof accountProfileUpdateSchema>;
export type BookRecord = z.infer<typeof bookRecordSchema>;
export type BookListQuery = z.infer<typeof bookListQuerySchema>;
export type BookLifecycleRequest = z.infer<typeof bookLifecycleRequestSchema>;
