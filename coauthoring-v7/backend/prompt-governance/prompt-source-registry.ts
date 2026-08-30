import { V7_ROLE_CONTRACTS } from '../agent-governance/agent-governance-registry.js';
import type { V7AgentTaskKind } from '../agent-governance/agent-governance-contracts.js';
import type {
  V7GenrePersonaContent,
  V7PromptAssetVersion,
  V7RolePromptContent,
  V7SkillContent,
  V7WorkstationKey,
  V7WorkstationPromptContent
} from './prompt-governance-contracts.js';

const CREATED_AT = '2026-08-28T00:00:00.000Z';
const CREATED_BY = 'v7-source-registry';
const SOURCE_VERSION_OVERRIDES: Readonly<Record<string, number>> = {
  // 已进入真实本地库的 @1 版本不可覆盖。下列资产在轻量流程收敛后
  // 发布 @2，历史任务仍继续引用 @1。
  'workstation.chapter_outline': 2,
  'skill.data-boundary': 2,
  'skill.evidence-review': 2
};

export const V7_ROLE_PROMPT_ASSETS: readonly V7PromptAssetVersion[] = V7_ROLE_CONTRACTS.map((role) => asset(
  `role.${role.roleKey}`,
  'role_prompt',
  role.publicName,
  role.publicResponsibility,
  {
    roleKey: role.roleKey,
    responsibility: role.publicResponsibility,
    capabilities: role.capabilities,
    permissions: role.tools,
    boundaries: [role.outputContract, '只处理当前任务合同，不把题材偏好永久绑定到成员。', '不输出思维链、密钥、协议字段或内部执行过程。'],
    failureContract: role.failureContract
  } satisfies V7RolePromptContent
));

