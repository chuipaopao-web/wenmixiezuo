import type { FastifyInstance } from 'fastify';
import { success } from '../contracts/api.js';
import type { CapabilityService } from '../application/capabilities/capability-service.js';

export async function registerRuntimeRoutes(app: FastifyInstance, capabilities: CapabilityService): Promise<void> {
  app.get('/api/v1/capabilities', async (request) => {
    const snapshot = await capabilities.snapshot();
    if (request.authContext?.role !== 'admin') {
      snapshot.modelRuntime.profiles = [];
    }
    return success(snapshot, request.id);
  });
}