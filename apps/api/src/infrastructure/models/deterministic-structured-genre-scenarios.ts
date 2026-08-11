import { createHash } from 'node:crypto';

type FactEntityType = 'character' | 'location' | 'organization' | 'item' | 'resource' | 'skill' | 'stat_panel';

interface EventPlan { location: string; goal: string; opponent: string; ally: string; payoff: string; hook: string; }

const phases = ['压力落地并迫使人物表态','核对规则和第一处异常','伙伴按自己的目标加入','第一次执行失败并留下代价','对手读懂旧办法后改变策略','队伍因风险分配产生分歧','可靠证据打开新路径','付出代价完成中段反制','多名角色并行准备决战','结算实际结果并形成下一接口'];
const gamePhaseFocus = [
  '界光突然改写了入口规则，低阶职业被推到最危险的外圈。陆昭没有先报面板，而是带霜尾确认伤员、出口和敌人的真实目标；叶绯要求先救人，石拓坚持保住退路，冲突在行动开始前就摆上台面。',
  '乌槐用三次小范围试探核对灵力消耗、冷却间隔和规则边界。陆昭故意保留一次失败记录，证明面板只反映已发生的变化；霜尾则靠嗅觉找出界光之外的第二条证据，两种判断互相复核。',
  '新伙伴提出的条件并不轻松：他愿意提供路线，却要求先完成自己的救援目标。队伍重新分配风险，谁也没有因为是配角就无条件服从；陆昭必须在进度、伤员和伙伴承诺之间作出明确取舍。',
  '原定方案在关键处断裂，敌人利用公开属性切断剑阵，伤势、耐久和灵力损耗当场进入记录。失败没有被一句反转抹掉，队伍只能带着少一张底牌的现实重新决定下一步。',
  '赫连魇读懂了上次的胜法，主动改变目标优先级，把高属性者变成诱饵，又用假弱点消耗技能。陆昭若重复旧办法只会落入计算，因此必须让不同职业各自制造对方看不懂的节奏。',
  '石拓主张撤退，叶绯坚持先救人，乌槐要求保住证据，霜尾还要解开同族契印。陆昭没有用队长身份压平分歧，而是把每条路线的代价和不可放弃项说清，让选择真正影响后续。',
  '现场碎片、伤口灵力残留和霜尾记住的气味终于指向同一条路径。证据仍有缺口，队伍先用一个可撤回的小行动验证，而不是把最顺眼的猜测直接写成真相。',
  '中段反制终于打开窗口，却消耗了治疗针、装备耐久和霜尾的体力。前面累积的证据与协作在此刻得到回报，代价则会留到后文，不会在战斗结束后自动消失。',
  '决战前每个人只准备自己真正能承担的一段：石拓守线，叶绯保命，乌槐锁规则，霜尾选择进化时机，陆昭协调技能窗口。敌人也在调整阵位，胜负仍取决于临场判断。',
  '最终交锋同时回收规则、关系和战斗三条线。陆昭与霜尾采用不同路线夹击，伙伴各自完成承诺，敌人保留从失败中学习的能力；本事件只结算正文实际发生的结果，并把新问题交给下一事件。'
];
const lordPhaseFocus = [
  '坏消息先从仓门和工地同时传来：库存只够撑过眼前几日，敌人却要求立刻缴税。顾临川让秦瑶报实际入库，让岳重山报能守住多久，再决定本章只解决哪一个最要命的问题。',
  '秦瑶抽查仓单，商九娘核对市价，岳重山按车辙复算运输量。三个来源有一处对不上，顾临川先做小额调度验证，避免用漂亮总数掩盖损耗、在途货物和重复计算。',
  '新盟友带着自己的条件入局：可以供粮、领路或出兵，但要换取水权、商路或独立统兵权。顾临川必须说明接受哪部分、拒绝哪部分，并把承诺写进后续资源与关系账。',
  '第一次执行让工地停摆、货车折轴或防线漏出缺口。失败产生的粮耗、伤亡和工期延误全部入账，原计划被迫后移，任何建筑都不能靠一句提示瞬间完成。',
  '黑旗伯不再正面催债，而是攻击运输、法律或民心中最薄弱的一环。顾临川若重复囤资源的旧办法会错过窗口，只能调整生产比例并承受短期库存下降。',
  '岳重山要稳守，赫连朔要出击，秦瑶担心口粮，商九娘担心盟约信用。顾临川不把武将属性当投票权，而是让每个方案列出兵力、工期、库存和失败后果。',
  '仓单、价格、车辙和俘虏口供终于形成可回查的证据链。顾临川仍保留未知项，只用现有资源执行一步可撤回的验证，避免把推断提前写进正式领地状态。',
  '反制换来真实收益，也付出车辆、耐久、粮草或民心代价。秦瑶立即更新期末库存，商九娘更新在途货物，胜利不能抹掉被推迟的建筑与补给。',
  '决战准备被拆成兵员、工事、补给和外交四条并行任务，同一批劳动力不能重复计算。两名武将各自领责，顾临川只确定目标和资源边界。',
  '本事件按实际入库、实际损耗、建筑完成度和人物关系结算。敌人从失败中改变策略，领地升级也不等于所有问题消失，新的税制、难民或战争压力自然进入下一事件。'
];

const gameEvents: EventPlan[] = [
  { location:'天墟城觉醒广场', goal:'完成职业觉醒并守住平等灵契', opponent:'赫连魇放出的噬灵狼', ally:'霜尾', payoff:'陆昭成为御灵剑使，霜尾保留独立契约权', hook:'职业公会要求二人进入灰晶矿洞登记' },
  { location:'灰晶矿洞', goal:'救出矿工并验证职业技能消耗', opponent:'噬字蛛群', ally:'石拓', payoff:'小队取得灰晶核心并确认怪群受人驱使', hook:'灰晶核心指向灵宠竞技场' },
  { location:'灵宠竞技场', goal:'让霜尾自主选择进化路线', opponent:'非法契印师', ally:'叶绯', payoff:'霜尾进化为星火灵狐，非法契印被公开', hook:'契印制造者藏在浮空学院' },
  { location:'浮空学院遗迹', goal:'通过多职业试炼并获得星痕剑阵', opponent:'会改写规则的试炼守卫', ally:'乌槐', payoff:'队伍通过试炼，星痕剑阵留下冷却与灵力代价', hook:'遗迹记录显示主城榜单被篡改' },
  { location:'天墟主城榜塔', goal:'追查失踪玩家仍在增长的经验', opponent:'镜像榜单守卫', ally:'叶绯', payoff:'众人锁定镜像祭坛并确认经验抽取', hook:'经验流向赤月副本' },
  { location:'赤月副本', goal:'救出玩家并夺取赤月剑匣', opponent:'赤月首领与赫连魇投影', ally:'石拓', payoff:'队伍付出耐久和伤势代价取得赤月剑匣', hook:'祭坛坐标通向兽潮边境' },
  { location:'兽潮边境城', goal:'用多职业与灵宠群像守住三路城门', opponent:'镜像祭坛引导的兽潮', ally:'霜尾', payoff:'边城守住，霜尾获得灵兽群信任', hook:'异兽带来世界树根域的求救印记' },
  { location:'世界树根域', goal:'修复规则节点并阻止属性复制', opponent:'镜像规则节点', ally:'乌槐', payoff:'众人修复一半节点并证明属性复制损伤灵魂', hook:'剩余节点由王都议会控制' },
  { location:'王都职业公审台', goal:'公开证明非法契印与经验抽取', opponent:'赫连魇与议会代理', ally:'叶绯', payoff:'陆昭和霜尾保住资格，赫连魇逃入天门', hook:'天门开始吞噬全世界成长记录' },
  { location:'天门核心', goal:'关闭镜像祭坛并保住独立成长', opponent:'能复制最高属性的赫连魇', ally:'霜尾', payoff:'所有人以不同职业和自主选择击败赫连魇', hook:'天门外出现第二套未知职业树' }
];

