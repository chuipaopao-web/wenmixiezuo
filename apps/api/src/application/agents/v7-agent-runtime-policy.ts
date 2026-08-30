import type { DatabaseSync } from 'node:sqlite';
import type { V7AgentTaskKind } from '@wenmi/v7-backend';
import { V7AgentGovernanceRepository } from '../../infrastructure/db/repositories/v7-agent-governance-repository.js';

export interface V7ResolvedRuntimePolicy {
  governanceRevision: number;
  temperature: number;
}

export function resolveV7TaskPolicy(
  database: DatabaseSync,
  memberKey: string,
  taskKind: V7AgentTaskKind
): V7ResolvedRuntimePolicy {
  return new V7AgentGovernanceRepository(database).resolveTaskPolicy(memberKey, taskKind);
}
