import { DomainError, errorCodes } from '../../domain/errors.js';
import { constantTimeTokenMatches } from './account-auth-service.js';

interface FailureWindow {
  attempts: number;
  windowStartedAt: number;
  blockedUntil: number;
}

export class PromptViewAccessService {
  readonly #failures = new Map<string, FailureWindow>();

  public constructor(
    private readonly password: string | null,
    private readonly maxAttempts = 5,
    private readonly windowMs = 15 * 60_000,
    private readonly blockMs = 15 * 60_000
  ) {}

  public get configured(): boolean {
    return this.password !== null;
  }

  public verify(candidate: string | undefined, requesterKey: string, now = Date.now()): void {
    if (this.password === null) {
      throw new DomainError(
        errorCodes.operationIncomplete,
        '管理员尚未设置完整提示词查看密码。请配置环境变量 WENMI_PROMPT_VIEW_PASSWORD 后重启文秘写作。',
        {},
        false,
        409
      );
    }

    const key = requesterKey.slice(0, 256);
    const previous = this.#failures.get(key);
    if (previous !== undefined && previous.blockedUntil > now) {
      throw new DomainError(
        'PROMPT_VIEW_RATE_LIMITED',
        '密码尝试次数过多，请稍后再试。',
        { retryAfterSeconds: Math.ceil((previous.blockedUntil - now) / 1_000) },
        true,
        429
      );
    }

    if (constantTimeTokenMatches(candidate, this.password)) {
      this.#failures.delete(key);
      return;
    }

    const inWindow = previous !== undefined && now - previous.windowStartedAt < this.windowMs;
    const attempts = inWindow ? previous.attempts + 1 : 1;
    const windowStartedAt = inWindow ? previous.windowStartedAt : now;
    this.#failures.set(key, {
      attempts,
      windowStartedAt,
      blockedUntil: attempts >= this.maxAttempts ? now + this.blockMs : 0
    });
    throw new DomainError('PROMPT_VIEW_PASSWORD_INVALID', '查看密码不正确。', {}, false, 403);
  }
}