const lordEvents: EventPlan[] = [
  { location:'灰烬领议事厅', goal:'完成库存清点并让七十三名领民活过第一周', opponent:'黑旗伯的催债使者', ally:'秦瑶', payoff:'一级议事厅与一级农田恢复运转', hook:'河谷水渠被赤狼部截断' },
  { location:'灰烬河谷', goal:'夺回水权并恢复农田日产', opponent:'赤狼首领阿古达', ally:'商九娘', payoff:'水渠修复，粮食日产提高并留下木材消耗', hook:'水渠沿线发现废弃铁矿' },
  { location:'北坡废弃铁矿', goal:'救出矿工并恢复铁矿生产', opponent:'旧领主私兵', ally:'岳重山', payoff:'一级铁矿复产并记录运输损耗', hook:'黑旗伯征税队抵达矿口' },
  { location:'灰烬领北门税卡', goal:'以账册和武备击退虚税', opponent:'黑旗伯税队', ally:'秦瑶', payoff:'矿石保住，灰烬领实力也被公开', hook:'邻领开始联合封锁商路' },
  { location:'狼峡商路', goal:'完成第一次互惠贸易并承担护送成本', opponent:'山匪与封锁商队', ally:'商九娘', payoff:'灰烬领获得粮种与灵晶并损失两辆货车', hook:'新盟约要求协防狼峡' },
  { location:'狼峡关隘', goal:'用武将、兵种与补给守住峡谷', opponent:'山匪首领杜横', ally:'赫连朔', payoff:'两翼守住狼峡，伤亡与粮耗进入账本', hook:'俘虏供出黑旗伯的攻城营' },
  { location:'灰烬领北墙工地', goal:'在十日内把木墙升级为二级石墙', opponent:'时间、石料与劳动力冲突', ally:'岳重山', payoff:'二级石墙完工，兵营升级被迫延后', hook:'敌军从未完工排水口夜袭' },
  { location:'灰烬领夜战城墙', goal:'用已建成的石墙守住领民与仓库', opponent:'黑旗伯夜袭精锐', ally:'赫连朔', payoff:'领地守住但仓库受损，赫连朔取得独立统兵权', hook:'缴获图纸指向灵晶炼炉' },
  { location:'黑旗堡灵晶炼炉', goal:'夺取可持续灵晶产源并解放奴工', opponent:'黑旗伯炼炉守军', ally:'秦瑶', payoff:'二级炼炉停掉透支模式后归灰烬领管理', hook:'黑旗伯向王城申请合法讨伐令' },
  { location:'灰烬领决战原', goal:'完成三级领地、资源、建筑与自治权结算', opponent:'黑旗伯残军与攻城器', ally:'岳重山', payoff:'灰烬领守住总攻并取得边境自治', hook:'北方难民潮与王城新税制进入下一卷' }
];