const WORKSTATIONS: ReadonlyArray<readonly [V7WorkstationKey, string, readonly V7AgentTaskKind[], string, readonly string[], readonly string[], readonly string[], string]> = [
  ['opening', '开书资料', ['opening_design', 'opening_review'], '把作者想法变成稳定、可修改、能支撑后续创作的开书资料。', ['作者原始想法', '当前开书候选', '书级题材工作档案'], ['其他书资料', '分卷与正文细节'], ['忠于明确主角和时代', '开书字段互相一致', '不抢写后续剧情'], '只负责开书资料，不把未来计划写成已经发生。'],
  ['setting', '设定设计', ['setting_recommendation', 'setting_design', 'setting_review', 'planning_context'], '只准备本书真正需要的设定，并让每项能被后续规划准确调用。', ['正式开书资料', '已确认设定', '本轮作者意见', '书级题材工作档案'], ['无关题材条目', '过期候选', '未来正文事实'], ['条目与题材相关', '设定之间不冲突', '颗粒度足够但不堆长文'], '设定是创作依据，不提前锁死具体事件。'],
  ['full_book_route', '全书路线', ['planning_context', 'planning_recipe', 'planning_tree', 'planning_review', 'planning_maintenance'], '规划全书粗路线、卷数、阶段回报、商业受众与追读定位。', ['正式开书与设定', '预计总字数', '当前实际结算', '少量方法候选'], ['完整方法库', '未确认候选', '逐章细节'], ['容量匹配总字数', '卷间因果递进', '阶段回报明确', '保留创意空间'], '全书路线是可调整上游方向，不能冒充正文实际。'],
  ['volume', '卷方案', ['planning_context', 'planning_recipe', 'planning_tree', 'planning_review'], '把选定全书路线展开为当前卷责任和事件链边界。', ['选定全书路线', '当前卷责任', '最新正式资料', '少量卷级参考'], ['其他未采用路线', '完整资产库', '逐章正文'], ['本卷目标与卷末变化明确', '事件链有承接', '不重复前卷'], '只细化当前卷，不重写全书路线。'],
  ['chain', '单元链', ['planning_context', 'planning_recipe', 'planning_tree', 'planning_review'], '设计短而有兑现的具体推进、回报、情绪、伏笔与章纲责任。', ['当前卷方案', '当前链前置状态', '相关人物事实', '少量剧情候选'], ['无关卷资料', '整套剧情库', '未确认未来事实'], ['4至8章内有明确回报', '因果闭合', '状态发生变化', '伏笔有责任'], '只设计当前链，不能替正文宣告实际结果。'],
  ['chapter_outline', '章纲', ['chapter_outline', 'chapter_outline_review'], '把当前链责任变成可以直接写的章纲，并在确认前核对承接、因果、逐章变化和回报。', ['当前链', '相关人物与事实', '上一章落点', '待审章纲'], ['无关全书资料', '其他候选章纲'], ['场景具体可写', '人物行为有动机', '章末状态有变化', '链内回报不拖沓', '审查者与设计者模型不同'], '章纲约束本章责任，不代替正文；审查不直接覆盖候选。'],
  ['manuscript', '正文', ['manuscript'], '依据确认章纲与正式资料写出自然、具体、有作者声音的完整正文。', ['确认章纲', '最小人物与事实资料', '相邻正文'], ['未确认未来计划', '完整方法库', '其他主笔草稿'], ['事实准确', '人物声音稳定', '语言自然', '本章责任兑现'], '不能擅改上游事实；创意集中在场景表达与人物行动。'],
  ['review', '独立审查', ['manuscript_review'], '独立检查事实、连续性、人物、节奏、文学性和明显AI腔，并给出可执行修改。', ['待审正文', '确认章纲', '正式事实证据'], ['主笔思维过程', '无关全书资料'], ['每条问题有证据', '区分必须改与可优化', '不把个人偏好冒充错误'], '同模型不得伪装成独立审查；审查不直接覆盖原文。'],
  ['continuity_record', '定稿记录', ['settlement', 'character_context', 'character_maintenance', 'planning_maintenance'], '正文定稿后增量维护人物、事实、关系、故事线、伏笔和开放问题。', ['不可变正文版本', '上次正式状态', '本章确认结果'], ['候选规划', '模型猜测', '其他书记录'], ['每条记录可追溯到正文', '重复事实合并', '不确定内容保持候选'], '只记录正文实际，不反向改写正文。'],
  ['title', '书名设计', ['title_design'], '设计与本书卖点一致、清楚吸睛且不虚假承诺的书名候选。', ['正式开书资料', '发布平台', '作者方向'], ['无关热门书名', '其他书资料'], ['一眼看出具体卖点', '与内容一致', '候选有明显差异'], '书名是候选，作者采用后才进入正式资料。'],
  ['cover_brief', '封面制作单', ['cover_brief'], '把书名、题材、卖点、平台和笔名整理成可执行视觉制作单。', ['正式开书资料', '采用书名', '作者笔名', '视觉偏好'], ['模型密钥', '其他作品封面'], ['标题与笔名准确', '构图适配手机封面', '禁项清楚'], '只制定制作单，不伪装已生成图片。'],
  ['cover_render', '封面出图', ['cover_render'], '按已确认制作单生成可保存下载的封面图。', ['封面制作单', '尺寸与格式'], ['文秘写作字样', '未授权标志'], ['画面符合制作单', '不含平台标志', '署名使用作者笔名'], '只交付图片结果与必要错误，不扩写作品内容。']
];

export const V7_WORKSTATION_PROMPT_ASSETS: readonly V7PromptAssetVersion[] = WORKSTATIONS.map((entry) => workstation(...entry));

