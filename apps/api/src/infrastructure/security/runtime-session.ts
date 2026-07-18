import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

const SESSION_COOKIE = 'wenmi_session';

interface SessionPayload {
  expiresAt: number;
  nonce: string;
}

export class RuntimeSessionService {
  readonly #secret = randomBytes(32);

  public constructor(private readonly ttlSeconds = 30 * 60) {}

  public issue(now = Date.now()): { token: string; cookie: string; expiresInSeconds: number } {
    const payload: SessionPayload = {
      expiresAt: now + this.ttlSeconds * 1_000,
      nonce: randomBytes(16).toString('base64url')
    };
    const encoded = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
    const signature = this.sign(encoded);
    const token = `${encoded}.${signature}`;
    return {
      token,
      cookie: `${SESSION_COOKIE}=${token}; HttpOnly; SameSite=Strict; Path=/api/v1; Max-Age=${this.ttlSeconds}`,
      expiresInSeconds: this.ttlSeconds
    };
  }

  public validateCookie(cookieHeader: string | undefined, now = Date.now()): boolean {
    if (cookieHeader === undefined) return false;
    const token = cookieHeader.split(';').map((part) => part.trim()).find((part) => part.startsWith(`${SESSION_COOKIE}=`))?.slice(SESSION_COOKIE.length + 1);
    if (token === undefined || token.length > 1_024) return false;
    const separator = token.lastIndexOf('.');
    if (separator <= 0) return false;
    const encoded = token.slice(0, separator);
    const actual = token.slice(separator + 1);
    const expected = this.sign(encoded);
    const actualBytes = Buffer.from(actual);
    const expectedBytes = Buffer.from(expected);
    if (actualBytes.length !== expectedBytes.length || !timingSafeEqual(actualBytes, expectedBytes)) return false;
    try {
      const payload = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')) as Partial<SessionPayload>;
      return typeof payload.expiresAt === 'number' && payload.expiresAt > now && typeof payload.nonce === 'string';
    } catch {
      return false;
    }
  }

  private sign(encoded: string): string {
    return createHmac('sha256', this.#secret).update(encoded).digest('base64url');
  }
}

export function constantTimeTokenMatches(actual: string | undefined, expected: string): boolean {
  if (actual === undefined || actual.length === 0 || actual.length > 1_024) return false;
  const left = Buffer.from(actual);
  const right = Buffer.from(expected);
  return left.length === right.length && timingSafeEqual(left, right);
}