export function buildGameXianxiaNovel(bookId: string, chapterNumber: number, title: string): string {
  const eventIndex = Math.min(9, Math.floor((chapterNumber - 1) / 10));
  const phaseIndex = (chapterNumber - 1) % 10;
  const plan = gameEvents[eventIndex]!;
  const level = 1 + eventIndex;
  const petLevel = 2 + eventIndex;
  const progress = chapterNumber - 1;
  const body = 18 + Math.floor(progress * 0.72);
  const spirit = 22 + Math.floor(progress * 0.78);
  const agility = 20 + Math.floor(progress * 0.66);
  const mana = 120 + eventIndex * 35 - phaseIndex * 4;
  const petPower = 21 + Math.floor(progress * 0.7);
  const petSpeed = 27 + Math.floor(progress * 0.62);
  const petSpecies = chapterNumber < 30 ? '雪狐' : '星火灵狐';
  const weapon = chapterNumber < 60 ? '青铜灵剑' : '赤月剑匣';
  const weaponDurability = weapon === '赤月剑匣' ? Math.max(42, 96 - Math.floor((chapterNumber - 60) * 1.25)) : Math.max(58, 90 - Math.floor(progress * 0.45));
  const skill = chapterNumber < 40 ? '御灵基础剑式' : '星痕剑阵';
  const eventResult = phaseIndex === 9 ? `${plan.payoff}。` : `${phases[phaseIndex]}已经落地，但${plan.goal}还没有结束。`;
  const transition = phaseIndex === 9 ? plan.hook : `新的证据与损耗把行动推向“${phases[phaseIndex + 1]}”。`;
  const scentEvidence = eventIndex === 0
    ? '霜尾从断裂灵纹旁闻到陌生的灰晶粉末。它没有假装知道来源，只把气味与脚印记住，再让乌槐保存现场碎片，留待后续事件核验。'
    : `霜尾从断裂灵纹旁闻到灰晶粉末，认出它与${eventIndex >= 5 ? '镜像祭坛' : gameEvents[eventIndex - 1]!.location}留下的气味相同。这项判断来自前一事件实际经历，陆昭仍让乌槐用现场碎片复核。`;
  const digest = createHash('sha256').update(`${bookId}:${chapterNumber}:${title}:game-xianxia`).digest('hex');
  const paragraphs = [
    `第${chapterNumber}章 ${title}\n\n青蓝色的界光沿${plan.location}石壁一寸寸亮起，陆昭先确认霜尾正站在自己选择的位置，才看向逼近的${plan.opponent}。若想${plan.goal}，他们眼下先要${phases[phaseIndex]}。面板能说明状态，却不能替任何人决定是否迎战。`,
    gamePhaseFocus[phaseIndex]!,
    `人物状态：陆昭，职业御灵剑使，职业等级${level}级，体魄${body}，灵识${spirit}，敏捷${agility}，当前灵力${mana}点；已装备${weapon}，已掌握${skill}。`,
    `灵宠状态：霜尾，种族${petSpecies}，灵宠等级${petLevel}级，力量${petPower}，速度${petSpeed}，当前体力${150 + eventIndex * 20 - phaseIndex * 5}点；契约关系为平等协作，霜尾保留拒绝命令和自主进化的权利。`,
    `叶绯没有等陆昭分派任务。她先用医修银针探过受伤者经脉，判断正面冲锋会让救援线断掉。石拓则把盾砸进地面，要求先算清他能撑住几次冲击。乌槐守在侧翼记下规则变化，三人的意见彼此冲突，却都来自自己的职责。`,
    `${plan.opponent}也看见了公开属性。对方故意避开陆昭数值最高的一侧，连续用假动作消耗${skill}的出手窗口，又把第一轮攻击压向霜尾。敌人没有排队送出破绽，而是在利用他们最依赖的协作习惯。`,
    `陆昭没有把霜尾召回脚边。他只说出自己能提供的两条路线和各自代价。霜尾耳尖一转，主动选了更窄的火廊，因为那里能救下被围住的幼兽。这个选择会多消耗体力，却符合霜尾自己的目标。`,
    `本轮交锋没有轻易取胜。${skill}刚展开一半，${plan.opponent}便切断地面的灵纹，陆昭的灵力当场减少十八点，${weapon}耐久降到${weaponDurability}点。叶绯被迫提前使用一次治疗，队伍失去了一张保命底牌。`,
    `战斗记录：陆昭本轮消耗灵力十八点，${weapon}当前耐久${weaponDurability}点；霜尾消耗体力十二点并受到左前爪轻伤。所有损耗都来自眼前行动，没有凭空恢复，也没有无缘无故多出奖励。`,
    `石拓提出先退，叶绯主张继续救人，乌槐则要求拿到规则证据。陆昭把三种选择的最坏结果摊开，没有用队长身份盖住分歧。最后由石拓守撤退线、叶绯带伤员移动、乌槐取证，陆昭和霜尾只负责制造一个短窗口。`,
    scentEvidence,
    `赫连魇的影像在高处短暂出现。他没有解释全部阴谋，只调整下一轮规则，把职业等级高的人变成优先目标，又把灵宠经验改成诱饵。陆昭立刻明白，继续追求单项数值碾压只会让对手更容易计算他们。`,
    `陆昭收起最显眼的剑势，故意把灵力波动压低。霜尾则沿着火廊反向奔行，在敌人以为它会回援时独自咬断控制灵兽的契印。两人的行动互相照应，却不是同一份命令的两次执行。`,
    `叶绯用一根银针稳住伤员，石拓承担正面撞击，乌槐把取到的碎片投向界光。几条不同职业线在同一刻合拢，逼${plan.opponent}必须在守住规则节点和继续追击之间作出选择。`,
    `陆昭抓住这一息发动${skill}。剑光没有因为面板数字变得无穷无尽，它只沿已经确认的三处节点依次落下。霜尾在最后一剑之前主动改变落点，让火线封住对手退路，也替被困者留出出口。`,
    `${eventResult}职业经验和灵宠经验分别记录，${weapon}的耐久没有自动复原，受伤也仍要在后续章节处理。胜利来自准备、选择和承担代价，而不是一行数值替人物赢完战斗。`,
    `战后，陆昭把人物属性、灵宠属性、装备耐久和技能冷却逐项复核。叶绯记录伤势，石拓记录防线缺口，乌槐保存规则碎片。资料能够回查，但没有人把尚未确认的推测写成正式结论。`,
    `霜尾拒绝了立即吞下高阶灵核的提议。它认为现在进化会失去追踪气味的能力，决定等下一次安全窗口再选。陆昭接受这个决定，证明平等契约不是写在设定里的装饰。`,
    `${plan.opponent}带走了这场战斗的经验，下一次不会重复同一种错误。${transition}陆昭收起面板，只把必须验证的问题留给下一章。`
  ];
  fill(paragraphs, digest, [
    `陆昭把职业技能拆成触发、消耗、冷却和失败后果四项，只在当前决策需要时查看。叶绯提醒他，面板不能显示恐惧、信任和隐瞒；这些仍要从人物的言语与行动里判断。`,
    `霜尾绕着现场重新走了一圈，独自确认气味和脚印。它指出陆昭忽略的一条岔路，也承担判断错误时先迎敌的风险。灵宠属性没有把它压成一件会动的装备。`,
    `石拓把盾面裂痕量清，拒绝一句“还能撑”糊弄过去。乌槐把证据来源写在纸上，明确哪些是亲眼所见，哪些只是赫连魇故意留下的线索。`,
    `界光在石壁间缓慢回落，留下清晰的战斗范围。队伍没有趁安静凭空补满灵力，而是分配药剂、警戒和休息时间，让下一章承接真实状态。`,
    `叶绯把伤员分成能走、需扶和不能移动三组，拒绝用一句“都救下了”略过差别。她要求陆昭先留出安全通道，再谈追击和经验。`,
    `石拓沿墙根试了三次受力点，把最危险的缺口留给自己的盾。他没有因为担任前排就接受所有风险，而是明确要求队友在第二次冲击前完成换位。`,
    `乌槐把规则碎片按出现顺序排开，发现其中一块比其余碎片晚亮半息。这个细节不能直接证明幕后者身份，却足以改变下一次试探的落点。`,
    `霜尾没有等待口令，先绕到幼兽与敌人之间。它愿意承担短距离突袭，却拒绝被当成诱饵，这项边界让陆昭必须重新设计自己的剑路。`,
    `远处的敌方斥候同样在记录。他们看见石拓换盾、叶绯减针和乌槐取证，下一轮必然会针对这些动作，队伍不能把一次奏效当成长久答案。`,
    `风从断墙穿过时带来三种不同气味，霜尾只确认其中一种来自敌人。其余两种被标成未知，直到人物亲眼找到来源之前都不提前下结论。`,
    `${weapon}的裂纹被陆昭用布条标出，耐久下降不是装饰数字。若再承受同样冲击，下一次出剑就要缩短剑势，否则武器会在最需要时断裂。`,
    `叶绯与石拓仍不认同彼此的优先顺序，却开始为对方留出退路。关系变化发生在具体选择里，没有靠一段总结突然变成无条件信任。`,
    `乌槐把地面分成安全、可试和未知三块，陆昭只在可试区域移动。地图不是全知答案，而是随着脚步、证据和代价一点点长出来。`,
    `被救下的人并没有立刻歌颂队伍，其中有人质问为什么来得太晚。陆昭必须面对胜利之外的损失，也让下一步决定承受真实的人情压力。`,
    `短暂休整时，霜尾把半份药剂推给伤势更重的幼兽。这个动作不提高面板数值，却让叶绯第一次把它当成能共同决定的伙伴。`,
    `石拓把撤退路线上的碎石清开，乌槐则在入口留下只有队伍看得懂的记号。准备工作不抢高潮，却决定下一次失败时他们能不能活着退回。`,
    `陆昭没有把每条新线索都告诉所有人，只把已经核实的部分公开。未确认的怀疑被单独记下，避免一场误会抢先变成事实。`,
    `最后一轮警戒交接时，叶绯发现敌人的脚步比先前更轻。这个变化说明对手正在学习，也把下一场冲突从单纯比拼数值推向判断与反判断。`,
    `界光忽明忽暗，照出石壁上被人擦掉一半的旧徽记。乌槐只拓下还能确认的线条，缺失部分继续留白，不让想象替代证据。`,
    `叶绯重新包扎霜尾的左前爪，并说明伤口若再裂开会影响冲刺。治疗让它能行动，却没有把刚才付出的体力和疼痛一笔勾销。`,
    `陆昭在地上划出三道剑路，主动删掉最华丽却最耗灵力的一道。职业成长不是技能越多越好，而是知道何时不用最强招式。`,
    `石拓向被救者借来一面旧木板补盾，换取的是事后修门的承诺。临时装备有来源、有代价，也把陌生人的生活与战斗连在一起。`,
    `霜尾在火廊尽头停了一瞬，确认同族已经撤出才转身。它自己的目标改变了队伍节奏，也让陆昭必须承担多守一息的压力。`,
    `敌人的一次试探没有造成伤亡，却暴露了他们更在意规则碎片而非经验奖励。乌槐据此调整保管方式，仍不把动机直接写成定论。`,
    `叶绯把剩余药剂交给石拓保管，避免所有救命物资集中在一人身上。队伍的协作因此多了一层备份，也多了一份互相约束。`,
    `陆昭回想上一轮出剑，发现真正救下伤员的不是最高伤害，而是霜尾提前封住退路。面板给出数字，胜负原因仍要从行动顺序里寻找。`,
    `乌槐在碎片边缘找到一道新划痕，证明有人在战斗开始前动过规则节点。线索把怀疑推进一步，却仍需要下一处现场才能锁定幕后者。`,
    `当最后一名伤员越过安全线，陆昭才允许自己松开剑柄。短暂的安静没有取消危险，只让每个人有机会把真实损耗带进下一次选择。`
  ]);
  return paragraphs.join('\n\n');
}

