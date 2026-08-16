import type { FastifyInstance } from 'fastify';
import { success } from '../contracts/api.js';
import { DomainError } from '../domain/errors.js';
import { isMembershipPlan, MembershipService } from '../infrastructure/security/membership-service.js';
import { AccountAuthService } from '../infrastructure/security/account-auth-service.js';
import { requireAdministrator, requireAuthenticatedAccount, requireAuthenticatedOwner } from '../infrastructure/security/auth-context.js';

export async function registerAccountRoutes(app: FastifyInstance, accounts: AccountAuthService, memberships: MembershipService): Promise<void> {
  app.post<{
    Body: { email: string; password: string; displayName?: string };
  }>('/api/v1/auth/register', { config: { rateLimit: { max: 3, timeWindow: '5 minutes' } } }, async (request, reply) => {
    const issued = await accounts.register(readCredentials(request.body, true));
    reply.header('Set-Cookie', issued.cookie);
    reply.header('Cache-Control', 'no-store');
    return success({ account: issued.account, expiresInSeconds: issued.expiresInSeconds }, request.id);
  });

  app.post<{
    Body: { email: string; password: string };
  }>('/api/v1/auth/login', { config: { rateLimit: { max: 10, timeWindow: '5 minutes' } } }, async (request, reply) => {
    const issued = await accounts.login(readCredentials(request.body, false));
    reply.header('Set-Cookie', issued.cookie);
    reply.header('Cache-Control', 'no-store');
    return success({ account: issued.account, expiresInSeconds: issued.expiresInSeconds }, request.id);
  });

  app.post('/api/v1/auth/logout', async (request, reply) => {
    const account = requireAuthenticatedAccount(request);
    reply.header('Set-Cookie', accounts.logout(account));
    reply.header('Cache-Control', 'no-store');
    return success({ loggedOut: true }, request.id);
  });

  app.get('/api/v1/auth/me', async (request) => {
    const account = requireAuthenticatedAccount(request);
    return success({
      userId: account.userId,
      email: account.email,
      displayName: account.displayName,
      role: account.role,
      status: 'active'
    }, request.id);
  });

  app.get('/api/v1/admin/overview', async (request) => {
    requireAdministrator(request);
    return success(accounts.overview(), request.id);
  });

  app.get<{
    Querystring: { query?: string; status?: string; offset?: string; limit?: string };
  }>('/api/v1/admin/users', async (request) => {
    requireAdministrator(request);
    return success(accounts.listUsers(parseAdminListQuery(request.query)), request.id);
  });

  app.patch<{
    Params: { userId: string };
    Body: { status: 'active' | 'suspended' };
  }>('/api/v1/admin/users/:userId/status', async (request) => {
    const administrator = requireAdministrator(request);
    const status = request.body?.status;
    if (status !== 'active' && status !== 'suspended') {
      throw new DomainError('INVALID_ACCOUNT_STATUS', '请选择启用或暂停账号', {}, false, 400);
    }
    return success(accounts.setUserStatus(administrator, request.params.userId, status), request.id);
  });

  app.get('/api/v1/membership/me', async (request) => {
    const owner = requireAuthenticatedOwner(request);
    return success(memberships.statusForOwner(owner.ownerId), request.id);
  });

  app.get<{
    Querystring: { query?: string; status?: string; offset?: string; limit?: string };
  }>('/api/v1/admin/memberships', async (request) => {
    requireAdministrator(request);
    return success(memberships.listUsersWithMembership(parseAdminListQuery(request.query)), request.id);
  });

  app.post<{
    Params: { userId: string };
    Body: { plan?: string };
  }>('/api/v1/admin/memberships/:userId', async (request) => {
    const administrator = requireAdministrator(request);
    const plan = request.body?.plan;
    if (!isMembershipPlan(plan)) {
      throw new DomainError('INVALID_MEMBERSHIP_PLAN', '请选择包月、包季或包年套餐', {}, false, 400);
    }
    return success(memberships.grant(administrator.userId, request.params.userId, plan), request.id);
  });

  app.post<{
    Params: { userId: string };
  }>('/api/v1/admin/memberships/:userId/revoke', async (request) => {
    const administrator = requireAdministrator(request);
    memberships.revoke(administrator.userId, request.params.userId);
    return success({ revoked: true }, request.id);
  });
}

function parseAdminListQuery(input: { query?: string; status?: string; offset?: string; limit?: string }): {
  query?: string; status?: string; offset?: number; limit?: number;
} {
  const result: { query?: string; status?: string; offset?: number; limit?: number } = {};
  if (input.query !== undefined) result.query = input.query;
  if (input.status !== undefined) result.status = input.status;
  const rawOffset = input.offset === undefined ? undefined : Number(input.offset);
  if (rawOffset !== undefined && Number.isInteger(rawOffset)) result.offset = Math.max(rawOffset, 0);
  const rawLimit = input.limit === undefined ? undefined : Number(input.limit);
  if (rawLimit !== undefined && Number.isInteger(rawLimit)) result.limit = Math.min(Math.max(rawLimit, 1), 100);
  return result;
}

function readCredentials(input: unknown, includeDisplayName: boolean): { email: string; password: string; displayName?: string } {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) {
    throw new DomainError('INVALID_ACCOUNT_INPUT', '请填写邮箱和密码', {}, false, 400);
  }
  const body = input as Record<string, unknown>;
  const result: { email: string; password: string; displayName?: string } = {
    email: typeof body.email === 'string' ? body.email : '',
    password: typeof body.password === 'string' ? body.password : ''
  };
  if (result.email.length === 0 || result.password.length === 0) {
    throw new DomainError('INVALID_ACCOUNT_INPUT', '请填写邮箱和密码', {}, false, 400);
  }
  if (includeDisplayName && typeof body.displayName === 'string') result.displayName = body.displayName;
  return result;
}