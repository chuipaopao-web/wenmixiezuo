import type { OpeningPackage, OpeningReview } from '../../packages/backend/src/legacy-opening/opening-agent/opening-agent-contracts.js';
export const IDEA = '张三穿越到三国乱世，从流民开始求生，想靠现代知识改变自己和百姓的命运。';
export const PACKAGE: OpeningPackage = {
  title: '三国：从流民开始',
  positioning: {
    publishingPlatform: 'fanqie',
    channel: 'male', category: '历史古代', genres: ['秦汉三国', '架空历史'],
    tags: ['历史', '古代', '权谋'],
    coreAppeal: '现代普通人从流民起步，在真实乱世规则中靠判断和试错建立班底。',
    expectedTotalWords: 3_000_000
  },
  backgrounds: {
    eraAndWorld: '东汉末年，黄巾余波未平，地方秩序松动，历史框架真实但允许人物改变局部命运。',
    openingSituation: ''
  },
  protagonists: [{
    name: '张三', age: '23岁', identity: '男主',
    background: '熟悉基础历史脉络，但没有万能技术手册，也不懂真实战场。',
    familyBackground: '现代普通家庭出身，穿越后暂时没有可依靠的古代亲族。',
    careerBackground: '现代普通职员，具备基础信息整理和沟通能力。',
    goldenFinger: '无额外金手指，主要依靠有限历史常识、观察和反复试错。',
    visualIdentity: { appearance: '面容清瘦、剑眉', build: '中等身高、精瘦', signatureFeature: '左眉浅疤' },
    goal: '',
    dilemma: '',
    personality: ['谨慎', '有同理心', '善于复盘'],
    boundary: ''
  }],
  opening: {
    startingSituation: '',
    incitingIncident: '',
    immediateConflict: '',
    readerPromise: ''
  },
  longTermDirection: {
    centralConflict: '个人求生与乱世权力扩张之间持续冲突，主角越有能力越无法置身事外。',
    progression: '从流民和小卒逐步学会带队、用人、治理与承担公共责任。',
    relationshipDirection: '从互相防备的求生同伴，发展为经得住利益与生死考验的班底。',
    storyPotential: '军营求生、战役升级、势力博弈和地方治理可以持续逐卷扩展。'
  },
  possibleEnding: {
    direction: '张三最终建立能够保护普通人的稳定秩序，但未必称帝。',
    price: '他要牺牲部分个人自由，并承担战争和治理决策带来的长期责任。',
    openness: '称帝、辅佐或退居幕后仍可由后续蓝图和分卷实际结果调整。'
  },
  authorNotes: [],
  mustFollow: ['不会无代价掌握古代工艺', '不能准确记住所有历史细节']
};
export const PASS_REVIEW: OpeningReview = {
  verdict: 'pass', summary: '资料包保留作者核心想法，字段一致，可以交给作者检查。',
  issues: [], requiredChanges: [], authorDecisions: []
};