export function buildLordNovel(bookId: string, chapterNumber: number, title: string): string {
  const eventIndex = Math.min(9, Math.floor((chapterNumber - 1) / 10));
  const phaseIndex = (chapterNumber - 1) % 10;
  const plan = lordEvents[eventIndex]!;
  const ledger = resourceLedger(chapterNumber);
  const territoryLevel = chapterNumber >= 100 ? 3 : chapterNumber >= 50 ? 2 : 1;
  const wallLevel = chapterNumber >= 70 ? 2 : 1;
  const mineLevel = chapterNumber >= 30 ? 1 : 0;
  const smelterLevel = chapterNumber >= 90 ? 2 : 0;
  const digest = createHash('sha256').update(`${bookId}:${chapterNumber}:${title}:lord`).digest('hex');
  const eventResult = phaseIndex === 9 ? `${plan.payoff}。` : `${phases[phaseIndex]}已经落地，但${plan.goal}还没有结束。`;
  const paragraphs = [
    `第${chapterNumber}章 ${title}\n\n晨雾从${plan.location}外的荒地退开时，顾临川已经把粮仓、工地和守军三份记录摊在桌上。若想${plan.goal}，他眼下先要${phases[phaseIndex]}。账本不替他治理领地，只迫使每个决定承认真实代价。`,
    `领地状态：灰烬领，领主顾临川，领地等级${territoryLevel}级，人口${73 + eventIndex * 19 + phaseIndex}人，民心${54 + eventIndex * 3}点，主要驻地为灰烬领议事厅，当前地位为苍原边境自治候选领。`,
    lordPhaseFocus[phaseIndex]!,
    `资源结算：本章期初粮食${ledger.before.food}份、木材${ledger.before.wood}份、石料${ledger.before.stone}份、铁矿${ledger.before.iron}份、灵晶${ledger.before.crystal}枚；本章获得粮食${ledger.gain.food}份、木材${ledger.gain.wood}份、石料${ledger.gain.stone}份、铁矿${ledger.gain.iron}份、灵晶${ledger.gain.crystal}枚；本章消耗粮食${ledger.use.food}份、木材${ledger.use.wood}份、石料${ledger.use.stone}份、铁矿${ledger.use.iron}份、灵晶${ledger.use.crystal}枚；期末库存分别为${ledger.after.food}份、${ledger.after.wood}份、${ledger.after.stone}份、${ledger.after.iron}份和${ledger.after.crystal}枚。`,
    `资源产出：农田每日产粮${38 + (chapterNumber >= 20 ? 24 : 0)}份，伐木场每日产木${24 + (chapterNumber >= 50 ? 12 : 0)}份，采石场每日产石${18 + (chapterNumber >= 70 ? 16 : 0)}份，铁矿每日产铁${mineLevel === 0 ? 0 : 14 + eventIndex}份，灵晶炼炉每日产灵晶${smelterLevel === 0 ? 0 : 6}枚；运输统一扣除一成损耗，不能把理论产量直接当成入库。`,
    `建筑面板：议事厅一级，农田${chapterNumber >= 20 ? 2 : 1}级，铁矿${mineLevel}级，北门城墙${wallLevel}级，灵晶炼炉${smelterLevel}级。当前只有一支建设队，正在施工的建筑不能同时再升级另一座。`,
    `岳重山武将属性：统率${62 + eventIndex * 2}，武力${71 + eventIndex * 2}，智略${48 + eventIndex}，忠诚${68 + eventIndex}，当前装备黑铁长枪与旧鳞甲；赫连朔武将属性：统率${70 + eventIndex}，武力${76 + eventIndex * 2}，智略${57 + eventIndex}，忠诚${45 + eventIndex * 3}，当前装备狼纹弯刀。`,
    `秦瑶先指出账目中的危险：若按顾临川最初的方案同时征发农夫和矿工，纸面产量会提高，实际秋收却会断层。商九娘也没有只负责送钱，她要求贸易必须保留价格、运费和损耗，否则再漂亮的利润也只是把亏损推到下一章。`,
    `岳重山主张先守住城墙，赫连朔却认为主动出击更省长期粮耗。两名武将都给出自己的兵力、补给和失败后果，不是谁的数值更高就自动获得决定权。顾临川让他们分别准备方案，再用当前目标选择，而不是把将领当成面板插件。`,
    `${plan.opponent}没有坐等灰烬领发展。对方先制造一处看似便宜的交易，又在运输、时间或人心上收回代价。若只盯着库存总数，顾临川会在最想升级的时候失去真正稀缺的劳动力。`,
    `第一次执行受阻时，工地停了半日，一辆运料车折轴，守军口粮还必须照常发放。秦瑶把损失记入本章消耗，没有为了让计划显得正确而删掉失败。顾临川也接受一项建筑要延后。`,
    `升级消耗规划：下一项建设需要木材${80 + eventIndex * 20}份、石料${60 + eventIndex * 18}份、铁矿${20 + eventIndex * 8}份、灵晶${eventIndex >= 7 ? 12 : 0}枚和${2 + eventIndex}天工期；若库存不足，顾临川不能用未来产量冒充现货。`,
    `商九娘带回的价格变化与秦瑶的仓单互相印证，岳重山则从车辙判断实际运输数量。三类证据合在一起，才说明${plan.opponent}正在改变策略；一条传闻不能直接推动征兵或开战。`,
    `顾临川调整劳动力：一部分人回农田，一部分人修路，剩余工匠只推进当前建筑。这个选择让升级慢了一天，却避免同一批人同时出现在两处产量里。真正的成就感来自把约束变成可执行次序。`,
    `冲突真正爆发时，岳重山守住正面，赫连朔自行改变右翼路线，秦瑶维持粮秣，商九娘用契约稳住盟友。顾临川只协调目标和资源边界，四个人各自判断并承担结果。`,
    `${eventResult}战斗或经营结果进入实际账本，伤亡、粮耗、建筑耐久、贸易损失和延后的项目没有被胜利抹掉，下一章必须从这个状态继续。`,
    `结算后，秦瑶复核库存，商九娘复核价格，岳重山清点兵员，赫连朔确认伤兵与装备。顾临川把事实、推断和下一步设想分开，规划仍是未来，已经发生的只有正文中能回查的部分。`,
    `黑旗伯从失败中拿走经验，开始攻击灰烬领最薄弱的资源或法律位置。对手有自己的盟友、债务和政治目标，不会在下一章重复同一种错误。`,
    `${phaseIndex === 9 ? plan.hook : `新的账目变化把领地推向“${phases[phaseIndex + 1]}”`}。顾临川合上账本时，没有因为数字上涨就宣布问题解决，只确认灰烬领还有哪些人、资源和建筑可以承担下一步。`
  ];
  fill(paragraphs, digest, [
    `顾临川把收益分成入库、在途和承诺三栏，只允许入库资源进入本章结余。商九娘赞成这种谨慎，却提醒他过度保守也会失去窗口，经营仍然需要人物作出判断。`,
    `秦瑶抽查三户领民的口粮与工时，发现总账正确并不代表分配公平。顾临川据此调整轮班，让民心变化来自具体治理，而不是每次胜利自动增加。`,
    `岳重山与赫连朔重新核对武将状态。一个重视稳定防线，一个愿意冒险切断敌军补给；两种意见都保留，最终方案说明采纳哪部分以及放弃什么。`,
    `工地上的锤声没有停。建筑等级只说明当前能力，真正的进度还受材料、工匠、天气和道路限制。任何升级都不能在一句提示之后瞬间完成。`,
    `秦瑶把老人、儿童、守军和重体力工人的口粮分开核算，发现平均数会掩盖真实短缺。顾临川据此调整配给，也接受民心不会只因一次胜利自动上涨。`,
    `商九娘把货物分成已入库、在途和口头承诺三栏。只有真正进仓的部分才能用于升级，价格上涨与运输损耗也必须在利润里留下痕迹。`,
    `岳重山逐段检查城墙，把能守、需补和不能站人的位置画在图上。建筑等级不是无敌护盾，缺口仍会让更强的敌军找到突破方向。`,
    `赫连朔带斥候走了一条更险的山路，换回敌军补给位置。他愿意冒险却不愿盲从，顾临川必须说明这份情报值不值得消耗粮草去验证。`,
    `农田、伐木场和采石场争用同一批劳力，顾临川只能保住两个优先项。被延后的产出会在后续库存中出现，不能从别处悄悄补回。`,
    `铁匠把损坏的枪头和车轴分别列价，提醒众人“缴获”并不等于立刻能用。修复要消耗铁矿、木材与工时，装备状态因此进入真实账目。`,
    `三户新来的领民要求先看土地和税率，再决定是否留下。人口增长有条件，也会带来住房、口粮和治安压力，不是一行数字带来的纯收益。`,
    `黑旗伯的使者故意把期限说得含糊，想让灰烬领自乱阵脚。秦瑶要求对方落笔，商九娘核对印章，两条证据共同挡住了口头威胁。`,
    `雨水让北路运输慢了半日，原定工期必须顺延。顾临川没有让天气只当背景，而是把延误落实到守军轮换和仓库到货时间。`,
    `岳重山和赫连朔重新分配兵员，一个守住领民撤退线，一个侦查敌军侧翼。两名武将的统率与武力只说明能力，具体选择仍由他们承担后果。`,
    `商九娘拒绝一笔看似暴利的交易，因为对方要求用未来三月粮税作抵押。短期缺口没有因此消失，却避免领地把下一卷的生存空间提前卖掉。`,
    `秦瑶在总账旁另列一页未知损耗，等车队回来再核销。无法确认的数字保持未知，不为了让收支表好看就随意补成整数。`,
    `工匠们要求先修饮水井再扩兵营，守军却担心城墙缺口。顾临川必须公开选择与代价，让领民知道延后哪项、为什么延后以及何时复核。`,
    `夜巡结束时，远处多出两支陌生火把。那可能是商队，也可能是敌方探子；在证据回来之前，灰烬领只加强警戒，不把猜测写成正式敌情。`,
    `秦瑶把五种资源换算成可支撑的天数，而不是只看总量。粮食能撑多久、木石能修几段墙，比一个看似很大的库存数字更接近真实处境。`,
    `商九娘比较三条商路的价格、运费和风险，最便宜的一条反而最容易被截。顾临川选择次优路线，并把多付的成本写进本章账目。`,
    `岳重山让铁匠检查长枪与旧鳞甲，确认武力没有自动修好装备。修缮占用铁矿和半日工时，也会推迟下一批农具交付。`,
    `赫连朔把斥候分成两组，一组查敌军，一组确认撤退路。他的独立统兵不是空头称号，而是要对失踪、误判和粮耗负责。`,
    `新建房屋只能安置一部分领民，其余人仍需借住仓边。人口增加带来劳力，也带来住所、饮水与治安压力，领地面板不能只记好处。`,
    `书记员把旧领主留下的税条逐项抄清，发现其中两条互相矛盾。顾临川先暂停争议税，不用尚未核实的法令为眼前征收找借口。`,
    `工匠提出把升级材料预留两成应急，代价是完工再慢一天。顾临川采纳后，账面进度变慢，却避免一次夜袭就让整个工程停摆。`,
    `守军训练消耗粮食和箭矢，但也让新兵知道该站在哪里。岳重山把训练成本单列，拒绝把战备当成没有代价的状态提升。`,
    `商九娘带回一份赊购提议，秦瑶要求先算最坏情况下的还款。二人意见不同，却共同阻止领地把未来产出重复抵押给两家商会。`,
    `天亮前，顾临川沿仓库和城墙走了一圈。数字已经更新，破损与疲惫仍在眼前；他据此确定下一步，而不是让结算表替自己宣布胜利。`
  ]);
  return paragraphs.join('\n\n');
}

