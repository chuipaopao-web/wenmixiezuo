import { avatarPosition } from '../../app/role-avatars';

export function AgentAvatar({ roleKey, roleName }: { roleKey: string; roleName: string }): React.JSX.Element {
  return <span className="agent-avatar" role="img" aria-label={roleName + '头像'} style={{ backgroundPosition: avatarPosition(roleKey) }} />;
}
