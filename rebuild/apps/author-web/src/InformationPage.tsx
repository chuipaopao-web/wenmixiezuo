import { BookOpenTextIcon, CheckCircleIcon, MagicWandIcon, PencilSimpleIcon, SlidersHorizontalIcon, TagIcon } from '@phosphor-icons/react';
import { useEffect, useState } from 'react';
import { BookCoverDesignDialog, BookProfileEditDialog, BookTitleDesignDialog } from './BookProfileDialogs';
import { openingProfileCharacters, openingProfileRows, uniqueNonEmpty } from './book-profile-presentation';
import { NamingWorkspace } from './NamingWorkspace';
import { fetchBookProfile, updateBookProfile, type BookProfile } from './opening-api';
import { SettingPage } from './SettingPage';
import { WorkflowActionDock } from './WorkflowActionDock';
import type { InformationSection, SettingRecoveryFocus } from './navigation';

export function InformationPage({ bookId, onOpenTimeMachine, initialSection = 'profile', settingRecoveryFocus = null }: {
  bookId: string;
  onOpenTimeMachine?: () => void;
  initialSection?: InformationSection;
  settingRecoveryFocus?: SettingRecoveryFocus | null;
}): React.JSX.Element {
  const [profile, setProfile] = useState<BookProfile | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [section, setSection] = useState<'profile' | 'setting' | 'naming'>(initialSection);
  const [profileOpen, setProfileOpen] = useState(false);
  const [titleOpen, setTitleOpen] = useState(false);
  const [coverOpen, setCoverOpen] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    void fetchBookProfile(bookId, controller.signal).then((value) => {
      setProfile(value);
      setError(null);
    }).catch((reason: unknown) => {
      if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : '开书资料读取失败');
    });
    return () => controller.abort();
  }, [bookId]);

  return (
    <section className="information-surface information-hub" aria-label="信息">
      <nav className="information-section-tabs" aria-label="信息功能">
        <button type="button" className={section === 'profile' ? 'active' : ''} aria-pressed={section === 'profile'} onClick={() => setSection('profile')}><BookOpenTextIcon />开书资料</button>
        <button type="button" className={section === 'setting' ? 'active' : ''} aria-pressed={section === 'setting'} onClick={() => setSection('setting')}><SlidersHorizontalIcon />设定</button>
        <button type="button" className={section === 'naming' ? 'active' : ''} aria-pressed={section === 'naming'} onClick={() => setSection('naming')}><MagicWandIcon />取名助手</button>
      </nav>

      {section === 'setting' ? (
        <SettingPage bookId={bookId} recoveryFocus={settingRecoveryFocus} {...(onOpenTimeMachine === undefined ? {} : { onOpenTimeMachine })} />
      ) : section === 'naming' ? (
        <NamingWorkspace profile={profile} profileUnavailable={error !== null} />
      ) : error !== null ? (
        <div className="error-notice" role="alert">{error}</div>
      ) : profile === null ? (
        <div className="profile-loading" role="status">正在读取开书资料…</div>
      ) : (
        <div className="information-profile" aria-labelledby="information-title">
          <header className="information-heading">
            <div><p className="eyebrow">开书信息 · 已确认</p><h2 id="information-title">{profile.title}</h2><p>{profile.channel} · {profile.category}</p></div>
            <div className="profile-heading-actions"><span className="confirmed-badge"><CheckCircleIcon />作者已确认</span></div>
          </header>
          <div className="information-tags"><TagIcon />{uniqueNonEmpty([...profile.subjects, ...profile.mainTags, ...(profile.customTags ?? [])]).map((tag) => <span key={tag}>{tag}</span>)}</div>
          {profile.openingBlueprint.openingIdea?.trim() && <section className="profile-opening-idea"><small>最初的开书想法</small><p>{profile.openingBlueprint.openingIdea.trim()}</p></section>}
          <dl className="profile-detail-list profile-detail-list-first">{openingProfileRows(profile).filter((row) => row.label === '时代与世界').map((row) => <div key={row.label}><dt>{row.label}</dt><dd>{row.value}</dd></div>)}</dl>
          <section className="profile-character-section" aria-labelledby="profile-characters-title">
            <h3 id="profile-characters-title">主要角色</h3>
            <div className="profile-character-list">{openingProfileCharacters(profile).map((character) => <article key={character.key}>
              <header><div><strong>{character.name}</strong>{character.summary && <span>{character.summary}</span>}</div></header>
              {character.rows.length > 0 && <dl>{character.rows.map((row) => <div key={row.label}><dt>{row.label}</dt><dd>{row.value}</dd></div>)}</dl>}
              {character.visualRows.length > 0 && <details className="profile-character-visual"><summary><span>外貌与形象（选填）</span><small>展开查看</small></summary><dl>{character.visualRows.map((row) => <div key={row.label}><dt>{row.label}</dt><dd>{row.value}</dd></div>)}</dl></details>}
            </article>)}</div>
          </section>
          <dl className="profile-detail-list">{openingProfileRows(profile).filter((row) => row.label !== '时代与世界').map((row) => <div key={row.label}><dt>{row.label}</dt><dd>{row.value}</dd></div>)}</dl>
          <WorkflowActionDock
            title="开书资料已经成为正式上游"
            detail="下一步进入设定；书名、封面和资料需要调整时，也可以从这里修改。"
            secondary={<>
              <button type="button" className="secondary-action" onClick={() => setTitleOpen(true)}><MagicWandIcon />设计书名</button>
              <button type="button" className="secondary-action" onClick={() => setCoverOpen(true)}><MagicWandIcon />设计封面</button>
              <button type="button" className="secondary-action" onClick={() => setProfileOpen(true)}><PencilSimpleIcon />修改开书资料</button>
            </>}
            primary={<button type="button" className="primary-action" onClick={() => setSection('setting')}><SlidersHorizontalIcon />进入设定</button>}
          />
        </div>
      )}
      {profileOpen && profile !== null && <BookProfileEditDialog profile={profile} onClose={() => setProfileOpen(false)} onSave={async (title, openingBlueprint) => {
        if (profile.version === undefined) throw new Error('开书资料版本缺失，请刷新后重试。');
        const updated = await updateBookProfile(bookId, { expectedVersion: profile.version, title, openingBlueprint });
        setProfile(updated); setProfileOpen(false);
      }}/>} 
      {titleOpen && profile !== null && <BookTitleDesignDialog bookId={bookId} currentTitle={profile.title} onClose={() => setTitleOpen(false)} onApply={async (title) => {
        if (profile.version === undefined) throw new Error('开书资料版本缺失，请刷新后重试。');
        const updated = await updateBookProfile(bookId, { expectedVersion: profile.version, title, openingBlueprint: profile.openingBlueprint });
        setProfile(updated); setTitleOpen(false);
      }}/>} 
      {coverOpen && profile !== null && <BookCoverDesignDialog bookId={bookId} currentTitle={profile.title} onClose={() => setCoverOpen(false)} />}
    </section>
  );
}
