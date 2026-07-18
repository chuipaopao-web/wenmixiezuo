import type { FastifyInstance } from 'fastify';
import { success } from '../contracts/api.js';
import { RuntimeSessionService } from '../infrastructure/security/runtime-session.js';
import type { CapabilityService } from '../application/capabilities/capability-service.js';

export async function registerRuntimeRoutes(app: FastifyInstance, sessions: RuntimeSessionService, capabilities: CapabilityService): Promise<void> {
  app.post('/api/v1/runtime/session', async (request, reply) => {
    const issued = sessions.issue();
    reply.header('Set-Cookie', issued.cookie);
    reply.header('Cache-Control', 'no-store');
    return success({ authenticated: true, expiresInSeconds: issued.expiresInSeconds }, request.id);
  });

  app.get('/api/v1/capabilities', async (request) => success(await capabilities.snapshot(), request.id));
}
