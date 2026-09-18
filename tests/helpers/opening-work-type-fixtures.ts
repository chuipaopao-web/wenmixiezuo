import type { DatabaseSync } from 'node:sqlite';
import { BookRepository } from '../../apps/api/src/infrastructure/db/repositories/book-repository.js';

// OPENING-NOVEL-CLOSE-01 共享夹具：四类作品类型开书包、手动开书包与门禁种子。
// 自包含、纳入Git的正常工程依赖；不读写任何 .local 证据/诊断文件。

export const OPENING_BROWSER_HEADERS = {
  host: '127.0.0.1:43111',
  origin: 'http://127.0.0.1:43110',
  'sec-fetch-site': 'same-site',
  'content-type': 'application/json'
};

const TAXONOMY = {
  publishingPlatform: 'fanqie',
  channel: 'male', category: '历史脑洞', genres: ['历史脑洞', '秦汉三国', '穿越'],
  tags: ['成长', '权谋', '智商在线', '群像']
};

/** 四个不同合理夹具：长篇旧兼容 / 短篇1万字集中故事 / 自传已知经历+待补充 / 剧本人物与场景。 */
export function makeOpeningPackage(expectedTotalWords: number, content: {
  title: string; coreAppeal: string; eraAndWorld: string; centralConflict: string; mustFollow: string[];
}) {
  return {
    title: content.title,
    positioning: { ...TAXONOMY, coreAppeal: content.coreAppeal, expectedTotalWords },
    backgrounds: { eraAndWorld: content.eraAndWorld },
    protagonists: [{
      name: '张三', age: '23岁', identity: '男主',
      background: '熟悉基础历史脉络，但没有万能技术手册。',
      familyBackground: '现代普通家庭出身，没有可依靠的宗族。',
      careerBackground: '穿越前是普通职员，擅长整理信息和协调同伴。',
      goldenFinger: '无额外系统，主要依靠现代常识、观察力和复盘能力。',
      visualIdentity: { appearance: '五官端正、目光沉静', build: '身形精干、耐力较好', signatureFeature: '左眉浅痕、旧布护腕' },
      personality: ['谨慎', '有同理心']
    }],
    longTermDirection: {
      centralConflict: content.centralConflict,
      progression: '先带同伴活下来，再取得立足之地，最终有能力保护更多普通人。',
      relationshipDirection: '在共同求生和立场冲突中建立可信赖的伙伴关系。',
      storyPotential: '身份上升、阵营选择与百姓生存可以持续形成矛盾。'
    },
    possibleEnding: {
      direction: '最终建立能保护普通人的稳定秩序。',
      price: '必须在个人安稳与承担更大责任之间作出取舍。',
      openness: '主冲突收束，同时保留新秩序继续经受考验的空间。'
    },
    mustFollow: content.mustFollow,
    authorInstructions: []
  };
}

export const NOVEL_PACKAGE = makeOpeningPackage(3_000_000, {
  title: '三国：从流民开始',
  coreAppeal: '现代普通人从乱世底层起步，靠判断、协作和承担责任逐步改变命运。',
  eraAndWorld: '东汉末年，黄巾余波未平，地方秩序松动。',
  centralConflict: '个人求生与乱世权力扩张持续冲突。',
  mustFollow: ['不能准确记住所有历史细节']
});
export const SHORT_PACKAGE = makeOpeningPackage(10_000, {
  title: '渡口一夜的抉择',
  coreAppeal: '一个夜晚、一个渡口，陌生旅客与守渡人围绕一袋赈灾粮展开集中冲突。',
  eraAndWorld: '东汉末年一处偏僻渡口，故事只发生在一个夜晚。',
  centralConflict: '守渡人要不要冒死揭发冒领赈灾粮的旅客。',
  mustFollow: ['篇幅集中在一个夜晚，不展开成长线']
});
export const MEMOIR_PACKAGE = makeOpeningPackage(80_000, {
  title: '我在南方修铁路',
  coreAppeal: '作者祖父辈真实的筑路经历：已知的迁徙、工地与家庭变故，未知处明确留白。',
  eraAndWorld: '上世纪南方山区铁路工地，以家族真实经历为底。',
  centralConflict: '艰苦环境与家庭责任之间的真实抉择。',
  mustFollow: ['未知日期与姓名保持待补充，不得编造']
});
export const SCRIPT_PACKAGE = makeOpeningPackage(60_000, {
  title: '站台救援行动',
  coreAppeal: '以场景调度和对白推进的灾难救援故事：人物关系与场景转换是主要叙事手段。',
  eraAndWorld: '现代都市地铁站，主要场景为站台、控制室与隧道。',
  centralConflict: '救援时限与人员去留的持续冲突。',
  mustFollow: ['以场景与对白呈现，不写大段内心独白']
});

