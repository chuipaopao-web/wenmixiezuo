import { UnifiedAgentGovernance } from './UnifiedAgentGovernance';

/**
 * 成员治理只负责成员、岗位、模型路由和运行参数。
 * 岗位、工位、题材人设与 Skill 的提示词版本统一在“提示词与上下文中心”管理，
 * 不再给某个成员保存永久创作倾向。
 */
export function AgentGovernancePage(): React.JSX.Element {
  return <UnifiedAgentGovernance />;
}
