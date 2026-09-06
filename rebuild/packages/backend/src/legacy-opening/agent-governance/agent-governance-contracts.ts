import type { V7MemberModelBinding } from '../agents/agent-roster.js';

export type V7GlobalModelBinding = V7MemberModelBinding | {
  provider: 'volcengine-ark-image';
  modelId: string;
  plan: 'image';
};

export type V7FixedRoleKey =
  | 'chief_editor'
  | 'deputy_editor'
  | 'planning_writer'
  | 'lead_writer'
  | 'independent_reviewer'
  | 'continuity_editor'
  | 'visual_renderer';

export type V7AgentTaskKind =
  | 'opening_design'
  | 'opening_review'
  | 'title_design'
  | 'setting_recommendation'
  | 'setting_design'
  | 'setting_review'
  | 'planning_context'
  | 'planning_recipe'
  | 'planning_tree'
  | 'planning_review'
  | 'planning_maintenance'
  | 'chapter_outline'
  | 'chapter_outline_review'
  | 'manuscript'
  | 'manuscript_review'
  | 'settlement'
  | 'character_context'
  | 'character_maintenance'
  | 'cover_brief'
  | 'cover_render';

export interface V7RoleContract {
  roleKey: V7FixedRoleKey;
  publicName: string;
  publicResponsibility: string;
  taskKinds: readonly V7AgentTaskKind[];
  capabilities: readonly string[];
  tools: readonly string[];
  outputContract: string;
  failureContract: string;
  authorSelectable: boolean;
}

export interface V7GlobalMemberDefinition {
  memberKey: string;
  displayName: string;
  fixedRoleKey: V7FixedRoleKey;
  modelProfileKey: string;
  model: V7GlobalModelBinding;
  fallbackPriority: number;
  defaultForRole: boolean;
  enabledByDefault: boolean;
  promptInstruction: string;
}

export interface V7TaskTemperaturePolicy {
  taskKind: V7AgentTaskKind;
  publicName: string;
  defaultTemperature: number;
  minimumTemperature: number;
  maximumTemperature: number;
  rationale: string;
}

export interface V7EffectiveMember extends V7GlobalMemberDefinition {
  enabled: boolean;
  temperatureAdjustment: number;
  governanceRevision: number;
}

export interface V7AgentTaskSnapshot {
  memberKey: string;
  displayName: string;
  fixedRoleKey: V7FixedRoleKey;
  modelProfileKey: string;
  model: V7GlobalModelBinding;
  taskKind: V7AgentTaskKind;
  temperature: number;
  governanceRevision: number;
  createdAt: string;
}
