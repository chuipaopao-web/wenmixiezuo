import type { ChunkPolicy } from '../../contracts/projections.js';

export const DEFAULT_CHUNK_POLICY: ChunkPolicy = Object.freeze({
  version: 'structural-cn-v1',
  targetLeafCharacters: 520,
  maximumLeafCharacters: 700,
  maximumParentCharacters: 3_000,
  normalizationVersion: 'preserve-source-v1',
  embeddingTextPolicyVersion: 'minimal-header-v1'
});

export function validateChunkPolicy(policy: ChunkPolicy): void {
  if (!Number.isInteger(policy.targetLeafCharacters) || policy.targetLeafCharacters < 100) throw new Error('叶子块目标长度无效');
  if (!Number.isInteger(policy.maximumLeafCharacters) || policy.maximumLeafCharacters < policy.targetLeafCharacters) throw new Error('叶子块最大长度无效');
  if (!Number.isInteger(policy.maximumParentCharacters) || policy.maximumParentCharacters < policy.maximumLeafCharacters) throw new Error('父块最大长度无效');
  if ([policy.version, policy.normalizationVersion, policy.embeddingTextPolicyVersion].some((value) => value.trim().length === 0)) {
    throw new Error('切片策略版本不能为空');
  }
}
