import { describe, expect, it } from 'vitest';
import {
  OPENING_DRAFT_STORAGE_KEY,
  clearOpeningWizardDraft,
  emptyOpeningWizardDraft,
  hasMeaningfulOpeningDraft,
  loadOpeningWizardDraft,
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
    const saved = saveOpeningWizardDraft({
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
    expect(loadOpeningWizardDraft(storage)).toMatchObject({
      step: 3, creationMode: 'continuation', title: '旧城来信',
      protagonists: [{ name: '林舟' }, { name: '周野' }],
      worldBackground: '旧城地图会随居民记忆改变。',
      stageOne: { end: '找到记忆源头' },
      initialMap: '档案馆、旧港与废弃轮渡站。',
      selectedMustFollow: ['不靠误会强推剧情']
    });
    clearOpeningWizardDraft(storage);
    expect(storage.raw.has(OPENING_DRAFT_STORAGE_KEY)).toBe(false);
  });

  it('忽略旧版或损坏数据，并限制本地内容体量', () => {
    const storage = memoryStorage();
    storage.setItem(OPENING_DRAFT_STORAGE_KEY, JSON.stringify({ schemaVersion: 1, title: '旧版' }));
    expect(loadOpeningWizardDraft(storage)).toBeNull();
    storage.setItem(OPENING_DRAFT_STORAGE_KEY, '{broken');
    expect(loadOpeningWizardDraft(storage)).toBeNull();
    storage.setItem(OPENING_DRAFT_STORAGE_KEY, JSON.stringify({
      schemaVersion: 2, step: 99, creationMode: 'unknown', title: '长'.repeat(500),
      protagonists: [{ role: 'invalid', name: '甲', age: '成年', background: '背景', personalities: ['冷静', '冷静'] }]
    }));
    expect(loadOpeningWizardDraft(storage)).toMatchObject({
      step: 1, creationMode: 'new', title: '长'.repeat(120),
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
