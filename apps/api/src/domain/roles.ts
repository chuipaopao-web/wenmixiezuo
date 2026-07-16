export type RoleCategory = 'core' | 'specialist';

export interface RoleDefinition {
  roleTemplateId: string;
  roleKey: string;
  displayName: string;
  category: RoleCategory;
  responsibilities: string[];
  requiredCapabilities: string[];
  defaultActivation: 'resident' | 'standby';
}

export const roleDefinitions: readonly RoleDefinition[] = [
  { roleTemplateId: 'role-chief-editor', roleKey: 'chief_editor', displayName: '总编与编排', category: 'core', responsibilities: ['主持', '编排', '确认', '接管'], requiredCapabilities: ['text'], defaultActivation: 'resident' },
  { roleTemplateId: 'role-plot-architect', roleKey: 'plot_architect', displayName: '剧情架构师', category: 'core', responsibilities: ['主线', '因果', '冲突', '章纲'], requiredCapabilities: ['text'], defaultActivation: 'resident' },
  { roleTemplateId: 'role-continuity', roleKey: 'continuity', displayName: '设定与连续性统筹', category: 'core', responsibilities: ['世界观', '时间线', '人物状态'], requiredCapabilities: ['text'], defaultActivation: 'resident' },
  { roleTemplateId: 'role-writer', roleKey: 'writer', displayName: '主笔', category: 'core', responsibilities: ['完整章节', '定点重写'], requiredCapabilities: ['text'], defaultActivation: 'resident' },
  { roleTemplateId: 'role-reviewer', roleKey: 'reviewer', displayName: '审校', category: 'core', responsibilities: ['逻辑', '人物', '文风', '正史'], requiredCapabilities: ['text'], defaultActivation: 'resident' },
  { roleTemplateId: 'role-reader-experience', roleKey: 'reader_experience', displayName: '读者体验与情绪专家', category: 'specialist', responsibilities: ['情绪曲线', '钩子', '读者期待'], requiredCapabilities: ['text'], defaultActivation: 'standby' },
  { roleTemplateId: 'role-style-editor', roleKey: 'style_editor', displayName: '文风编辑与去AI味专家', category: 'specialist', responsibilities: ['文体', '对白', '语言精修'], requiredCapabilities: ['text'], defaultActivation: 'standby' },
  { roleTemplateId: 'role-researcher', roleKey: 'researcher', displayName: '资料研究与考据专家', category: 'specialist', responsibilities: ['研究', '考据', '来源'], requiredCapabilities: ['text', 'research'], defaultActivation: 'standby' },
  { roleTemplateId: 'role-copyright', roleKey: 'copyright', displayName: '版权与原创安全专家', category: 'specialist', responsibilities: ['版权', '原创', '干净室'], requiredCapabilities: ['text'], defaultActivation: 'standby' }
] as const;

