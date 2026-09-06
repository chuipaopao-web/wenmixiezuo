import { UnifiedAgentGovernance } from './UnifiedAgentGovernance';

/**
 * 按岗位与成员统一管理模型、共用规则和实际输入。
 * 成员详情引用同一版本化配置，不复制成员私有提示词或用户资料。
 */
export function AgentGovernancePage(): React.JSX.Element {
  return <UnifiedAgentGovernance />;
}