type GenreSeed = readonly [string, string, readonly string[], readonly string[], readonly string[], readonly string[]];
const GENRES: readonly GenreSeed[] = [
  ['fantasy', '玄幻', ['玄幻脑洞', '传统玄幻', '东方玄幻', '异世大陆', '高武世界', '御兽'], ['清晰的成长与世界规则', '持续升级后的新局面'], ['能力、资源与代价前后一致', '强弱变化可解释'], ['只换境界名的重复升级', '世界规则随剧情改口']],
  ['xianxia', '仙侠修真', ['东方仙侠', '奇幻仙侠', '古典仙侠', '修真文明', '现代修真'], ['修行选择、因果与超越', '境界成长伴随人物变化'], ['修炼资源与门槛可信', '宗门和世界秩序可运行'], ['堆设定不落人物', '奇遇替代行动']],
  ['history', '历史与架空', ['历史古代', '历史脑洞', '架空历史', '秦汉三国', '两宋元明', '朝堂江湖'], ['人物在时代约束中改变局面', '历史质感与明确目标并存'], ['年代、制度、交通和势力符合背景', '改写历史有连续代价'], ['现代常识无成本碾压', '真实人物工具化']],
  ['war_spy', '军事谍战', ['军事战争', '抗战烽火', '谍战特工', '抗战谍战'], ['任务压力、阵营选择与家国代价', '情报和行动互相推动'], ['情报来源可追溯', '战术受资源和地形约束'], ['靠巧合泄密', '敌我集体降智']],
  ['urban', '都市现实', ['都市脑洞', '都市生活', '都市日常', '商战职场', '娱乐明星'], ['现实关系与职业目标持续变化', '人物获得可感知的生活回报'], ['职业流程和社会规则可信', '矛盾来自人物利益'], ['用标签代替生活细节', '无成本阶层跨越']],
  ['romance', '言情与关系', ['古代言情', '现代言情', '玄幻言情', '仙侠奇缘', '豪门总裁', '青春甜宠'], ['关系变化来自具体选择', '情感回报与人物成长并行'], ['双方动机独立', '关系阶段有行为证据'], ['误会拖延替代剧情', '一方沦为奖励']],
  ['palace', '宫斗宅斗', ['宫斗宅斗', '古风世情', '朝堂江湖'], ['有限规则中的生存与关系博弈', '每次得失改变人物位置'], ['礼法、家族和资源约束稳定', '信息差有来源'], ['全员恶人扁平化', '阴谋只靠作者隐瞒']],
  ['suspense', '悬疑推理', ['悬疑脑洞', '悬疑灵异', '侦探推理', '诡秘悬疑', '民俗悬疑', '悬疑恋爱'], ['问题驱动阅读并公平兑现', '真相改变人物与局面'], ['线索可回看', '信息隐藏符合视角'], ['谜底靠新增设定', '反转只为惊吓']],
  ['scifi', '科幻未来', ['科幻末世', '未来世界', '星际文明', '超级科技', '赛博朋克'], ['技术或环境变化逼迫人物作选择', '宏观议题落到具体生活'], ['核心科技规则稳定', '社会后果可推演'], ['术语堆砌', '科技万能且无代价']],
  ['apocalypse', '末世生存', ['末世', '废土求生', '进化变异', '科幻末世'], ['资源压力与群体关系持续升级', '生存决定有不可逆后果'], ['物资与距离可核算', '威胁规则一致'], ['无限物资削弱压力', '危机重复无变化']],
  ['game_sports', '游戏竞技', ['游戏异界', '虚拟网游', '电子竞技', '游戏竞技', '体育赛事'], ['规则内成长、对抗与胜负兑现', '训练选择改变比赛'], ['规则与数据一致', '对手有明确策略'], ['面板替代剧情', '胜利只靠临时开挂']],
  ['business_lord', '经营基建', ['领主争霸', '种田经营', '基建发展', '商业经营', '都市种田'], ['投入、建设和扩张带来可见成果', '人与组织共同成长'], ['资源流转可信', '组织能力有上限'], ['流水账建设', '现代方案无成本落地']],
  ['martial', '武侠江湖', ['传统武侠', '武侠幻想', '国术无双'], ['武力选择与江湖道义彼此冲突', '胜负改变关系和名望'], ['武学能力有边界', '门派与江湖秩序可解释'], ['只打不选', '侠义口号化']],
  ['western_fantasy', '西方奇幻', ['西方奇幻', '史诗奇幻', '剑与魔法', '黑暗幻想', '现代魔法'], ['陌生世界的冒险、阵营与成长', '力量体系服务文化差异'], ['种族与魔法规则稳定', '世界文化不只是换名'], ['设定百科化', '套用东方体系换皮']],
  ['reality_era', '现实年代', ['现实题材', '现实生活', '年代', '社会乡土', '生活时尚'], ['人物在真实生活压力中获得变化', '时代细节承载情感'], ['物价、职业、生活习惯符合年代', '矛盾不过度戏剧化'], ['苦难堆砌', '时代只当装饰']],
  ['derivative', '衍生创作', ['动漫衍生', '影视衍生', '男频衍生', '女频衍生', '综漫'], ['尊重既有世界逻辑并创造新的主角价值', '熟悉感与新意同时兑现'], ['授权与公共文化边界明确', '原作人物不为新主角降智'], ['复述原剧情', '借角色名替代塑造']]
];

