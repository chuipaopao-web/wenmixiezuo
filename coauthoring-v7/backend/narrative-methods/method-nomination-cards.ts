import { V7_NARRATIVE_METHODS, getNarrativeMethod } from './narrative-method-library.js';
import { V7_PLOT_RECIPES, getPlotRecipe } from '../plot-patterns/plot-recipe-library.js';

export const V7_NOMINATION_CARDS_VERSION = '1.0.0';

/**
 * 提名卡：资产以完整卡片形态进入任务输入时的唯一内容（第86批）。
 * 结构固定：分段节奏线 + 一句防误读；连同资产名总量 ≤100 字。
 * 只有两组资产配卡：宏观节奏框架（macro-framework）与全书形态（book-topology），
 * 以及全部剧情配方；其余资产在菜单里只以名字出现（名册），成员凭内建知识理解。
 * 节奏线有几段画几段，段数不由系统定死。
 */
export interface NominationCard {
  stageRhythm: string;
  guard: string;
}

function card(stageRhythm: string, guard: string): NominationCard {
  return Object.freeze({ stageRhythm, guard });
}

/** 叙事方法提名卡：macro-framework 组 + book-topology 组。 */
export const V7_METHOD_NOMINATION_CARDS: Readonly<Record<string, NominationCard>> = Object.freeze({
  // ---- 宏观节奏框架（自相似：全书/卷/链/章均可按本层预算伸缩使用） ----
  'three-act': card('①建置目标 ②对抗升级 ③主动选择解决', '中段不能只重复阻力，必须改变人物的理解或方法。'),
  'four-act': card('①立处境 ②深化发展 ③有前因的真转向 ④收束留接口', '“转”必须改变理解或目标，不能是无因果的突然反转。'),
  'five-act': card('①建置 ②发酵 ③转折高点 ④代价回落 ⑤收束', '转折点位置按本层预算放，不是死板等分。'),
  'six-act': card('①进入 ②首次转向 ③升级 ④危机 ⑤重整 ⑥解决', '六项是责任不是固定章数，阶段过多会切碎节奏。'),
  'hero-journey': card('熟悉处境→跨入陌生→考验与代价→获得与回归', '导师、门槛等名词不许机械逐项打卡。'),
  'eight-sequence': card('数个职责不同的推进区段，每段造成新状态', '区段不是固定章数；中段必须改变后半段的策略或意义。'),
  'seven-point': card('两次主动转向＋外部施压＋中点重释前后内容', '节点服务人物动机，不能让节点比人物更显眼。'),
  'story-circle': card('需要→进入陌生→得到与代价→回归与改变', '内心变化必须有外部行动承载，不能只有感悟。'),
  'save-the-cat': card('尽早兑现卖点→中段改变胜负意义→代价逼近→新选择完成高潮', '不逐拍照搬、不固定比例、不用打脸代替变化。'),
  'truby-22': card('欲望绑定弱点→对手攻击缺口→计划互相改变→自我揭示与新平衡', '不一次注入全部步骤，人物不能被结构工具化。'),
  'field-paradigm': card('前段入局→第一转折→中段改变策略→第二转折→集中解决', '不换算成固定页码或比例。'),
  'fichtean-curve': card('快速进入冲突→因果相连的危机逼近高潮→短篇幅结算', '每次解决必须制造下一次更难的局面，危机彼此要有因果。'),
  'kishotenketsu': card('建立日常→细节深化→意外视角重释→前后连成新意义', '“转”是重释而非冲突；没有转变就只剩流水账。'),
  // ---- 全书形态（只在全书层做主拓扑候选） ----
  'single-core-line': card('一条长期问题贯穿推进，其余内容服务或反衬主线', '支线不能长期夺走主线的结果。'),
  'dual-lead-braid': card('两位核心人物各自推进，又不断相互改变', '一位角色明显只是工具人时不适用。'),
  'multi-line-network': card('多线各自有目标与进度，共享因果时切换交汇', '每次切线必须带来新信息或新后果。'),
  'episodic-spine': card('每个单元解决一个完整问题，长期人物与谜团持续积累', '单元结束不能一切归零。'),
  'ensemble-network': card('一组人物的选择共同改变整体局势', '保持阶段焦点，避免平均分配戏份。'),
  'linked-anthology': card('各篇独立可读，共享世界、物件或主题累积出更大整体', '只有同一背景而没有累计变化时不适用。'),
  'parallel-contrast-structure': card('两条独立线在相似处境中作不同选择，互相映照', '只轮流叙述而没有对照价值时不要使用。'),
  'mosaic-network': card('不同人物、地点或材料提供碎片，读者逐渐拼出整体', '碎片彼此无因果也无共同意义时不适用。')
});