const gameLordReplacementPairs: ReadonlyArray<readonly [string, string]> = [
  ['顾临川','苏砚'],['灰烬领','晨星领'],['秦瑶','宁霜'],['岳重山','铁山'],['商九娘','商晚'],['赫连朔','裴烈'],['黑旗伯','狼爵'],
  ['武将属性','英雄属性'],['苍原边境领','界域边境领'],['灵晶','界晶'],['领地状态：晨星领','领主面板：晨星领']
];

const douluoReplacementPairs: ReadonlyArray<readonly [string, string]> = [
  ['陆昭','顾星河'],['霜尾','银羽'],['叶绯','洛清弦'],['石拓','石岳'],['乌槐','叶璃'],['赫连魇','司空夜'],
  ['御灵剑使','星轮魂师'],['职业等级','魂力等级'],['人物状态','魂师状态'],['灵宠状态','魂兽伙伴状态'],
  ['灵宠等级','魂兽成长等级'],['灵宠','魂兽伙伴'],['职业','武魂'],['技能','魂技'],['灵力','魂力'],['经验','修炼记录'],
  ['镜像祭坛','镜魂祭坛'],['星痕剑阵','星轮锁域'],['御灵基础剑式','星轮第一魂技'],['赤月剑匣','星纹魂骨匣'],['青铜灵剑','星纹短刃'],
  ['天墟城觉醒广场','诺丁边城武魂觉醒堂'],['灰晶矿洞','寒铁矿洞'],['灵宠竞技场','魂兽斗场'],['浮空学院遗迹','天斗学院旧遗迹'],
  ['天墟主城榜塔','魂师总榜塔'],['赤月副本','星斗大森林赤月谷'],['兽潮边境城','索托边城'],['世界树根域','星斗古树根域'],
  ['王都职业公审台','天斗城魂师公审台'],['天门核心','封号试炼天门'],['职业公会','武魂分殿'],['玩家','魂师'],
  ['平等契约','平等盟约'],['契约关系','盟约关系'],['契约','盟约'],['进化','血脉觉醒'],['灵兽','魂兽'],['幼兽','幼年魂兽'],['星火灵狐','星羽灵狐']
];

