import type { FastifyRequest } from 'fastify';
import { DomainError } from '../../domain/errors.js';
import type { OwnerScope } from '../../domain/scope.js';
import type { AuthContext, AccountRole } from '../../identity/domain/types.js';

export type { AuthContext, AccountRole };

declare module 'fastify' {
  interface FastifyRequest {
    authContext: AuthContext | null;
  }
}

export function requireAuthenticatedAccount(request: FastifyRequest): AuthContext {
  if (request.authContext === null) {
    throw new DomainError('AUTHENTICATION_REQUIRED', '请先登录文秘写作', {}, false, 401);
  }
  return request.authContext;
}

export function requireAuthenticatedOwner(request: FastifyRequest): OwnerScope {
  return { ownerId: requireAuthenticatedAccount(request).ownerId };
}

export function requireAdministrator(request: FastifyRequest): AuthContext {
  const account = requireAuthenticatedAccount(request);
  if (account.role !== 'admin') {
    throw new DomainError('ADMINISTRATOR_REQUIRED', '只有管理员可以使用这个功能', {}, false, 403);
  }
  return account;
}