export type AccountRole = "user" | "admin";
export type AccountStatus = "active" | "suspended";
export type OneTimeTokenPurpose = "email_verification" | "password_reset";

export interface AccountRecord {
  readonly userId: string;
  readonly ownerId: string;
  readonly email: string;
  readonly displayName: string;
  readonly role: AccountRole;
  readonly status: AccountStatus;
  readonly emailVerifiedAt: Date | null;
  readonly password: PasswordRecord;
  readonly credentialVersion: number;
  readonly createdAt: Date;
  readonly updatedAt: Date;
  readonly lastLoginAt: Date | null;
}

export interface PasswordRecord {
  readonly format: "scrypt-v2" | "scrypt-v1-legacy";
  readonly salt: string;
  readonly hash: string;
  readonly n: number;
  readonly r: number;
  readonly p: number;
  readonly keyLength: 64;
}

export interface PublicAccountView {
  readonly userId: string;
  readonly email: string;
  readonly displayName: string;
  readonly role: AccountRole;
  readonly status: AccountStatus;
  readonly emailVerified: boolean;
}

export interface AuthContext {
  readonly userId: string;
  readonly ownerId: string;
  readonly email: string;
  readonly displayName: string;
  readonly role: AccountRole;
  readonly sessionId: string;
  readonly credentialVersion: number;
}

export interface IssuedSession {
  readonly account: PublicAccountView;
  readonly token: string;
  readonly cookie: string;
  readonly expiresInSeconds: number;
}

export interface IssuedOneTimeToken {
  readonly tokenId: string;
  readonly userId: string;
  readonly purpose: OneTimeTokenPurpose;
  readonly token: string;
  readonly expiresAt: Date;
}
