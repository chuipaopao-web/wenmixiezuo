import type { AgentData } from '../../lib/api/client';

export function memberIdentity(agent: Pick<AgentData, 'displayName' | 'roleName'>): string {
  return agent.displayName + '（' + agent.roleName + '）';
}
