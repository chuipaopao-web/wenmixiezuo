const ROLE_AVATAR_POSITION: Record<string, string> = {
  chief_editor: '0% 0%',
  main_editor: '0% 0%',
  deputy_editor: '50% 100%',
  lead_screenwriter: '50% 0%',
  second_screenwriter: '100% 50%',
  third_screenwriter: '0% 100%',
  senior_screenwriter: '50% 100%',
  setting: '100% 0%',
  lead_writer: '0% 50%',
  backup_writer: '0% 100%',
  fact_reviewer: '100% 0%',
  literary_reviewer: '50% 50%',
  experience_reviewer: '100% 100%',
  experience_challenger: '50% 100%',
  researcher: '50% 100%',
  copyright: '100% 100%',
  plot_architect: '50% 0%',
  continuity: '100% 0%',
  writer: '0% 50%',
  reviewer: '50% 50%',
  reader_experience: '100% 50%',
  style_editor: '0% 100%'
};

export function avatarPosition(roleKey: string): string {
  return ROLE_AVATAR_POSITION[roleKey] ?? '50% 50%';
}