/** 剧情配方提名卡：节奏线＝本配方各阶段承担的变化（有几段画几段）。 */
export const V7_RECIPE_NOMINATION_CARDS: Readonly<Record<string, NominationCard>> = Object.freeze({
  // ---- 通用卷/事件配方 ----
  'grow-into-responsibility': card('缺口暴露→旧办法受挫→责任压上来→无人代替的选择→结果检验成长', '成长必须由选择和后果证明，不能只靠等级或他人宣布。'),
  'loss-and-rebuild': card('建立立足点→隐患显形→核心依靠失效→从失败重想→带着代价重建', '低谷不能来自突然惩罚，重建也不能恢复成原样。'),
  'escalating-consequences': card('小问题启动→解决留下后果→问题扩大→关闭退路→集中结算', '不能只换更强敌人，每一次扩大都要改变问题性质。'),
  'layered-truth': card('问题落到人物→多源证据→合理但不完整的结论→关键证据重释→回答本层真相', '必须回答本层承诺，不能永远只抛出更大的谜。'),
  'balance-of-power': card('利益底线显形→互相试探→有效反制→关键换边→结算新格局', '谋略不能依赖对手突然变笨，后手都要有事前依据。'),
  'relationship-redefines-goal': card('真实分歧→共同承担→边界受检验→为后果负责→确认新位置', '不用重复误会拖延，一方不能只服务另一方成长。'),
  'accumulate-and-stress-test': card('迫切缺口→第一条运转路径→利益分配冲突→外部危机检验→结算基本盘', '建设不能写成清单，检验的是体系而不是主角外挂。'),
  'trigger-and-response': card('日常被改变→按本能回应→回应遇阻→主动选择路线→可承接结果', '麻烦必须切中人物利益，外力不能替人物完成结果。'),
  'capability-under-pressure': card('误判成立→限制下准备→代价升高→公开检验→位置重排', '爽点必须留下资格、关系或资源变化，不能只写围观震惊。'),
  'victory-with-cost': card('认真争取→取得真实结果→结果异常→更大代价到来→确定下一问题', '小胜不能立刻作废，新代价必须来自胜利的合理后果。'),
  'failure-to-breakthrough': card('执行旧办法→失败造成损失→重看规则→采用不同方法→阶段突破', '突破口必须来自此前信息，不能在失败后突然开挂。'),
  'clues-reframe-understanding': card('限定问题→多源线索→按暂时判断行动→旧线索重释→决定下一步', '线索数量不能替代证据链，关键答案必须可回看验证。'),
  'factions-change-sides': card('表面位置→行动试探→有效反制→关键选择换边→新阵营结算', '换边必须符合长期利益或价值，不能只为主角服务。'),
  'relationship-forces-choice': card('分歧落到行动→共同承担→信任边界受检→承担各自后果→可拒绝的选择', '不能用危险强迫当爱情证明，也不能强迫受伤者原谅。'),
  'hope-loss-choice': card('希望出现→为希望投入→依靠失效→两种代价间选择→保留余波', '失去不能只为虐，最后不能突然出现无代价第三解。'),
  // ---- 题材配方 ----
  'dungeon-expedition-run': card('副本冒险→失落遗迹探索→规则陷阱→隐藏代价显形→关键资源到手', '不能把每层写成换皮打怪，发现必须改变路线和后续。'),
  'tournament-run': card('资格试炼→淘汰赛竞技→强敌压制→创新破局→赛事结果兑现', '每轮必须检验不同能力，输赢后都要更新排名、伤病和关系。'),
  'academy-growth-cycle': card('学院考核→拜师学习→内部路线分裂→创新破局→身份晋升', '校园关系不能只服务考试，考核必须回收训练和选择。'),
  'staged-revenge': card('案件调查→打入内部→证据重释→两难选择→阶段复仇结算', '不能把所有障碍都写成更大幕后黑手，也不能忽略无辜者。'),
  'fair-case-investigation': card('案件调查→证据诱捕→情报不完整→真凶换位→责任追究', '答案必须来自已展示证据，揭晓后还要结算人的后果。'),
  'infiltration-and-extraction': card('潜入行动→伪装身份→秘密暴露风险→暗案显形→脱离险境', '计划必须提前可见，变数来自环境和人物而非凭空改规则。'),
  'countdown-rescue': card('救援行动→团队分工→倒计时→连带伤害→救援完成', '被救者不能只是道具，倒计时不可随意暂停。'),
  'survival-collapse-rebuild': card('据点求生→生产危机→内部路线分裂→创新破局→阶段生存稳定', '不能靠无限仓库解决，也不能只报物资数量。'),
  'campaign-to-aftermath': card('连续战役→声东击西→资源匮乏→牺牲改写局势→局势余波', '战斗不能脱离补给、平民和政治，决战胜利不等于治理成功。'),
  'court-power-struggle': card('朝堂议决→建立联盟→制度限制→争取对手→规则改变', '不能只写嘴炮和密谋，各方资源、制度与群众基础要真实。'),
  'kingdom-building-cycle': card('领地开发→创新破局→内部路线分裂→守城攻防→地盘与基本盘扩大', '发展数据必须通过人物生活和冲突体现，扩张后要承担治理。'),
  'business-war-cycle': card('职场项目→创新破局→商业竞标→名誉风险→商业阶段胜利', '商业胜负不能只靠发布会和舆论，现金、履约与组织能力要进入剧情。'),
  'workplace-project-cycle': card('职场项目→团队分工→制度限制→创新破局→身份晋升', '不能用术语代替专业判断，项目成功不等于所有关系和解。'),
  'entertainment-rise-cycle': card('公开演出→团队组建→公开注视→隐藏代价显形→作品获得认可', '作品质量和行业选择要可见，不能只写热搜和全网吹捧。'),
  'sports-championship-cycle': card('正式赛事→训练巩固→伤病限制→团队分工→赛事结果兑现', '必须让团队、伤病和对手策略改变比赛，不能只靠主角个人爆发。'),
  'romance-commitment-cycle': card('故地重返→照护共处→关系十字路口→理解与补偿→关系确认', '不能用误会拖满全程，也不能让一方丧失独立目标。'),
  'marriage-crisis-repair': card('家庭聚会→债务与承诺→秘密暴露风险→理解与补偿→信任修复', '修复不等于强迫原谅，结束关系也可以是完整结算。'),
  'family-legacy-cycle': card('家庭聚会→照护共处→遗产真相→两难选择→家庭和解或重订边界', '不能用血缘强迫和解，也不能把老一代只写成阻碍。'),
  'science-discovery-cycle': card('未知远征→创新破局→情报不完整→隐藏代价显形→分层放出信息', '科学突破不能靠一句天才灵感，验证、复现和伦理后果要存在。'),
  'apocalypse-refuge-cycle': card('迁徙与撤离→聚落建立→资源匮乏→守城攻防→阶段生存稳定', '据点不是万能安全区，普通成员的劳动、恐惧和规则要可见。'),
  'infinite-instance-cycle': card('副本冒险→规则陷阱→连续失败→规则重释→脱离险境', '规则必须稳定可验证，通关不能让人物和长期线全部归零。')
});

