import type { FastifyInstance } from 'fastify';
import { success } from '../contracts/api.js';
import { DomainError } from '../domain/errors.js';
import { AccountAuthService } from '../infrastructure/security/account-auth-service.js';
import { requireAdministrator, requireAuthenticatedAccount } from '../infrastructure/security/auth-context.js';

export async function registerAccountRoutes(app: FastifyInstance, accounts: AccountAuthService): Promise<void> {
  app.post<{
    Body: { email: string; password: string; displayName?: string };
  }>('/api/v1/auth/register', async (request, reply) => {
    const issued = await accounts.register(readCredentials(request.body, true));
    reply.header('Set-Cookie', issued.cookie);
    reply.header('Cache-Control', 'no-store');
    return success({ account: issued.account, expiresInSeconds: issued.expiresInSeconds }, request.id);
  });

  app.post<{
    Body: { email: string; password: string };
  }>('/api/v1/auth/login', async (request, reply) => {
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
    Querystring: { query?: string; status?: string };
  }>('/api/v1/admin/users', async (request) => {
    requireAdministrator(request);
    return success(accounts.listUsers(request.query), request.id);
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