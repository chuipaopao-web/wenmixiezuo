import { useEffect, useState } from 'react';
import { fetchBookProfile, type BookData, type BookProfileViewData } from '../../lib/api/client';
import { NamingAssistantPanel } from '../../app/NamingAssistantPanel';
import type { NamingContext } from '../../app/naming-assistant';

export function NamingWorkspace({ book }: { book: BookData }): React.JSX.Element {
  const [profile, setProfile] = useState<BookProfileViewData | null>(null);
  const [profileUnavailable, setProfileUnavailable] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    setProfileUnavailable(false);
    void fetchBookProfile(book.bookId, controller.signal)
      .then((value) => setProfile(value))
      .catch(() => {
        if (!controller.signal.aborted) setProfileUnavailable(true);
      });
    return () => controller.abort();
  }, [book.bookId]);

  const context: NamingContext = profile === null ? {} : {
    channel: profile.channel === '男频' || profile.channel === 'male' ? 'male'
      : profile.channel === '女频' || profile.channel === 'female' ? 'female' : null,
    category: profile.category,
    subjects: profile.subjects,
    tags: [...profile.mainTags, ...profile.customTags],
    storyDirection: profile.storyDirection
  };
  const existingNames = profile?.protagonists.map((item) => item.name).filter(Boolean) ?? [];

  return (
    <div className="naming-workspace">
      {profileUnavailable && (
        <p className="naming-context-notice" role="status">
          暂时没有读取到本书分类资料，当前使用通用语感；取名功能仍可正常使用。
        </p>
      )}
      <NamingAssistantPanel context={context} exclude={existingNames} action="copy" />
    </div>
  );
}
