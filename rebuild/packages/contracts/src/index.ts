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

export type ServiceName = z.infer<typeof serviceNameSchema>;
export type FoundationStatus = z.infer<typeof foundationStatusSchema>;
export type SafeErrorResponse = z.infer<typeof safeErrorResponseSchema>;
export type PublicAccount = z.infer<typeof publicAccountSchema>;
export type AuthSessionResult = z.infer<typeof authSessionResultSchema>;
