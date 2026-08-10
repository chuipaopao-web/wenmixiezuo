import { createHash } from 'node:crypto';

export interface DeterministicChapterPlan {
  location: string;
  objective: string;
  opponent: string;
  ally: string;
  setback: string;
  insight: string;
  payoff: string;
  hook: string;
}

interface XianxiaNames {
  hero: string;
  xu: string;
  su: string;
  ajiu: string;
  han: string;
  wei: string;
}

interface EsportsNames {
  hero: string;
  tang: string;
  lu: string;
  qiao: string;
  shao: string;
  luo: string;
}

const phaseActions = [
  '压力落到主角身上，所有人必须先表态', '核对规则与第一处异常，不让猜测冒充事实',
  '同伴主动加入并提出不同判断', '第一次执行受阻，真实代价被留下',
  '对手读懂旧办法并主动改变策略', '队伍因目标不同发生可解释的分歧',
  '一份可以回查的证据打开新路径', '众人付出代价完成中段反制',
  '多名角色并行完成决战准备', '事件结果兑现，并把新状态交给下一事件'
] as const;

const xianxiaEvents = [
  { location: '灵矿总阵', objective: '保住矿工并验证沈铸旧阵图', opponent: '矿监石无咎', ally: '裴照', setback: '总阵轮换密钥提前失效，强开阵门会暴露残阵盘', insight: '矿石灵流被导向内门，而旧阵图记录的是安全停机次序', payoff: '小队截下转运证据并证明沈铸曾救过矿工', hook: '宗门以非法闯矿为由启动内门夺席审查' },
  { location: '内门夺席台', objective: '在公开规则内争到继续调查的资格', opponent: '主持审查的内门长老', ally: '韩烈', setback: '赛制临时改动，沈砚旧伤又在关键轮发作', insight: '夺席阵眼与灵矿锁阵使用同一份权限', payoff: '沈砚靠团队分工夺得席位，韩烈成为有限证人', hook: '新增权限指向冰河秘境的阵脉观测站' },
  { location: '冰河秘境', objective: '救出失联弟子并保住阵脉观测记录', opponent: '持续改写地形的冰阵', ally: '苏青萝', setback: '救人与取证只能先做一件，求救信号中还混着假讯息', insight: '灾变不是自然发生，记录被内门权限删改过', payoff: '众人救出弟子并带回一份来源可信的残缺记录', hook: '删改后的记录反而把罪名指向沈铸' },
  { location: '宗门执法殿', objective: '拆穿伪造时间线并守住调查队的合法性', opponent: '执法长老谢玄', ally: '许小川', setback: '全部证据被封存，裴照作证会失去真传资格', insight: '所谓旧记录用了三年前尚不存在的阵墨', payoff: '小队证明记录被事后伪造，拿到北境阵城调令', hook: '调令显示阵城将在七日后被主动断供' },
  { location: '北境阵城', objective: '在妖潮抵达前修复城防并找回失踪补给', opponent: '被人为引导的妖潮', ally: '阿九', setback: '启动备用阵会耗尽民用灵库，分兵又会削弱城防', insight: '妖潮路线与阵脉抽取点完全重合', payoff: '群像分线守住阵城并抓到操纵妖潮的活证人', hook: '证人供出九峰阵脉即将同时过载' },
  { location: '青霄宗九峰', objective: '阻断阵脉连锁过载并保住九峰弟子', opponent: '持续发出假调令的幕后长老', ally: '许小川', setback: '九峰规则不同，沈砚的阵寒暗伤不断恶化', insight: '父亲旧阵图其实是一套可公开验证的安全停机方案', payoff: '众人各守一峰完成抢修，却发现核心阵权已被复制', hook: '掌门单独召见沈砚，要用父亲罪名交换阵权归位' },
  { location: '掌门核心阵室', objective: '辨认掌门立场并冻结被复制的核心阵权', opponent: '被刻意分割的信息与联合印', ally: '裴照', setback: '拒绝交易会触发清洗，伙伴擅闯核心区会被逐宗', insight: '掌门知道部分真相却选择压下，复制阵权来自长老联合印', payoff: '沈砚拒绝私下交易，迫使掌门同意九峰公审', hook: '魏长庚越狱并带走最后一枚原始联合印' },
  { location: '九峰公审台', objective: '保住证据与阵脉，在公开审理中完成阶段翻案', opponent: '握有反证的魏长庚与联合长老', ally: '苏青萝', setback: '追捕魏长庚与守住公审只能分兵，阵脉又出现过载', insight: '沈铸当年承担叛名是为延迟阵脉崩坏，联合印仍有一枚来自宗外', payoff: '众人洗去沈铸一半污名并冻结涉案长老阵权', hook: '宗外联合印与沈铸下落把故事推向下一卷' }
] as const;

