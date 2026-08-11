import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { CapabilityService } from '../../../apps/api/src/application/capabilities/capability-service.js';
import { ModelAssetRegistry } from '../../../apps/api/src/infrastructure/capabilities/model-asset-registry.js';
import { RuntimeCapabilityProbe } from '../../../apps/api/src/infrastructure/capabilities/runtime-capability-probe.js';
import { createServer } from '../../../apps/api/src/http/server.js';
import { createTestContext, type TestContext } from '../../helpers/test-context.js';

let context: TestContext | undefined;
afterEach(() => { context?.close(); context = undefined; });

describe('本机能力探针', () => {
  it('报告SQLite、硬件、可选依赖和经过哈希验证的离线资产', async () => {
    context = createTestContext('wenmi-capabilities-');
    const assetDirectory = resolve(context.dataDir, 'cache', 'models', 'embedding-mini');
    mkdirSync(assetDirectory, { recursive: true });
    const bytes = Buffer.from('deterministic-local-model-fixture', 'utf8');
    writeFileSync(resolve(assetDirectory, 'model.bin'), bytes);
    writeFileSync(resolve(assetDirectory, 'asset.json'), JSON.stringify({
      assetId: 'embedding-mini', kind: 'embedding', modelId: 'fixture-embedding', revision: '1',
      license: 'test-only', capabilities: ['embedding', 'local-utility'],
      files: [{ path: 'model.bin', sha256: createHash('sha256').update(bytes).digest('hex') }]
    }));

    const snapshot = await new CapabilityService(
      new RuntimeCapabilityProbe(context.database, context.dataDir),
      new ModelAssetRegistry(context.dataDir),
      context.config.modelRuntime
    ).snapshot();

    expect(snapshot.runtime).toMatchObject({ platform: process.platform, architecture: process.arch, logicalCpuCount: expect.any(Number) });
    expect(snapshot.runtime.totalMemoryBytes).toBeGreaterThan(0);
    expect(snapshot.runtime.dataVolumeFreeBytes).toBeGreaterThan(0);
    expect(snapshot.sqlite).toMatchObject({ foreignKeys: true, trustedSchema: false, json: true, fts5: true });
    expect(snapshot.dependencies).toEqual(expect.arrayContaining([
      expect.objectContaining({ capability: 'vector-store', packageName: '@lancedb/lancedb', status: expect.stringMatching(/available|missing/) }),
      expect.objectContaining({ capability: 'local-inference', packageName: 'onnxruntime-node', status: expect.stringMatching(/available|missing/) })
    ]));
    expect(snapshot.modelAssets).toContainEqual(expect.objectContaining({ assetId: 'embedding-mini', status: 'verified', filesVerified: 1 }));
    expect(snapshot.degradation).toMatchObject({ vectorSearchAvailable: true, vectorRuntimeReady: true,
      embeddingAssetReady: true, localModelAssetsReady: true });
    expect(JSON.stringify(snapshot)).not.toContain(context.dataDir);
    expect(JSON.stringify(snapshot)).not.toContain(context.config.workerToken);
  });

  it('通过受登录保护的能力接口公开脱敏快照', async () => {
    context = createTestContext('wenmi-capabilities-route-');
    const app = await createServer(context.config, context.database);
    try {
      const host = '127.0.0.1:43111';
      const origin = context.config.webOrigin;
      expect((await app.inject({ method: 'GET', url: '/api/v1/capabilities', headers: { host } })).statusCode).toBe(401);
      const session = await app.inject({
        method: 'POST', url: '/api/v1/auth/register', payload: { email: 'capability@example.com', password: 'capability-pass-123', displayName: '能力测试' },
        headers: { host, origin, 'sec-fetch-site': 'same-site', 'content-type': 'application/json' }
      });
      const rawCookie = session.headers['set-cookie'];
      const cookie = (Array.isArray(rawCookie) ? rawCookie[0] : rawCookie)!.split(';', 1)[0]!;
      const response = await app.inject({ method: 'GET', url: '/api/v1/capabilities', headers: { host, cookie } });
      expect(response.statusCode).toBe(200);
      expect(response.json().data).toMatchObject({
        releaseId: context.config.releaseId,
        runtime: { nodeVersion: process.version },
        modelRuntime: { activeMode: 'deterministic', cashFallbackAllowed: false }
      });
      expect(response.body).not.toContain(context.config.workerToken);
    } finally {
      await app.close();
    }
  });
});