const MANUAL_BASE = {
  positioning: {
    publishingPlatform: 'fanqie', channel: 'male', category: '历史脑洞', genres: ['历史脑洞'], tags: ['历史', '权谋'],
    coreAppeal: '张三改变北宋。', targetReaders: '喜欢历史穿越、成长和权谋的男频读者',
    retentionPositioning: '开篇快速进入乱世压力，逐段兑现身份跃迁。'
  },
  backgrounds: { eraAndWorld: '北宋末年', openingSituation: '' },
  protagonists: [{ name: '张三', age: '20岁', identity: '男主', background: '现代人穿越为小卒', familyBackground: '', careerBackground: '', goldenFinger: '', goal: '改变时代', dilemma: '身份低微', personality: ['谨慎'], boundary: '不能靠系统解决问题' }],
  opening: { startingSituation: '', incitingIncident: '', immediateConflict: '', readerPromise: '' },
  longTermDirection: { centralConflict: '小人物与旧秩序冲突', progression: '从小卒成长', relationshipDirection: '与岳飞相识并合作', storyPotential: '逐段扩大影响' },
  possibleEnding: { direction: '建立新秩序', price: '承担损失', openness: '允许调整' }, authorNotes: [],
  mustFollow: ['主角必须是张三', '不使用系统和超凡力量']
};

export function makeManualPackage(expectedTotalWords: number) {
  return {
    ...MANUAL_BASE,
    title: '手动开书夹具',
    positioning: { ...MANUAL_BASE.positioning, expectedTotalWords }
  };
}

export type SeedableWorkType = 'novel' | 'short_story' | 'memoir' | 'script';

/** 门禁种子书：蓝图 + 已确认定位草稿（V7可见性）+ 可选创作偏好快照。 */
export function seedBookWithWorkType(
  database: DatabaseSync,
  ownerId: string,
  bookId: string,
  workType: SeedableWorkType | null
): void {
  new BookRepository(database).create({ ownerId, bookId }, `门禁-${workType ?? 'legacy'}`, '2026-09-19', 'active');
  database.prepare("INSERT INTO book_opening_blueprints VALUES(?,?,?,1,'v1','male','fantasy','玄幻',?,?,'active','2026-09-19')")
    .run(`opening-${bookId}`, ownerId, bookId, JSON.stringify({ protagonists: ['林舟'], storyDirection: '记录一段生活', planningProfile: { expectedTotalWords: 10_000 } }), 'a'.repeat(64));
  database.prepare(`INSERT INTO positioning_drafts
    (draft_id,owner_id,proposed_book_id,title,input_text,fields_json,tags_json,opening_blueprint_json,status,version,confirmed_book_id,created_at,updated_at)
    VALUES (?,?,?,?,'门禁种子','[]','[]','{}','confirmed',1,?,'2026-09-19','2026-09-19')`)
    .run(`v7-opening-draft-${bookId}`, ownerId, bookId, `门禁-${workType ?? 'legacy'}`, bookId);
  if (workType !== null) {
    database.prepare('INSERT INTO book_creative_profiles(owner_id,book_id,profile_json,source_task_id,created_at) VALUES(?,?,?,?,?)')
      .run(ownerId, bookId, JSON.stringify({ scale: 3, styles: [], workType }), 'fixture', '2026-09-19');
  }
}

export function timeMachineRunCount(database: DatabaseSync, bookId: string): number {
  return (database.prepare('SELECT COUNT(*) AS n FROM tm2_design_runs WHERE book_id = ?').get(bookId) as { n: number }).n;
}

export function openingTaskCount(database: DatabaseSync, ownerId: string): number {
  return (database.prepare('SELECT COUNT(*) AS n FROM v7_opening_agent_tasks WHERE owner_id = ?').get(ownerId) as { n: number }).n;
}

export function bookCount(database: DatabaseSync, ownerId: string): number {
  return (database.prepare('SELECT COUNT(*) AS n FROM books WHERE owner_id = ?').get(ownerId) as { n: number }).n;
}

export function positioningDraftCount(database: DatabaseSync, ownerId: string): number {
  return (database.prepare('SELECT COUNT(*) AS n FROM positioning_drafts WHERE owner_id = ?').get(ownerId) as { n: number }).n;
}
