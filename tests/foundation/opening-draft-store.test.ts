import { describe, expect, it } from 'vitest';
import {
  clearOpeningWizardDraft,
  emptyOpeningWizardDraft,
  hasMeaningfulOpeningDraft,
  loadOpeningWizardDraft,
  openingDraftStorageKey,
  saveOpeningWizardDraft
} from '../../apps/web/src/features/onboarding/opening-draft-store';

function memoryStorage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
    removeItem: (key: string) => { values.delete(key); },
    raw: values
  };
}

describe('四步开书草稿', () => {
  it('保存并恢复续写路线、多主角、故事方向与作者边界', () => {
    const storage = memoryStorage();
    const empty = emptyOpeningWizardDraft();
    const saved = saveOpeningWizardDraft('user-a', {
      ...empty,
      step: 3,
      creationMode: 'continuation',
      title: '旧城来信',
      channel: 'female',
      categoryKey: 'female-suspense',
      protagonists: [
        { role: 'female_lead', name: '林舟', age: '十八岁', background: '旧城档案员', personalities: ['冷静'] },
        { role: 'co_lead', name: '周野', age: '成年', background: '失踪调查员', personalities: ['敏锐'] }
      ],
      storyDirection: '两人从一封旧信追查被改写的城市记忆，并阻止下一次大规模改写。',
      worldBackground: '旧城地图会随居民记忆改变。',
      stageOne: { start: '收到旧信', development: '追查地图', end: '找到记忆源头' },
      initialMap: '档案馆、旧港与废弃轮渡站。',
      selectedMustFollow: ['不靠误会强推剧情']
    }, storage, () => new Date('2026-08-08T08:00:00.000Z'));

    expect(saved.updatedAt).toBe('2026-08-08T08:00:00.000Z');
    expect(loadOpeningWizardDraft('user-a', storage)).toMatchObject({
      step: 3, creationMode: 'continuation', title: '旧城来信',
      protagonists: [{ name: '林舟' }, { name: '周野' }],
      worldBackground: '旧城地图会随居民记忆改变。',
      stageOne: { end: '找到记忆源头' },
      initialMap: '档案馆、旧港与废弃轮渡站。',
      selectedMustFollow: ['不靠误会强推剧情']
    });
    clearOpeningWizardDraft('user-a', storage);
    expect(storage.raw.has(openingDraftStorageKey('user-a'))).toBe(false);
  });

  it('草稿按账号隔离，切换账号互不可见', () => {
    const storage = memoryStorage();
    const empty = emptyOpeningWizardDraft();
    saveOpeningWizardDraft('user-a', { ...empty, title: '账号A的书' }, storage);
    expect(loadOpeningWizardDraft('user-b', storage)).toBeNull();
    expect(loadOpeningWizardDraft('user-a', storage)).toMatchObject({ title: '账号A的书' });
    clearOpeningWizardDraft('user-a', storage);
    expect(loadOpeningWizardDraft('user-a', storage)).toBeNull();
  });

  it('忽略旧版或损坏数据，并限制本地内容体量', () => {
    const storage = memoryStorage();
    const key = openingDraftStorageKey('user-a');
    storage.setItem(key, JSON.stringify({ schemaVersion: 1, title: '旧版' }));
    expect(loadOpeningWizardDraft('user-a', storage)).toBeNull();
    storage.setItem(key, '{broken');
    expect(loadOpeningWizardDraft('user-a', storage)).toBeNull();
    storage.setItem(key, JSON.stringify({
      schemaVersion: 2, step: 99, creationMode: 'unknown', title: '长'.repeat(500),
      protagonists: [{ role: 'invalid', name: '甲', age: '成年', background: '背景', personalities: ['冷静', '冷静'] }]
    }));
    expect(loadOpeningWizardDraft('user-a', storage)).toMatchObject({
      step: 1, creationMode: 'new', title: '长'.repeat(15),
      protagonists: [{ role: 'co_lead', personalities: ['冷静'] }]
    });
  });

  it('空白草稿不持久化，任一路线或作者输入会触发保存', () => {
    const empty = emptyOpeningWizardDraft();
    expect(hasMeaningfulOpeningDraft(empty)).toBe(false);
    expect(hasMeaningfulOpeningDraft({ ...empty, creationMode: 'continuation' })).toBe(true);
    expect(hasMeaningfulOpeningDraft({ ...empty, protagonists: [{ ...empty.protagonists[0]!, name: '林舟' }] })).toBe(true);
  });
});