export function longXianxiaPlan(chapterNumber: number, names: XianxiaNames): DeterministicChapterPlan {
  const eventIndex = Math.max(2, Math.min(9, Math.floor((chapterNumber - 1) / 10)));
  const phaseIndex = Math.max(0, (chapterNumber - 1) % 10);
  const event = xianxiaEvents[eventIndex - 2]!;
  const allies = [names.xu, names.su, names.ajiu, names.han, event.ally];
  const opponents = [names.wei, event.opponent];
  return {
    location: event.location,
    objective: `${event.objective}；本章要完成“${phaseActions[phaseIndex]}”`,
    opponent: opponents[(eventIndex + phaseIndex) % opponents.length]!,
    ally: allies[(eventIndex * 2 + phaseIndex) % allies.length]!,
    setback: `${event.setback}；第${phaseIndex + 1}步不能靠新增能力跳过`,
    insight: `${event.insight}，但这条判断仍要由人物行动继续验证`,
    payoff: phaseIndex === 9 ? event.payoff : `${names.hero}与同伴完成当前一步，让局势真实推进而没有提前结算事件`,
    hook: phaseIndex === 9 ? event.hook : `${event.location}的下一处变化迫使众人重新选择站位`
  };
}

const esportsEvents = [
  { location: '零帧公开试训室', objective: '让替补阵容击败主力并拿到十场短约', opponent: '邵锋率领的试训主力', ally: '唐梨', setback: '训练数据被裁剪，替补彼此不熟悉', insight: '缺口集中在对手换线前的帧率波动，数据只能指出问题不能替人决策', payoff: '零帧替补完成逆选，顾野拿到短约', hook: '新秀杯报名截止前必须打足晋级积分' },
  { location: '新秀杯赛场', objective: '形成第一套共同打法并赢得赛季合同', opponent: '极昼二队', ally: '陆沉舟', setback: '陌生版本样本不足，邵锋故意制造假习惯', insight: '一次败局揭示经济曲线的适用边界，队伍必须允许临场修正', payoff: '零帧连胜晋级，顾野获得赛季合同', hook: '训练录像在开赛前流入匿名论坛' },
  { location: '联盟数据审计室', objective: '查清泄露路径并保住乔麦的职业清白', opponent: '被改写的设备日志', ally: '乔麦', setback: '停用旧系统会失去备战优势，队员开始互相怀疑', insight: '泄露来自设备同步而非乔麦手动导出', payoff: '队伍找到同步漏洞，证据进入联盟留档', hook: '城市联赛必须在停用旧系统后开打' },
  { location: '城市联赛客场', objective: '证明没有旧数据系统仍能靠共同判断赢比赛', opponent: '重岳战队', ally: '唐梨', setback: '视野数据延迟，陆沉舟必须轮休关键局', insight: '异常帧率只出现在零帧席位，与供应商权限同源', payoff: '零帧用临场视野语言击败重岳并取得季后赛资格', hook: '资本方要求三日内出售战队席位' },
  { location: '零帧合同会议室', objective: '保住席位与人物选择，不让团结只剩口号', opponent: '罗放关联公司的转会合同', ally: '陆沉舟', setback: '工资欠付，每名队员承担的现实压力不同', insight: '四份报价都要求放弃历史数据权，来源能互相印证', payoff: '四人以不同理由共同买下短期运营权', hook: '为偿还运营款，零帧接受世界服训练赛' },
  { location: '世界服新地图', objective: '在没有历史样本时建立实时修正办法', opponent: '尹海真的陌生赛区打法', ally: '乔麦', setback: '语言、随机资源和极少样本同时制造误判', insight: '数据的价值从预测胜负变成帮助队伍更快修正', payoff: '零帧失去部分奖金却赢下最后两局', hook: '季后赛对手拿到实时协议的残缺版本' },
  { location: '季后赛败者组', objective: '在对手已知旧打法时赢下生死局', opponent: '邵锋与极昼战队', ally: '陆沉舟', setback: '陆沉舟旧伤复发，紧急替补只有一次', insight: '对手拿到协议却误解了触发修正的条件', payoff: '顾野以替补指挥身份承担短板，零帧取得国际名额', hook: '大版本上线，过去全部胜率模型失效' },
  { location: '大版本封闭训练营', objective: '主动推翻成功经验并完成双指挥重构', opponent: '过时模型与内部上场位竞争', ally: '唐梨', setback: '时间只有七天，旧成功经验形成依赖', insight: '版本变化本身合规，设备帧差应当作为另一条证据处理', payoff: '零帧建立双指挥和角色交换体系', hook: '国际邀请赛将使用统一设备' },
  { location: '国际邀请赛主舞台', objective: '击败三种赛区风格并取得联盟申诉席位', opponent: '尹海真的冠军队', ally: '乔麦', setback: '赛程密集，针对一队就会向下一队暴露', insight: '统一设备没有帧差，罗放开始转向操纵规则投票', payoff: '零帧夺得邀请赛冠军并拿到全球总决赛资格', hook: '罗放提交新规则，企图让旧证据失效' },
  { location: '全球总决赛与联盟听证会', objective: '同时完成冠军争夺与数据篡改链举证', opponent: '邵锋的陌生阵容与罗放的规则提案', ally: '唐梨', setback: '分人处理申诉会削弱赛前准备，公开协议会利好未来对手', insight: '统一设备后的对照样本让旧日志重新具备可采信来源', payoff: '零帧夺冠，乔麦公开证据链，罗放被停职调查', hook: '幕后资本仍握有下一赛季的规则投票权' }
] as const;

