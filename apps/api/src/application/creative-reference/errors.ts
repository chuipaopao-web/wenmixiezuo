/** R209-B1 创作参考库错误。模块自持错误类型，不依赖HTTP层。 */
export class CreativeReferenceError extends Error {
  public constructor(message: string, public readonly code: string) { super(message); }
}

export class ValidationError extends CreativeReferenceError { public constructor(message: string) { super(message, 'validation'); } }
export class ConflictError extends CreativeReferenceError { public constructor(message: string) { super(message, 'conflict'); } }
export class NotFoundError extends CreativeReferenceError { public constructor(message: string) { super(message, 'not-found'); } }
export class AmbiguityError extends CreativeReferenceError {
  public constructor(message: string, public readonly candidates: unknown[]) { super(message, 'ambiguity'); }
}
export class AuthorizationError extends CreativeReferenceError { public constructor(message: string) { super(message, 'forbidden'); } }
export class BudgetError extends CreativeReferenceError { public constructor(message: string) { super(message, 'budget'); } }
export class CursorInvalidError extends CreativeReferenceError { public constructor(message: string) { super(message, 'cursor-invalid'); } }