export const V7_GENRE_PERSONA_ASSETS: readonly V7PromptAssetVersion[] = GENRES.map(([key, name, aliases, promises, checks, failures]) => asset(
  `genre.${key}`,
  'genre_persona',
  `${name}题材人设`,
  `供题材融合编排使用的${name}原子卡，不直接整卡拼入任务提示。`,
  {
    genreKey: key,
    publicName: name,
    aliases,
    readerPromise: promises,
    creativePriorities: promises.map((item) => `优先用具体人物行动兑现：${item}`),
    authenticityChecks: checks,
    commonFailures: failures,
    fusionBoundary: '主体题材决定主要阅读承诺；融合题材只补充其最有价值的功能。冲突时必须说明取舍，不机械拼接术语或完整题材卡。'
  } satisfies V7GenrePersonaContent
));

const SKILLS: ReadonlyArray<readonly [string, string, readonly V7AgentTaskKind[], readonly string[], readonly string[], readonly string[]]> = [
  ['data-boundary', '资料可信与候选边界', V7_ROLE_CONTRACTS.flatMap((item) => item.taskKinds), ['核对账号、书籍、活动版本和任务合同', '区分作者原话、正式资料、正文实际、候选与参考', '只读取当前任务需要的最小来源'], ['正式资料读取', '版本核对', '问题反馈'], ['来源缺失或版本变化', '作者硬要求互相冲突']],
  ['intent-translation', '作者意图转译', ['opening_design', 'setting_recommendation', 'planning_context', 'character_context'], ['保留作者原话中的明确人物、时代、关系和禁项', '区分硬要求、软倾向与开放空间', '把模糊愿望转成当前工位可执行责任'], ['作者输入读取', '问题反馈'], ['无法确认谁是主角', '两种根本方向无法同时成立']],
  ['genre-fusion', '融合题材工作档案', ['opening_design', 'planning_context'], ['确认主体题材的核心承诺', '为每个融合题材只选择一到两项辅助功能', '解决题材冲突并形成一份简短统一档案', '列出真实性检查和常见失败'], ['题材卡读取', '正式开书资料读取'], ['没有主体题材', '融合方向与作者硬禁项冲突']],
  ['option-differentiation', '候选方案差异化', ['title_design', 'planning_recipe', 'planning_tree', 'setting_design'], ['先锁定共同硬约束', '每套候选选择不同但可行的因果路径', '用故事结果说明差异，不用更换术语冒充差异'], ['正式资料读取', '少量参考读取'], ['候选实质重复', '差异会违背作者硬要求']],
  ['evidence-review', '独立证据审查', ['opening_review', 'setting_review', 'planning_review', 'chapter_outline_review', 'manuscript_review'], ['逐条引用当前版本证据', '区分错误、风险与个人偏好', '给出可执行的最小修改', '需要作者决定时只保留真正分歧'], ['正式资料读取', '候选或正文读取', '证据引用'], ['审查者与生成者模型相同且任务要求独立', '证据版本不匹配']],
  ['natural-prose', '自然正文创作', ['manuscript'], ['先明确场景目标和人物动机', '用动作、对话与感官细节推进', '控制解释密度并避免总结腔', '让章末变化来自本章行动'], ['章纲读取', '相关正文检索'], ['章纲与正式事实冲突', '缺少必要人物状态']],
  ['incremental-canon', '定稿增量记录', ['settlement', 'character_maintenance', 'planning_maintenance'], ['只从本次定稿正文提取新增或改变', '对照上一正式状态去重', '保留正文证据位置', '不确定内容进入候选或开放问题'], ['不可变正文读取', '正式状态读取', '候选记录写入'], ['正文尚未定稿', '活动正文版本变化']]
];