function replaceScenarioText(content: string, pairs: ReadonlyArray<readonly [string, string]>): string {
  return pairs.reduce((current, [from, to]) => current.split(from).join(to), content);
}

function reverseScenarioText(content: string, pairs: ReadonlyArray<readonly [string, string]>): string {
  return [...pairs].sort((left, right) => right[1].length - left[1].length).reduce((current, [from, to]) => current.split(to).join(from), content);
}

function replaceScenarioValue(value: unknown, pairs: ReadonlyArray<readonly [string, string]>): unknown {
  if (typeof value === 'string') return replaceScenarioText(value, pairs);
  if (Array.isArray(value)) return value.map((item) => replaceScenarioValue(item, pairs));
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [replaceScenarioText(key, pairs), replaceScenarioValue(item, pairs)]));
  }
  return value;
}

export function buildGameLordNovel(bookId: string, chapterNumber: number, title: string): string {
  const transformed = replaceScenarioText(buildLordNovel(bookId, chapterNumber, title), gameLordReplacementPairs);
  return `${transformed}\n\n第${chapterNumber}章的领主面板核验只记录已经入库的资源、完成的建筑和人物实际承担的结果；尚在路上或仍属推测的内容继续保持未知，并在下一章重新核对。`;
}

export function buildDouluoFanficNovel(bookId: string, chapterNumber: number, title: string): string {
  const transformed = replaceScenarioText(buildGameXianxiaNovel(bookId, chapterNumber, title), douluoReplacementPairs);
  const soulPower = 10 + Math.min(30, Math.floor((chapterNumber - 1) / 3) + 1);
  const rings = chapterNumber < 40 ? '第一魂环百年' : chapterNumber < 70 ? '第一魂环百年、第二魂环百年' : '第一魂环百年、第二魂环百年、第三魂环千年';
  return transformed
    .replace(/^第(\d+)章 ([^\n]+)\n\n/u, (_match, number, chapterTitle) => `第${number}章 ${chapterTitle}\n\n故事位于斗罗大陆边境的原创支线，不复述既有主线。`)
    .replace(/魂力等级\d+级，体魄/gu, `魂力等级${soulPower}级，魂环配置${rings}，体魄`);
}

function transformedFacts(content: string, chapterNumber: number, pairs: ReadonlyArray<readonly [string, string]>, source: 'lord' | 'game'): Array<Record<string, unknown>> {
  const reversed = reverseScenarioText(content, pairs);
  const facts = source === 'lord' ? lordFacts(reversed, chapterNumber) : gameFacts(reversed, chapterNumber);
  const transformed = facts.map((fact) => replaceScenarioValue(fact, pairs) as Record<string, unknown>);
  return source === 'game' && pairs === douluoReplacementPairs
    ? transformed.map((fact) => replaceScenarioValue(fact, [['人物属性','魂师状态'],['灵宠属性','魂兽伙伴状态']]) as Record<string, unknown>)
    : transformed;
}

export function structuredGenreFactCandidates(content: string): Array<Record<string, unknown>> {
  const chapterNumber = Number(content.match(/^第(\d+)章/u)?.[1] ?? 0);
  if (content.includes('领主面板：晨星领') && content.includes('资源结算')) return transformedFacts(content, chapterNumber, gameLordReplacementPairs, 'lord');
  if (content.includes('魂师状态：顾星河') && content.includes('魂兽伙伴状态：银羽')) return transformedFacts(content, chapterNumber, douluoReplacementPairs, 'game');
  if (content.includes('御灵剑使') && content.includes('灵宠状态')) return gameFacts(content, chapterNumber);
  if (content.includes('灰烬领') && content.includes('资源结算')) return lordFacts(content, chapterNumber);
  return [];
}

