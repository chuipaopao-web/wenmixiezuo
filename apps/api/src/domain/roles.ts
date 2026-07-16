export type RoleCategory = 'core' | 'specialist';
export type RoleKey = 'chief_editor' | 'plot_architect' | 'continuity' | 'writer' | 'reviewer' | 'reader_experience' | 'style_editor' | 'researcher' | 'copyright';

export interface RoleDefinition {
  roleTemplateId: string;
  roleKey: RoleKey;
  displayName: string;
  memberName: string;
  category: RoleCategory;
  responsibilities: string[];
  requiredCapabilities: string[];
  defaultActivation: 'resident' | 'standby';
}

export const roleDefinitions: readonly RoleDefinition[] = [
  { roleTemplateId: 'role-chief-editor', roleKey: 'chief_editor', displayName: '主编', memberName: '貂蝉', category: 'core', responsibilities: ['主持', '编排', '确认', '接管'], requiredCapabilities: ['text'], defaultActivation: 'resident' },
  { roleTemplateId: 'role-plot-architect', roleKey: 'plot_architect', displayName: '编剧', memberName: '婉儿', category: 'core', responsibilities: ['主线', '因果', '冲突', '章纲'], requiredCapabilities: ['text'], defaultActivation: 'resident' },
  { roleTemplateId: 'role-continuity', roleKey: 'continuity', displayName: '设定师', memberName: '文姬', category: 'core', responsibilities: ['世界观', '时间线', '人物状态'], requiredCapabilities: ['text'], defaultActivation: 'resident' },
  { roleTemplateId: 'role-writer', roleKey: 'writer', displayName: '主笔', memberName: '秋香', category: 'core', responsibilities: ['完整章节', '定点重写'], requiredCapabilities: ['text'], defaultActivation: 'resident' },
  { roleTemplateId: 'role-reviewer', roleKey: 'reviewer', displayName: '审校', memberName: '妲己', category: 'core', responsibilities: ['逻辑', '人物', '文风', '正史'], requiredCapabilities: ['text'], defaultActivation: 'resident' },
  { roleTemplateId: 'role-reader-experience', roleKey: 'reader_experience', displayName: '体验官', memberName: '昭君', category: 'specialist', responsibilities: ['情绪曲线', '钩子', '读者期待'], requiredCapabilities: ['text'], defaultActivation: 'standby' },
  { roleTemplateId: 'role-style-editor', roleKey: 'style_editor', displayName: '文编', memberName: '清照', category: 'specialist', responsibilities: ['文体', '对白', '语言精修'], requiredCapabilities: ['text'], defaultActivation: 'standby' },
  { roleTemplateId: 'role-researcher', roleKey: 'researcher', displayName: '研究员', memberName: '道韫', category: 'specialist', responsibilities: ['研究', '考据', '来源'], requiredCapabilities: ['text', 'research'], defaultActivation: 'standby' },
  { roleTemplateId: 'role-copyright', roleKey: 'copyright', displayName: '版权顾问', memberName: '弄玉', category: 'specialist', responsibilities: ['版权', '原创', '干净室'], requiredCapabilities: ['text'], defaultActivation: 'standby' }
] as const;
