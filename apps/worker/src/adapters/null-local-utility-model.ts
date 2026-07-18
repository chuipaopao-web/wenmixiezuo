import type { LocalUtilityModel, LocalUtilityRequest, LocalUtilityCandidate } from '../contracts/local-utility-model.js';

export class NullLocalUtilityModel implements LocalUtilityModel {
  public readonly available = false;
  public readonly modelSnapshotId = 'none';
  public constructor(public readonly degradationReason = 'LOCAL_UTILITY_MODEL_UNAVAILABLE') {}
  public async infer(_request: LocalUtilityRequest): Promise<LocalUtilityCandidate> { throw new Error(this.degradationReason); }
}