function gameFacts(content: string, chapterNumber: number): Array<Record<string, unknown>> {
  const facts: Array<Record<string, unknown>> = [];
  const hero = lineContaining(content, '人物状态：陆昭');
  const pet = lineContaining(content, '灵宠状态：霜尾');
  const battle = lineContaining(content, '战斗记录：');
  const location = gameEvents[Math.min(9, Math.floor((chapterNumber - 1) / 10))]!.location;
  const itemName = hero?.match(/已装备([^，。]+)/u)?.[1] ?? '青铜灵剑';
  const skillName = hero?.match(/已掌握([^，。]+)/u)?.[1] ?? '御灵基础剑式';
  const petIdentity = pet?.match(/种族([^，。]+)/u)?.[1] ?? '雪狐';

  if (chapterNumber === 1) {
    addAppearances(facts, content, chapterNumber, ['陆昭','霜尾','叶绯','石拓','乌槐','赫连魇']);
    addRelationships(facts, content, chapterNumber, [
      ['陆昭','霜尾','partnership'], ['陆昭','叶绯','cooperation'], ['陆昭','石拓','cooperation'],
      ['陆昭','乌槐','cooperation'], ['陆昭','赫连魇','rivalry']
    ]);
    if (hero) add(facts, chapterNumber, '陆昭', 'character', 'identity', '御灵剑使', hero);
    if (pet) add(facts, chapterNumber, '霜尾', 'character', 'identity', `平等契约${petIdentity}`, pet);
    add(facts, chapterNumber, location, 'location', `location.appears_in_chapter_${chapterNumber}`, `${location}是本章实际场景`, sentenceContaining(content, location) ?? content.slice(0,150));
    add(facts, chapterNumber, '天墟职业公会', 'organization', 'position', '负责职业登记与规则审查', hero ?? pet ?? content.slice(0,150));
    if (battle) add(facts, chapterNumber, itemName, 'item', 'status', battle.match(new RegExp(`${itemName}[^。]+`,'u'))?.[0] ?? battle, battle);
    return facts.slice(0, 16);
  }

  if (chapterNumber % 10 === 0) {
    if (hero) {
      const level = Number(hero.match(/职业等级(\d+)级/u)?.[1] ?? 0);
      add(facts, chapterNumber, '陆昭', 'character', 'identity', '御灵剑使', hero);
      add(facts, chapterNumber, '陆昭', 'character', 'attributes', hero.replace(/^人物状态：陆昭，/u,''), hero);
      add(facts, chapterNumber, '陆昭', 'character', 'protagonist_state.职业.职业等级', { value: level, label:'职业等级', unit:'级' }, hero);
      add(facts, chapterNumber, itemName, 'item', 'owner', '陆昭', hero);
      add(facts, chapterNumber, itemName, 'item', 'effects', `承载${skillName}并保留耐久损耗`, battle ?? hero);
      add(facts, chapterNumber, skillName, 'skill', 'effects', '沿已确认节点依次落剑，消耗灵力并有冷却', sentenceContaining(content, skillName) ?? hero);
      add(facts, chapterNumber, '陆昭人物属性面板', 'stat_panel', 'attributes', hero.replace(/^人物状态：/u,''), hero);
    }
    if (pet) {
      add(facts, chapterNumber, '霜尾', 'character', 'identity', `平等契约${petIdentity}`, pet);
      add(facts, chapterNumber, '霜尾', 'character', 'attributes', pet.replace(/^灵宠状态：霜尾，/u,''), pet);
      add(facts, chapterNumber, '霜尾灵宠属性面板', 'stat_panel', 'attributes', pet.replace(/^灵宠状态：/u,''), pet);
    }
    add(facts, chapterNumber, location, 'location', `location.appears_in_chapter_${chapterNumber}`, `${location}是本章实际场景`, sentenceContaining(content, location) ?? content.slice(0,150));
    return facts;
  }

  addAppearances(facts, content, chapterNumber, ['陆昭','霜尾']);
  if (hero) {
    const level = Number(hero.match(/职业等级(\d+)级/u)?.[1] ?? 0);
    add(facts, chapterNumber, '陆昭', 'character', 'identity', '御灵剑使', hero);
    add(facts, chapterNumber, '陆昭', 'character', 'attributes', hero.replace(/^人物状态：陆昭，/u,''), hero);
    add(facts, chapterNumber, '陆昭', 'character', 'equipment', itemName, hero);
    add(facts, chapterNumber, '陆昭', 'character', 'protagonist_state.职业.职业等级', { value: level, label:'职业等级', unit:'级' }, hero);
  }
  if (pet) {
    add(facts, chapterNumber, '霜尾', 'character', 'identity', `平等契约${petIdentity}`, pet);
    add(facts, chapterNumber, '霜尾', 'character', 'affiliation', '陆昭的平等灵契伙伴', pet);
    add(facts, chapterNumber, '霜尾', 'character', 'attributes', pet.replace(/^灵宠状态：霜尾，/u,''), pet);
  }
  add(facts, chapterNumber, location, 'location', `location.appears_in_chapter_${chapterNumber}`, `${location}是本章实际场景`, sentenceContaining(content, location) ?? content.slice(0,150));
  if (battle) add(facts, chapterNumber, itemName, 'item', 'status', battle.match(new RegExp(`${itemName}[^。]+`,'u'))?.[0] ?? battle, battle);
  return facts;
}

function lordFacts(content: string, chapterNumber: number): Array<Record<string, unknown>> {
  const facts: Array<Record<string, unknown>> = [];
  const territory = lineContaining(content, '领地状态：灰烬领');
  const resources = lineContaining(content, '资源结算：');
  const production = lineContaining(content, '资源产出：');
  const buildings = lineContaining(content, '建筑面板：');
  const generals = lineContaining(content, '岳重山武将属性：');
  const upgrade = lineContaining(content, '升级消耗规划：');
  const level = Number(territory?.match(/领地等级(\d+)级/u)?.[1] ?? 0);
  const location = lordEvents[Math.min(9, Math.floor((chapterNumber - 1) / 10))]!.location;

  if (chapterNumber === 1) {
    addAppearances(facts, content, chapterNumber, ['顾临川','秦瑶','岳重山','商九娘','赫连朔','黑旗伯']);
    addRelationships(facts, content, chapterNumber, [
      ['顾临川','秦瑶','cooperation'], ['顾临川','岳重山','cooperation'], ['顾临川','商九娘','cooperation'],
      ['顾临川','赫连朔','cooperation'], ['顾临川','黑旗伯','rivalry']
    ]);
    if (territory) {
      add(facts, chapterNumber, '灰烬领', 'organization', 'leader', '顾临川', territory);
      add(facts, chapterNumber, '灰烬领', 'organization', 'level', `${level}级领地`, territory);
      add(facts, chapterNumber, '灰烬领', 'organization', 'member_count', territory.match(/人口\d+人/u)?.[0] ?? '人口已清点', territory);
      add(facts, chapterNumber, '顾临川', 'character', 'identity', '灰烬领领主', territory);
    }
    add(facts, chapterNumber, location, 'location', `location.appears_in_chapter_${chapterNumber}`, `${location}是本章实际场景`, sentenceContaining(content, location) ?? content.slice(0,150));
    return facts.slice(0, 16);
  }

  if (chapterNumber % 10 === 0) {
    if (territory) {
      add(facts, chapterNumber, '灰烬领', 'organization', 'leader', '顾临川', territory);
      add(facts, chapterNumber, '灰烬领', 'organization', `level.chapter_${chapterNumber}`, `${level}级领地`, territory);
      add(facts, chapterNumber, '灰烬领', 'organization', `member_count.chapter_${chapterNumber}`, territory.match(/人口\d+人/u)?.[0] ?? '人口已清点', territory);
    }
    if (generals) {
      add(facts, chapterNumber, '岳重山', 'character', 'attributes', generals.match(/岳重山武将属性[^；]+/u)?.[0] ?? generals, generals);
      add(facts, chapterNumber, '赫连朔', 'character', 'attributes', generals.match(/赫连朔武将属性[^。]+/u)?.[0] ?? generals, generals);
    }
    for (const resource of ['粮食','木材','石料','铁矿','灵晶']) {
      const evidence = resources ?? production ?? content.slice(0,150);
      add(facts, chapterNumber, resource, 'resource', `attributes.chapter_${chapterNumber}`, [resources, production, '归属灰烬领'].filter(Boolean).join(' '), evidence);
    }
    for (const building of ['议事厅','农田','铁矿','北门城墙','灵晶炼炉']) {
      if (!buildings) continue;
      add(facts, chapterNumber, building, 'item', `attributes.chapter_${chapterNumber}`, ['领地建筑', buildings, upgrade, '归属灰烬领'].filter(Boolean).join(' '), buildings);
    }
    if (territory) add(facts, chapterNumber, '灰烬领经营面板', 'stat_panel', 'attributes', [territory,resources,production,buildings].filter(Boolean).join(' '), territory);
    return facts;
  }

  if (territory) {
    add(facts, chapterNumber, '灰烬领', 'organization', 'leader', '顾临川', territory);
    add(facts, chapterNumber, '灰烬领', 'organization', `level.chapter_${chapterNumber}`, `${level}级领地`, territory);
    add(facts, chapterNumber, '灰烬领', 'organization', `member_count.chapter_${chapterNumber}`, territory.match(/人口\d+人/u)?.[0] ?? '人口已清点', territory);
    add(facts, chapterNumber, '灰烬领', 'organization', 'base', '灰烬领议事厅', territory);
    add(facts, chapterNumber, '灰烬领', 'organization', 'position', territory.match(/当前地位[^。]+/u)?.[0] ?? '苍原边境领', territory);
    add(facts, chapterNumber, '顾临川', 'character', 'identity', '灰烬领领主', territory);
    add(facts, chapterNumber, '顾临川', 'character', 'protagonist_state.领地.领地等级', { value:level, label:'领地等级', unit:'级' }, territory);
  }
  if (generals) {
    add(facts, chapterNumber, '岳重山', 'character', 'identity', '灰烬领守将', generals);
    add(facts, chapterNumber, '岳重山', 'character', 'attributes', generals.match(/岳重山武将属性[^；]+/u)?.[0] ?? generals, generals);
    add(facts, chapterNumber, '岳重山', 'character', 'equipment', '黑铁长枪与旧鳞甲', generals);
    add(facts, chapterNumber, '赫连朔', 'character', 'identity', '灰烬领右翼武将', generals);
    add(facts, chapterNumber, '赫连朔', 'character', 'attributes', generals.match(/赫连朔武将属性[^。]+/u)?.[0] ?? generals, generals);
    add(facts, chapterNumber, '赫连朔', 'character', 'equipment', '狼纹弯刀', generals);
  }
  add(facts, chapterNumber, location, 'location', `location.appears_in_chapter_${chapterNumber}`, `${location}是本章实际场景`, sentenceContaining(content, location) ?? content.slice(0,150));
  return facts;
}