function esportsPlan(chapterNumber: number, names: EsportsNames): DeterministicChapterPlan {
  const eventIndex = Math.max(0, Math.min(9, Math.floor((chapterNumber - 1) / 10)));
  const phaseIndex = Math.max(0, (chapterNumber - 1) % 10);
  const event = esportsEvents[eventIndex]!;
  const allies = [names.tang, names.lu, names.qiao];
  const opponents = [names.shao, names.luo, event.opponent];
  return {
    location: event.location,
    objective: `${event.objective}；本章完成“${phaseActions[phaseIndex]}”`,
    opponent: opponents[(eventIndex + phaseIndex) % opponents.length]!,
    ally: allies[(eventIndex * 2 + phaseIndex) % allies.length]!,
    setback: `${event.setback}，眼前结论不能越过样本、版本与人物选择`,
    insight: `${event.insight}；帧率、经济曲线和视野只能作为可质疑的证据`,
    payoff: phaseIndex === 9 ? event.payoff : `${names.hero}把分析翻译成队友可以修改的选择，当前局势因此推进一步`,
    hook: phaseIndex === 9 ? event.hook : `${event.location}下一轮出现了不符合旧样本的新变化`
  };
}

export function buildEsportsNovel(bookId: string, chapterNumber: number, title: string, context: string): string {
  const names: EsportsNames = {
    hero: context.includes('顾野') ? '顾野' : '数据分析师',
    tang: context.includes('唐梨') ? '唐梨' : '临场指挥',
    lu: context.includes('陆沉舟') ? '陆沉舟' : '战队队长',
    qiao: context.includes('乔麦') ? '乔麦' : '辅助选手',
    shao: context.includes('邵锋') ? '邵锋' : '冠军打野',
    luo: context.includes('罗放') ? '罗放' : '俱乐部经理'
  };
  const plan = esportsPlan(chapterNumber, names);
  const digest = createHash('sha256').update(`${bookId}:${chapterNumber}:${title}:esports`).digest('hex');
  const light = ['晨训室的冷白灯', '主舞台的蓝色灯带', '深夜复盘室的屏幕光', '客场通道的红色指示灯'][Number.parseInt(digest.slice(0, 2), 16) % 4]!;
  const paragraphs = [
    `第${chapterNumber}章 ${title}\n\n${light}一排排亮起，${plan.location}还没喧闹起来，${names.hero}先把刚收到的比赛记录投到墙上。今天真正要解决的是${plan.objective}，而不是让一张漂亮图表替队伍宣布答案。`,
    `${names.tang}没有等他讲完就指出第一处问题：数据能解释昨天，不能保证对手今天仍按旧习惯行动。${names.hero}承认这一点，把建议改成两条可以随时撤回的选择，临场决定权仍在指挥席。`,
    `${names.lu}活动着受过伤的手腕，主动提出自己能承担和不能承担的节奏。${names.qiao}则检查设备、账号和记录来源，把训练服数据与联赛正式数据分开。四个人目标一致，却没有被写成同一种声音。`,
    `${plan.opponent}先改变了打法。对方没有排队犯错，而是故意在前几分钟制造一条假的经济曲线，又用视野空窗诱使零帧提前换线。若仍照旧模型执行，队伍会在最自信的时候失去整张地图。`,
    `${names.hero}把帧率、经济曲线和视野记录并排放置，只标出亲眼能核对的变化。${plan.insight}。结论被写成“如果发生什么，就改做什么”，而不是一条不允许队友质疑的命令。`,
    `第一次执行仍然失败。${plan.setback}。局内的资源差被拉开，${names.lu}为保住队友交掉关键技能，${names.tang}原定的强开窗口也随之消失。这不是可以在复盘里轻轻删掉的代价。`,
    `“按你那条线走，还是按我的？”${names.tang}问。\n\n${names.hero}盯着最新一帧画面：“你的。我的样本已经失效，我来找它为什么失效。”\n\n他没有为了证明自己正确，逼全队继续执行过期判断。`,
    `${names.qiao}从设备日志里找到一个微小时间差，却先把来源和缺口说清。${names.lu}据此调整站位，并留下失败时的撤退路线。技术信息只在他们需要作决定时出现，没有人把模型名、接口或后台字段拿到赛场上炫耀。`,
    `${plan.ally}作出自己的选择，提前改变了下一轮的目标。这个动作没有照搬${names.hero}的建议，却恰好补上他看不到的对手心理。队伍的强大来自每个人都会判断，而不是一个人远程操纵四枚棋子。`,
    `${names.shao}在另一侧很快读懂零帧的变化，主动牺牲一处资源去换更长的控制链。${names.luo}也通过合同与赛制施压，提醒所有人赛场之外同样有人会学习、会修正、会为自己的利益行动。`,
    `${names.hero}重新排序风险：先保住能验证的比赛目标，再处理数据疑点，最后才追谁在幕后获利。这个顺序让队伍放弃了一次看似痛快的正面冲撞，却换来一个可以连续执行的窗口。`,
    `关键团战爆发时，${names.tang}临场改掉第一道命令，${names.lu}压住手伤完成牵制，${names.qiao}用提前保留的视野封住侧翼。${names.hero}只报出最后一个仍可信的时间点，之后便让局内的人自己决定。`,
    `${plan.payoff}。这份兑现能沿录像、规则、角色选择和真实代价复盘，没有突然出现的系统奖励，也没有一条数据凭空替所有人赢下比赛。`,
    `胜负落下后，四个人没有急着庆祝。${names.qiao}先封存原始记录，${names.tang}标出临场改令，${names.lu}记录伤势与轮换限制，${names.hero}则把推断和事实分开，避免下一场把幸运当成规律。`,
    `${plan.opponent}没有因一次受挫失去能力。对方带走可用经验，舍掉已经暴露的伪装，还故意留下一个会让零帧内部争论的问题。下一轮对抗因此更难，而不是重复同一套打脸。`,
    `复盘进行到一半，${names.luo}送来的新条件落到桌上。${names.shao}的选择、俱乐部利益和联盟规则互相牵动，证明比赛线与行业线仍在同一条因果链上，却不能用一个反派自白草率结案。`,
    `${names.hero}让每个人确认自己当前愿意承担的风险。${names.tang}保留临场否决权，${names.lu}决定下一场是否首发，${names.qiao}决定哪些证据可以交给联盟。作者设定的人物边界在行动中生效，而不是藏在资料页里。`,
    `离开${plan.location}前，屏幕又跳出一组尚未解释的新记录。${plan.hook}。${names.hero}没有把未知强行写成结论，只把它变成下一章必须用行动回答的问题。`
  ];
  const expansions = [
    `${names.hero}把这次判断拆成样本、版本和适用条件三栏。只要其中一栏改变，结论就必须重新接受队友质疑；数据流的爽点来自比对手更快纠错，而不是永远正确。`,
    `${names.tang}重新走了一遍指挥顺序，故意在第二步加入一个相反选择。队员讨论后保留这个分支，因为真正的联赛对手不会按照剧本把机会送到眼前。`,
    `${names.qiao}核验了记录的正式来源，又把仍不确定的部分单独标出。她没有因为与${names.hero}关系亲近就放宽证据标准，这份分歧反而让队伍更可靠。`,
    `${names.lu}把个人状态说得很直白：能打多久、哪种操作会加重手伤、换人会失去什么。职业选择属于他本人，团队只能在知情后共同承担结果。`,
    `观众席的声音隔着墙传进来，像潮水一样反复起落。零帧没有用口号回应，他们只把下一次资源交换、视野更新时间和撤退边界重新确认了一遍。`,
    `赛后记录保留了失败段落，没有为了显得漂亮而删掉。正是那些不顺利的过程，证明当前结果来自修正、协作与代价，而不是后台替人物偷偷改写胜负。`
  ];
  let cursor = Number.parseInt(digest.slice(2, 4), 16) % expansions.length;
  while (countCharacters(paragraphs.join('\n\n')) < 2_780) {
    paragraphs.splice(paragraphs.length - 1, 0, expansions[cursor % expansions.length]!);
    cursor += 1;
  }
  return paragraphs.join('\n\n');
}

function countCharacters(content: string): number {
  return [...content].filter((character) => /[\p{L}\p{N}]/u.test(character)).length;
}
