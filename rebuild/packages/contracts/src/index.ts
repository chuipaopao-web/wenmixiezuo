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

const openingTextSchema = (maxCharacters: number, options: { readonly requireNonBlank?: boolean } = {}) => z.string().refine((value) => {
  const length = Array.from(value).length;
  return length <= maxCharacters &&
    safePostgresJsonText(value) &&
    (options.requireNonBlank !== true || Array.from(value.trim()).length > 0);
}, `text must contain at most ${maxCharacters} Unicode characters and be safe for JSON storage`);

const openingTextArraySchema = z.array(openingTextSchema(240)).max(50);

export const openingPublishingPlatformSchema = z.enum(["fanqie", "qidian", "mainstream"]);
export const openingChannelSchema = z.enum(["male", "female", "general"]);

export const openingProtagonistSchema = z.strictObject({
  name: openingTextSchema(120),
  age: openingTextSchema(80),
  identity: openingTextSchema(500),
  background: openingTextSchema(2_000),
  familyBackground: openingTextSchema(2_000).optional(),
  careerBackground: openingTextSchema(2_000).optional(),
  goldenFinger: openingTextSchema(2_000).optional(),
  visualIdentity: z.strictObject({
    appearance: openingTextSchema(1_000),
    build: openingTextSchema(500),
    signatureFeature: openingTextSchema(500)
  }).optional(),
  goal: openingTextSchema(1_000),
  dilemma: openingTextSchema(1_000),
  personality: openingTextArraySchema,
  boundary: openingTextSchema(1_000)
});

export const openingPackageSchema = z.strictObject({
  title: openingTextSchema(200, { requireNonBlank: true }),
  positioning: z.strictObject({
    publishingPlatform: openingPublishingPlatformSchema,
    channel: openingChannelSchema,
    category: openingTextSchema(120),
    genres: openingTextArraySchema,
    tags: openingTextArraySchema,
    coreAppeal: openingTextSchema(2_000),
    targetReaders: openingTextSchema(1_000).optional(),
    expectedTotalWords: z.number().int().min(0).max(50_000_000),
    volumePlan: z.strictObject({
      minimum: z.number().int().min(0).max(500),
      recommended: z.number().int().min(0).max(500),
      maximum: z.number().int().min(0).max(500)
    }).refine((value) => value.minimum <= value.recommended && value.recommended <= value.maximum, "volume plan must be ordered").optional(),
    retentionPositioning: openingTextSchema(2_000).optional()
  }),
  backgrounds: z.strictObject({
    eraAndWorld: openingTextSchema(4_000),
    openingSituation: openingTextSchema(4_000)
  }),
  protagonists: z.array(openingProtagonistSchema).max(12),
  opening: z.strictObject({
    startingSituation: openingTextSchema(2_000),
    incitingIncident: openingTextSchema(2_000),
    immediateConflict: openingTextSchema(2_000),
    readerPromise: openingTextSchema(2_000)
  }),
  longTermDirection: z.strictObject({
    centralConflict: openingTextSchema(2_000),
    progression: openingTextSchema(2_000),
    relationshipDirection: openingTextSchema(2_000),
    storyPotential: openingTextSchema(2_000)
  }),
  possibleEnding: z.strictObject({
    direction: openingTextSchema(2_000),
    price: openingTextSchema(2_000),
    openness: openingTextSchema(2_000)
  }),
  authorNotes: z.array(openingTextSchema(2_000)).max(50),
  mustFollow: z.array(openingTextSchema(2_000)).max(50).optional(),
  authorInstructions: z.array(openingTextSchema(2_000)).max(50).optional()
});

export const manualBookCreateSchema = z.strictObject({
  openingPackage: openingPackageSchema,
  openingIdea: openingTextSchema(5_000).optional(),
  idempotencyKey: z.string().refine((value) => {
    const trimmed = value.trim();
    return Array.from(trimmed).length >= 1 && Array.from(trimmed).length <= 160 && safePostgresJsonText(value);
  }, "idempotencyKey must contain 1 to 160 Unicode characters after trimming and be safe for storage")
});

export const manualBookSourceTypeSchema = z.literal("manual_opening_package");

export const manualBookReadSchema = z.object({
  book: bookRecordSchema,
  source: z.object({
    sourceVersion: z.literal(1),
    sourceType: manualBookSourceTypeSchema,
    openingIdea: openingTextSchema(5_000).nullable(),
    openingPackage: openingPackageSchema,
    createdAt: z.iso.datetime()
  }),
  chapterDirectory: z.object({
    directoryVersion: z.literal(1),
    entryCount: z.literal(0),
    updatedAt: z.iso.datetime()
  })
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
export type OpeningPackage = z.infer<typeof openingPackageSchema>;
export type ManualBookCreate = z.infer<typeof manualBookCreateSchema>;
export type ManualBookRead = z.infer<typeof manualBookReadSchema>;

function safePostgresJsonText(value: string): boolean {
  if (value.includes("\u0000")) return false;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code >= 0xD800 && code <= 0xDBFF) {
      const next = value.charCodeAt(index + 1);
      if (!(next >= 0xDC00 && next <= 0xDFFF)) return false;
      index += 1;
      continue;
    }
    if (code >= 0xDC00 && code <= 0xDFFF) return false;
  }
  return true;
}