function resourceLedger(chapterNumber: number) {
  const initial = { food:700, wood:360, stone:240, iron:90, crystal:24 };
  const before = { ...initial };
  for (let chapter = 1; chapter < chapterNumber; chapter += 1) apply(before, delta(chapter));
  const current = delta(chapterNumber);
  const after = { ...before }; apply(after, current);
  return { before, gain:current.gain, use:current.use, after };
}

function delta(chapter: number) {
  const eventIndex = Math.min(9, Math.floor((chapter - 1) / 10));
  const gain = { food:42 + eventIndex * 4, wood:28 + eventIndex * 3, stone:20 + eventIndex * 3, iron:chapter >= 30 ? 15 + eventIndex : 2, crystal:chapter >= 50 ? 3 + Math.floor(eventIndex / 2) : 1 };
  const use = { food:31 + eventIndex * 2, wood:13 + eventIndex, stone:9 + eventIndex, iron:4 + Math.floor(eventIndex / 2), crystal:eventIndex >= 5 ? 2 : 0 };
  const upgrades = { 20:{food:30,wood:80,stone:45,iron:10,crystal:0}, 30:{food:20,wood:70,stone:60,iron:20,crystal:0}, 50:{food:50,wood:100,stone:100,iron:35,crystal:4}, 70:{food:80,wood:180,stone:240,iron:90,crystal:10}, 90:{food:60,wood:120,stone:140,iron:80,crystal:24}, 100:{food:120,wood:200,stone:260,iron:120,crystal:40} };
  const cost = upgrades[chapter as keyof typeof upgrades];
  if (cost) for (const key of Object.keys(use) as Array<keyof typeof use>) use[key] += cost[key];
  return { gain, use };
}

function apply(target: Record<string, number>, current: { gain: Record<string, number>; use: Record<string, number> }) {
  for (const key of Object.keys(target)) target[key] = target[key]! + current.gain[key]! - current.use[key]!;
}

function fill(paragraphs: string[], digest: string, expansions: string[]) {
  const chosen = new Set<number>();
  const start = Number.parseInt(digest.slice(2,4),16) % expansions.length;
  const step = 1 + (Number.parseInt(digest.slice(4,6),16) % Math.max(1, expansions.length - 1));
  let ordinal = 0;
  while (count(paragraphs.join('\n\n')) < 2_780 && chosen.size < expansions.length) {
    let index = (start + ordinal * step) % expansions.length;
    while (chosen.has(index)) index = (index + 1) % expansions.length;
    chosen.add(index);
    paragraphs.splice(paragraphs.length - 1,0,expansions[index]!);
    ordinal += 1;
  }
  if (count(paragraphs.join('\n\n')) < 2_780) {
    throw new Error('结构化题材正文素材不足，拒绝用重复段落补足字数');
  }
}

function count(content: string) { return [...content].filter((character) => /[\p{L}\p{N}]/u.test(character)).length; }

function addAppearances(facts: Array<Record<string, unknown>>, content: string, chapterNumber: number, names: string[]) {
  for (const name of names) { const evidence = sentenceContaining(content,name); if (evidence) add(facts,chapterNumber,name,'character',`event.chapter_${String(chapterNumber).padStart(3,'0')}`,`${name}参与了第${chapterNumber}章的行动`,evidence); }
}

function addRelationships(facts: Array<Record<string, unknown>>, content: string, chapterNumber: number, pairs: string[][]) {
  for (const [from,to,kind] of pairs) {
    const evidence = sentenceContaining(content,from!,to!) ?? paragraphContaining(content,from!,to!);
    if (evidence) add(facts,chapterNumber,from!,'character',`relationship.${kind}`,to!,evidence);
  }
}

function add(facts: Array<Record<string, unknown>>, chapterNumber: number, subjectName: string, entityType: FactEntityType, relationKey: string, value: unknown, evidenceQuote: string) {
  facts.push({ subjectName, entityType, relationKey, value, evidenceQuote, evidenceLocation:`第${chapterNumber}章正文`, epistemicStatus:'objective', negated:false, viewpointName:null, knowledgeSubjectName:null, knowledgeTimeStart:null, knowledgeTimeEnd:null, storyTimeStart:`第${chapterNumber}章`, storyTimeEnd:`第${chapterNumber}章` });
}

function lineContaining(content: string, needle: string): string | null { return content.split(/\r?\n/u).map((line)=>line.trim()).find((line)=>line.includes(needle)) ?? null; }
function sentenceContaining(content: string, ...needles: string[]): string | null { return content.split(/(?<=[。！？])/u).map((item)=>item.trim()).find((item)=>needles.every((needle)=>item.includes(needle))) ?? null; }
function paragraphContaining(content: string, ...needles: string[]): string | null { return content.split(/\r?\n\s*\r?\n/u).map((item)=>item.trim()).find((item)=>needles.every((needle)=>item.includes(needle))) ?? null; }
