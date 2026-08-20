import { useEffect, useState } from 'react';
import { authorErrorFromUnknown } from '../../lib/api/author-error';
import { BookOpenTextIcon, GraphIcon } from '@phosphor-icons/react';
import {
  fetchGraphWorkspace,
  fetchLibrary,
  type GraphWorkspaceData,
  type LibraryData
} from '../../lib/api/client';
import { ProjectionWorkspace } from '../graph/ProjectionWorkspace';
import { WorkspaceSkeleton } from '../shared/WorkspaceSkeleton';
import { LibraryWorkspace } from './LibraryWorkspace';

export function StoryKnowledgeWorkspace({ bookId }: { bookId: string }): React.JSX.Element {
  const [tab, setTab] = useState<'cards' | 'relations'>('cards');
  const [library, setLibrary] = useState<LibraryData | null>(null);
  const [graph, setGraph] = useState<GraphWorkspaceData | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    setError(null);
    void Promise.all([
      fetchLibrary(bookId, controller.signal),
      fetchGraphWorkspace(bookId, controller.signal)
    ]).then(([nextLibrary, nextGraph]) => {
      setLibrary(nextLibrary);
      setGraph(nextGraph);
    }).catch((reason: unknown) => {
      if (!controller.signal.aborted) setError(authorErrorFromUnknown(reason, '资料库加载失败'));
    });
    return () => controller.abort();
  }, [bookId]);

  return <section className="story-knowledge-workspace">
    <h3 className="sr-only">资料库</h3>
    <nav aria-label="资料库视图">
      <button type="button" className={tab === 'cards' ? 'active' : ''} onClick={() => setTab('cards')}><BookOpenTextIcon />资料卡片</button>
      <button type="button" className={tab === 'relations' ? 'active' : ''} onClick={() => setTab('relations')}><GraphIcon />关系与轨迹</button>
    </nav>
    {error !== null && <p className="inline-error" role="alert">{error}</p>}
    {library === null || graph === null
      ? <WorkspaceSkeleton />
      : tab === 'cards'
        ? <LibraryWorkspace data={library} bookId={bookId} />
        : <ProjectionWorkspace data={graph} />}
  </section>;
}