export const NOMINATION_CARD_MAX_CHARS = 100;

export function getMethodNominationCard(methodKey: string): NominationCard | null {
  return V7_METHOD_NOMINATION_CARDS[methodKey] ?? null;
}

export function getRecipeNominationCard(recipeKey: string): NominationCard | null {
  return V7_RECIPE_NOMINATION_CARDS[recipeKey] ?? null;
}

/** 卡片进入任务输入时的完整文本：名字：节奏线。注意：防误读。 */
export function nominationCardText(publicName: string, nomination: NominationCard): string {
  return `${publicName}：${nomination.stageRhythm}。注意：${nomination.guard}`;
}

export function validateNominationCards(): string[] {
  const errors: string[] = [];
  const check = (key: string, publicName: string | undefined, nomination: NominationCard, label: string): void => {
    if (publicName === undefined) {
      errors.push(`提名卡引用了不存在的${label}：${key}`);
      return;
    }
    if (nomination.stageRhythm.trim().length === 0 || nomination.guard.trim().length === 0) {
      errors.push(`提名卡字段为空：${key}`);
      return;
    }
    const length = nominationCardText(publicName, nomination).length;
    if (length > NOMINATION_CARD_MAX_CHARS) errors.push(`提名卡超过${NOMINATION_CARD_MAX_CHARS}字（${length}）：${key}`);
  };
  for (const [key, nomination] of Object.entries(V7_METHOD_NOMINATION_CARDS)) {
    check(key, getNarrativeMethod(key)?.professionalName, nomination, '方法');
  }
  for (const [key, nomination] of Object.entries(V7_RECIPE_NOMINATION_CARDS)) {
    check(key, getPlotRecipe(key)?.publicTitle, nomination, '配方');
  }
  // 两组必须配卡的方法组：宏观节奏框架与全书形态；配方库全部配卡。
  for (const group of ['macro-framework', 'book-topology']) {
    const uncovered = V7_NARRATIVE_METHODS
      .filter((item) => item.exclusiveGroup === group && V7_METHOD_NOMINATION_CARDS[item.key] === undefined)
      .map((item) => item.key);
    if (uncovered.length > 0) errors.push(`${group} 组缺少提名卡：${uncovered.join('、')}`);
  }
  const uncoveredRecipes = V7_PLOT_RECIPES.filter((item) => V7_RECIPE_NOMINATION_CARDS[item.key] === undefined).map((item) => item.key);
  if (uncoveredRecipes.length > 0) errors.push(`配方缺少提名卡：${uncoveredRecipes.join('、')}`);
  return errors;
}
