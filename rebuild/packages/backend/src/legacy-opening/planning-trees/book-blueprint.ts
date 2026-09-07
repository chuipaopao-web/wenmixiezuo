import type { PlanningTreeDocument } from './planning-tree-contracts.js';

export interface BookBlueprint {
  schema: 'book-blueprint-v1';
  endingPromise: string;
  storylines: Array<{ key: string; title: string; goal: string; development: string; resolution: string }>;
  stages: Array<{ key: string; title: string; startState: string; gain: string; cost: string;
    causalBridge: string; rhythm: string; volumeKeys: string[]; storylineKeys: string[] }>;
}

/** Only structure, exact references and arithmetic are judged here, never literary quality. */
export function validateBookBlueprint(document: PlanningTreeDocument): string[] {
  const plan = document.bookBlueprint;
  if (plan === undefined) return [];
  const errors: string[] = [];
  const text = (v: unknown, max = 180): boolean => typeof v === 'string' && v.trim().length > 0 && v.length <= max;
  const key = (v: unknown): boolean => typeof v === 'string' && /^[A-Za-z0-9][A-Za-z0-9:_-]{0,127}$/u.test(v);
  if (document.treeKind !== 'book' || !plan || plan.schema !== 'book-blueprint-v1'
    || !text(plan.endingPromise, 400) || !Array.isArray(plan.storylines) || plan.storylines.length < 1 || plan.storylines.length > 12
    || !Array.isArray(plan.stages) || plan.stages.length < 1 || plan.stages.length > 24) return ['全书阶段路线格式不完整'];
  const lines = new Set<string>(), stages = new Set<string>(), assigned: string[] = [];
  for (const line of plan.storylines) {
    if (!line || !key(line.key) || lines.has(line.key) || !['title','goal','development','resolution'].every(k => text(line[k as keyof typeof line]))) {
      errors.push('故事线需有唯一编号、名称、目标、推进与收束，每项不超过180字'); continue;
    }
    lines.add(line.key);
  }
  const usedLines = new Set<string>();
  for (const stage of plan.stages) {
    if (!stage || !key(stage.key) || stages.has(stage.key) || !['title','startState','gain','cost','causalBridge','rhythm'].every(k => text(stage[k as keyof typeof stage]))
      || !Array.isArray(stage.volumeKeys) || stage.volumeKeys.length === 0 || !Array.isArray(stage.storylineKeys) || stage.storylineKeys.length === 0) {
      errors.push('阶段需有唯一编号、起点、成果、代价、承接、节奏以及关联卷和故事线，每项不超过180字'); continue;
    }
    stages.add(stage.key); assigned.push(...stage.volumeKeys);
    if (new Set(stage.storylineKeys).size !== stage.storylineKeys.length || stage.storylineKeys.some(k => !lines.has(k))) errors.push('阶段故事线引用无效或重复');
    stage.storylineKeys.forEach(k => usedLines.add(k));
  }
  const volumes = document.root.children.filter(n => n.kind === 'volume');
  if (!volumes.length || JSON.stringify(assigned) !== JSON.stringify(volumes.map(v => v.key))) errors.push('各卷必须按顺序恰好归属一个阶段；一个阶段可以跨多卷');
  if ([...lines].some(k => !usedLines.has(k))) errors.push('每条故事线至少需要一个推进阶段');
  const words = volumes.map(v => v.budget.wordTarget);
  if (words.some(w => !Number.isSafeInteger(w) || (w ?? 0) <= 0) || !Number.isSafeInteger(document.root.budget.wordTarget)
    || words.reduce<number>((sum, w) => sum + (w ?? 0), 0) !== document.root.budget.wordTarget) errors.push('全书目标字数必须等于各卷正整数目标字数之和');
  if (JSON.stringify(plan).length > 9000) errors.push('阶段与故事线超过9000字符，请保留高密度要点');
  return errors;
}

export function projectBookBlueprint(document: PlanningTreeDocument, focusChildScopeId?: string): BookBlueprint | undefined {
  const plan = document.bookBlueprint;
  if (!plan) return undefined;
  if (focusChildScopeId === undefined) return structuredClone(plan);
  const volume = document.root.children.find(n => n.linkedTree?.scopeId === focusChildScopeId);
  const stages = plan.stages.filter(s => s.volumeKeys.includes(volume?.key ?? ''));
  const lines = new Set(stages.flatMap(s => s.storylineKeys));
  return structuredClone({ ...plan, stages, storylines: plan.storylines.filter(s => lines.has(s.key)) });
}

export const BOOK_BLUEPRINT_INSTRUCTIONS = [
  '生成后自行对齐阶段与卷：阶段只能汇总其关联卷的实际设计，已在前卷解决的矛盾不能原样当作后卷尚未解决的问题。先按各卷事件容量分配字数，再写篇幅理由，理由必须与数值相符；不要均分后又宣称没有均分。根与卷的每个叙述字段用一句15至60字的具体短话，数组只留必要要点，避免在不同字段复制整段说明。',
  '本次全书树顶层增加bookBlueprint={schema:"book-blueprint-v1",endingPromise,storylines,stages}。先确定开局与终局之间需要哪些阶段，再分配到卷；不要先把字数平均切块再填事件。',
  'storylines每条为{key,title,goal,development,resolution}：主线和真正影响主线的支线，写具体人物目标、推进和收束，不为数量凑线。',
  'stages每阶段为{key,title,startState,gain,cost,causalBridge,rhythm,volumeKeys,storylineKeys}：主角起点、获得/变化、代价、为何形成下一局面、本阶段的具体节奏、关联卷key、关联故事线key。最后阶段causalBridge写收束余波，不能用新敌人代替终局兑现。',
  '各字段用一两句高密度内容，不超过180字；endingPromise不超过400字。所有key使用英文字母数字下划线短横线。阶段可以跨多个连续卷；按卷顺序恰好覆盖所有volume节点一次，不能漏卷、重卷或使用scopeId代替节点key。',
  '卷的story.protagonistChange说明具体获得或失去的地位、能力、名声、关系、认知等，只写本书真正变化的维度；不必每卷晋升。卷起点写在causality.trigger，成果和代价写在outcome/consequences，nextStep写因果承接。',
  '节奏可以重复或组合，事件和结果要自然变化。高低强度不是简单战斗/休息分类：治理、谈判和关系也可以紧张。故事线必须分配推进阶段，每条都说明兑现去向。',
  '每卷budget.wordTarget为正整数，全书root.budget.wordTarget严格等于各卷之和；遵守作者明确的全书字数与卷数，没有明确要求则按容量给出合理分配。相同字数可以合理出现，但不得机械均分，根节点experience.designReason解释篇幅取舍。结局节点不另加重复字数。'
].join('\n');