export const V7_SKILL_PROMPT_ASSETS: readonly V7PromptAssetVersion[] = SKILLS.map(([key, title, tasks, procedure, tools, stops]) => asset(
  `skill.${key}`,
  'skill',
  title,
  `按需加载的专业流程：${title}。`,
  {
    skillKey: key,
    responsibility: title,
    triggerTaskKinds: tasks,
    procedure,
    allowedTools: tools,
    stopConditions: stops,
    outputRequirements: ['只返回当前任务输出合同要求的内容', '不输出思维链、密钥、协议字段或工具日志']
  } satisfies V7SkillContent
));

export const V7_PROMPT_SOURCE_ASSETS: readonly V7PromptAssetVersion[] = [
  ...V7_ROLE_PROMPT_ASSETS,
  ...V7_WORKSTATION_PROMPT_ASSETS,
  ...V7_GENRE_PERSONA_ASSETS,
  ...V7_SKILL_PROMPT_ASSETS
];

export const V7_TASK_ALLOWED_WORKSTATIONS: Readonly<Record<V7AgentTaskKind, readonly V7WorkstationKey[]>> =
  Object.fromEntries([...new Set(V7_WORKSTATION_PROMPT_ASSETS.flatMap((entry) =>
    (entry.content as V7WorkstationPromptContent).taskKinds))].map((taskKind) => [
    taskKind,
    V7_WORKSTATION_PROMPT_ASSETS
      .map((entry) => entry.content as V7WorkstationPromptContent)
      .filter((content) => content.taskKinds.includes(taskKind))
      .map((content) => content.workstationKey)
  ])) as unknown as Readonly<Record<V7AgentTaskKind, readonly V7WorkstationKey[]>>;

export function publishedAsset(assetKey: string, assets: readonly V7PromptAssetVersion[] = V7_PROMPT_SOURCE_ASSETS): V7PromptAssetVersion {
  const matches = assets.filter((item) => item.assetKey === assetKey && item.status === 'published')
    .toSorted((left, right) => right.version - left.version);
  if (matches[0] === undefined) throw new Error(`缺少已发布提示资产：${assetKey}`);
  return matches[0];
}

export function defaultSkillAssets(taskKind: V7AgentTaskKind): V7PromptAssetVersion[] {
  return V7_SKILL_PROMPT_ASSETS.filter((item) => (item.content as V7SkillContent).triggerTaskKinds.includes(taskKind));
}

export function matchGenreAssets(labels: readonly string[]): V7PromptAssetVersion[] {
  const normalized = labels.map((item) => item.trim()).filter(Boolean);
  return V7_GENRE_PERSONA_ASSETS.filter((item) => {
    const content = item.content as V7GenrePersonaContent;
    return normalized.some((label) => label === content.publicName || content.aliases.includes(label));
  });
}

function workstation(
  key: V7WorkstationKey,
  name: string,
  tasks: readonly V7AgentTaskKind[],
  responsibility: string,
  required: readonly string[],
  forbidden: readonly string[],
  checks: readonly string[],
  boundary: string
): V7PromptAssetVersion {
  return asset(`workstation.${key}`, 'workstation_prompt', `${name}工位`, responsibility, {
    workstationKey: key,
    publicName: name,
    taskKinds: tasks,
    responsibility,
    requiredInputs: required,
    forbiddenInputs: forbidden,
    qualityChecks: checks,
    stageBoundary: boundary
  } satisfies V7WorkstationPromptContent);
}

function asset(
  assetKey: string,
  kind: V7PromptAssetVersion['kind'],
  title: string,
  summary: string,
  content: Readonly<Record<string, unknown>>
): V7PromptAssetVersion {
  const version = SOURCE_VERSION_OVERRIDES[assetKey] ?? 1;
  return {
    assetId: `${assetKey}@${version}`, assetKey, kind, version, status: 'published', title, summary, content,
    createdAt: CREATED_AT, createdBy: CREATED_BY, basedOnVersion: version > 1 ? version - 1 : null
  };
}
