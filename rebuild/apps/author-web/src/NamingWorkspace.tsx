import type { BookProfile } from './opening-api';
import { NamingAssistantPanel } from './NamingAssistantPanel';
import type { NamingContext } from './naming-assistant';

interface NamingWorkspaceProps {
  profile: BookProfile | null;
  profileUnavailable: boolean;
}

export function NamingWorkspace({ profile, profileUnavailable }: NamingWorkspaceProps): React.JSX.Element {
  const context: NamingContext = profile === null ? {} : {
    channel: profile.channel === '男频' ? 'male' : 'female',
    category: profile.category,
    subjects: profile.subjects,
    tags: profile.mainTags,
    storyDirection: profile.storyDirection
  };
  const existingNames = profile?.protagonists.map((item) => item.name).filter(Boolean) ?? [];

  return (
    <div className="naming-workspace">
      {profileUnavailable && (
        <p className="naming-context-notice" role="status">
          暂时没有读取到本书资料，当前先使用通用语感；资料恢复后会自动按本书推荐。
        </p>
      )}
      <NamingAssistantPanel context={context} exclude={existingNames} action="copy" />
    </div>
  );
}
