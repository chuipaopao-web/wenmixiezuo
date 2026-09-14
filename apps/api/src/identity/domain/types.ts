/** AUTH-TAKEOVER-01 身份域类型（对齐 rebuild domain/accounts/types.ts 的凭据/会话语义）。 */
export type AccountRole = 'admin' | 'user';
export type AccountStatus = 'active' | 'suspended';

export interface PasswordRecord {
  readonly format: 'scrypt-v2' | 'scrypt-v1-legacy';
  readonly salt: string;
  readonly hash: string;
  readonly n: number;
  readonly r: number;
  readonly p: number;
  readonly keyLength: 64;
}

/** 会话签发结果：cookie合同沿用现行wenmi_session（HttpOnly/SameSite=Lax/14天）。 */
export interface IssuedSession {
  account: PublicAccount;
  cookie: string;
  expiresInSeconds: number;
}

export interface PublicAccount {
  userId: string;
  email: string;
  displayName: string;
  role: AccountRole;
  status: AccountStatus;
  createdAt: string;
  lastLoginAt: string | null;
}

/** 验证后的请求身份：业务路由唯一可信来源（owner映射/admin角色随会话带出）。 */
export interface AuthContext {
  userId: string;
  ownerId: string;
  email: string;
  displayName: string;
  role: AccountRole;
  sessionId: string;
  credentialVersion: number;
}
