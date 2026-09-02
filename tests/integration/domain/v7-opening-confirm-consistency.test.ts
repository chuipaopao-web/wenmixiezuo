import { describe, expect, it } from 'vitest';
import type { OpeningPackage } from '@wenmi/v7-backend';
import { openingPackageUnchanged } from '../../../apps/api/src/application/books/v7-opening-package-contract.js';

/**
 * 生产死锁回归（第84批）：作者在审查面板"采纳全部建议"后，revise() 把作者
 * 修订稿直接存为候选（含 revisionDirective、authorInstructions: []、作者填写
 * 的 authorNotes/goal/boundary）。旧实现用 parse 重建提交侧做哈希比较，parse
 * 会省略空 authorInstructions 并清空这些字段，导致原样确认永远 409。
 * openingPackageUnchanged 必须把"作者原样确认"判定为未修改。
 */
describe('开书确认内容一致性', () => {
  const revisionCandidate = {
    title: '大周太监要当皇帝',
    positioning: {
      publishingPlatform: 'fanqie',
      channel: 'male',
      category: '东方玄幻',
      genres: ['宫廷', '权谋'],
      tags: ['朝堂', ' system流'],
      coreAppeal: '小太监逆权而上，把皇帝宝座变成自己的账本。',
      expectedTotalWords: 1_500_000
    },
    backgrounds: { eraAndWorld: '架空大周，宦官干政。', openingSituation: '主角刚入宫当差。' },
    protagonists: [{
      name: '陆沉',
      age: '十九',
      identity: '洒扫太监',
      background: '乡下孤儿入宫。',
      goal: '活着，然后往上爬。',
      dilemma: '夹在两派太监之间。',
      boundary: '不害无辜。',
      personality: ['隐忍', '记仇'],
      visualIdentity: { appearance: '清瘦', build: '偏瘦', signatureFeature: '左手断指' }
    }],
    opening: { startingSituation: '', incitingIncident: '', immediateConflict: '', readerPromise: '' },
    longTermDirection: { centralConflict: '宦权与皇权。', progression: '从洒扫到司礼监。', relationshipDirection: '与幼帝相互借力。', storyPotential: '权谋空间大。' },
    possibleEnding: { direction: '登临摄政。', price: '失去唯一朋友。', openness: '可留悬念。' },
    authorNotes: ['保持宦官视角。'],
    mustFollow: ['陆沉不能未卜先知。'],
    authorInstructions: [],
    revisionDirective: { allowedFields: ['title'], authorMessages: [] }
  } as unknown as OpeningPackage;

  it('作者原样确认修订稿（含内部字段与空 authorInstructions）判定为未修改', () => {
    const submitted = publicViewCopy(revisionCandidate);
    expect(openingPackageUnchanged(revisionCandidate, submitted)).toBe(true);
  });

  it('候选与提交键顺序不同仍判定为未修改', () => {
    const submitted = reordered(publicViewCopy(revisionCandidate));
    expect(openingPackageUnchanged(revisionCandidate, submitted)).toBe(true);
  });

  it('作者真实修改书名判定为已修改', () => {
    const submitted = { ...publicViewCopy(revisionCandidate), title: '大周权宦手记' };
    expect(openingPackageUnchanged(revisionCandidate, submitted)).toBe(false);
  });

  it('作者补写审查面板可见资料判定为已修改', () => {
    const base = publicViewCopy(revisionCandidate);
    const submitted = {
      ...base,
      protagonists: base.protagonists.map((item, index) => (
        index === 0 ? { ...item, goal: '活下来并掌印。' } : item
      ))
    };
    expect(openingPackageUnchanged(revisionCandidate, submitted)).toBe(false);
  });

  it('undefined 字段与缺键等价', () => {
    const stored = { ...publicViewCopy(revisionCandidate), positioning: { ...publicViewCopy(revisionCandidate).positioning, targetReaders: undefined } } as unknown as OpeningPackage;
    const submitted = publicViewCopy(revisionCandidate);
    expect(openingPackageUnchanged(stored, submitted)).toBe(true);
  });
});

function publicViewCopy(candidate: OpeningPackage): OpeningPackage {
  const copy = JSON.parse(JSON.stringify(candidate)) as Record<string, unknown>;
  delete copy.revisionDirective;
  return copy as unknown as OpeningPackage;
}

function reordered(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(reordered);
  if (value === null || typeof value !== 'object') return value;
  const entries = Object.entries(value as Record<string, unknown>).reverse();
  return Object.fromEntries(entries.map(([key, item]) => [key, reordered(item)]));
}
