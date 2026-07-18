import type { ModelRuntimeConfig } from '../../infrastructure/models/model-runtime-config.js';
import type { ModelAssetRegistry } from '../../infrastructure/capabilities/model-asset-registry.js';
import type { RuntimeCapabilityProbe } from '../../infrastructure/capabilities/runtime-capability-probe.js';

export class CapabilityService {
  public constructor(
    private readonly runtimeProbe: RuntimeCapabilityProbe,
    private readonly assetRegistry: ModelAssetRegistry,
    private readonly modelRuntime: ModelRuntimeConfig,
    private readonly releaseId = 'unknown'
  ) {}

  public async snapshot() {
    const runtime = this.runtimeProbe.snapshot();
    const modelAssets = await this.assetRegistry.inspect();
    const missingDependencies: string[] = runtime.dependencies.filter((dependency) => dependency.status === 'missing').map((dependency) => dependency.capability);
    const embeddingAssetReady = modelAssets.some((asset) => asset.kind === 'embedding' && asset.status === 'verified');
    const vectorRuntimeReady = runtime.dependencies.find((dependency) => dependency.capability === 'vector-store')?.status === 'available'
      && runtime.dependencies.find((dependency) => dependency.capability === 'embedding-runtime')?.status === 'available';
    if (!embeddingAssetReady) missingDependencies.push('embedding-asset');
    return {
      releaseId: this.releaseId,
      checkedAt: new Date().toISOString(),
      ...runtime,
      modelAssets,
      modelRuntime: {
        requestedMode: this.modelRuntime.requestedMode,
        activeMode: this.modelRuntime.activeMode,
        strictPlanOnly: this.modelRuntime.strictPlanOnly,
        cashFallbackAllowed: this.modelRuntime.cashFallbackAllowed,
        missingCredentials: this.modelRuntime.missingCredentials,
        profiles: this.modelRuntime.publicProfiles
      },
      degradation: {
        active: missingDependencies.length > 0 || modelAssets.some((asset) => asset.status !== 'verified'),
        missingCapabilities: missingDependencies,
        vectorSearchAvailable: vectorRuntimeReady && embeddingAssetReady,
        vectorRuntimeReady,
        embeddingAssetReady,
        localModelAssetsReady: modelAssets.some((asset) => asset.kind === 'local-utility' && asset.status === 'verified')
      }
    };
  }
}
