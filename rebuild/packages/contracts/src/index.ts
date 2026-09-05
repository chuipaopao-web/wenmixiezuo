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
    login: z.literal("not-implemented"),
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

export type ServiceName = z.infer<typeof serviceNameSchema>;
export type FoundationStatus = z.infer<typeof foundationStatusSchema>;
export type SafeErrorResponse = z.infer<typeof safeErrorResponseSchema>;
