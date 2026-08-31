export interface V7VisualMemberDefinition {
  memberKey: string;
  displayName: string;
  roleKey: 'visual_renderer';
  publicRoleName: '封面画师';
  publicResponsibility: string;
  avatarPath: string;
  provider: 'volcengine-ark-image';
  defaultModelId: string;
  plan: 'image';
  enabledByDefault: boolean;
}

/** 主编负责封面制作单，真实图片模型只负责执行并交付图片。 */
export const V7_VISUAL_MEMBERS: readonly V7VisualMemberDefinition[] = [
  {
    memberKey: 'visual-seedream',
    displayName: '绘真',
    roleKey: 'visual_renderer',
    publicRoleName: '封面画师',
    publicResponsibility: '执行已审核的构图与色彩方案，交付可保存、可下载的竖版封面候选。',
    avatarPath: '/avatars/team-collage-source.jpg',
    provider: 'volcengine-ark-image',
    defaultModelId: 'doubao-seedream-5-0-260128',
    plan: 'image',
    enabledByDefault: true
  }
] as const;
