const ROLE_AVATAR_POSITION: Record<string, string> = {
  chief_editor: '0% 0%',
  plot_architect: '50% 0%',
  continuity: '100% 0%',
  writer: '0% 50%',
  reviewer: '50% 50%',
  reader_experience: '100% 50%',
  style_editor: '0% 100%',
  researcher: '50% 100%',
  copyright: '100% 100%'
};

export function avatarPosition(roleKey: string): string {
  return ROLE_AVATAR_POSITION[roleKey] ?? '50% 50%';
}
