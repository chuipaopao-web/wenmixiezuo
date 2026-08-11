import { genreExpansionScenarioInputs } from './current-workflow-genre-expansion-scenarios.mjs';

const TEN_CHAPTER_PHASES = [
  '压力落到主角身上并迫使表态', '确认规则与第一处异常', '让同伴主动加入并提出不同判断',
  '第一次执行受阻并暴露真实代价', '对手根据主角行动调整策略', '队伍因目标差异发生分歧',
  '用可核验证据找到新路径', '付出代价完成中段反制', '多名角色并行完成决战准备',
  '兑现事件结果并形成下一事件接口'
];

function eventContent(meta, index) {
  const next = meta.next ?? null;
  return {
    title: meta.title,
    volumeResponsibility: meta.responsibility,
    startingState: meta.entry,
    trigger: meta.trigger,
    participants: meta.participants,
    characterGoals: meta.goals,
    obstacles: meta.obstacles,
    choicesAndCosts: meta.costs,
    informationMoves: meta.information,
    localProgression: meta.steps ?? TEN_CHAPTER_PHASES.map((phase) => `${meta.shortTitle}${phase}`),
    requiredResult: meta.result,
    flexibleExecution: ['对白、动作、局部场景调度和合理惊喜由章纲与主笔根据人物即时反应自由实现'],
    endingConditions: meta.endings,
    nextEventImpact: next,
    characterArcImpact: meta.characterArc,
    volumeClimaxImpact: meta.volumeImpact,
    estimatedChapterRange: { minimum: 10, likely: 10, maximum: 10 },
    uncertaintyNotes: index === 9 ? ['下一卷具体入口由本卷真实结算后再决定'] : []
  };
}

function makeScenario(input) {
  const events = input.eventMetas.map(eventContent);
  return {
    ...input,
    events,
    volumeIdea: `第一卷精确规划为10个连续事件、共100章，每个事件10章。事件依次为：${events.map((event, index) => `${index + 1}.${event.title}`).join('；')}。每个事件必须承接上一事件实际结果和人物新状态，至少四名主要角色主动行动；对手会学习和调整，胜利保留伤势、资源、关系或公开风险等代价。`,
    answerFor(item, attempt = 1) {
      const answer = input.answers[item.itemKey]
        ?? `${input.settingFallback} 当前项“${item.label}”只确定可持续运行的规则、人物边界和可核验来源，不提前写死具体场景；${item.prompt}`;
      return attempt === 1 ? answer : `${answer}\n补充确认：未知细节继续留作创作空间，任何新事实都要先形成候选并由作者确认。`;
    },
    volumeContent(templateEvent) {
      return {
        title: input.volumeTitle,
        coreGoal: input.volumeGoal,
        eventSequence: events.map((event, index) => ({
          ...templateEvent,
          eventId: `volume-event-${index + 1}`,
          order: index + 1,
          title: event.title,
          responsibility: event.volumeResponsibility,
          entryState: event.startingState,
          trigger: event.trigger,
          action: event.characterGoals.join('；'),
          result: event.requiredResult,
          leadsToNext: event.nextEventImpact,
          estimatedChapterRange: { minimum: 10, likely: 10, maximum: 10 }
        }))
      };
    },
    eventIdea(index) {
      const event = events[index];
      const start = index * 10 + 1;
      return `事件“${event.title}”精确覆盖第${start}—${start + 9}章。十章依次承担：${event.localProgression.join('；')}。必须从“${event.startingState}”出发，由“${event.trigger}”触发，最后真实达到“${event.requiredResult}”。人物要按各自动机行动，对手要根据结果修正策略；${event.choicesAndCosts.join('；')}。`;
    }
  };
}

const xianxia = makeScenario({
  key: 'xianxia',
  bookTitle: '阵骨问天',
  displayName: '东方仙侠多标签百章验收',
  volumeTitle: '第一卷·阵骨出山',
  volumeGoal: '沈砚用一百章从杂役院走到九峰公审，在伙伴共同见证下洗去父亲一半污名、守住北境阵脉，并把幕后内门长老逼到台前。',
  requiredNames: ['沈砚', '许小川', '苏青萝', '阿九', '韩烈', '魏长庚'],
  requiredTerms: ['阵纹', '试剑台', '黑风猎场', '灵矿', '九峰公审'],
  forbiddenTerms: ['林澈', '铜钥匙', '顾野', '零帧'],
  settingFallback: '九州修真、宗门资源、阵法条件、人物动机和证据链必须前后一致。',
  openingBlueprint(taxonomyVersion) {
    return {
      creationMode: 'new', taxonomyVersion, channel: 'male', categoryKey: 'male-eastern-xianxia',
      targetAudience: '喜欢快节奏、阵法智斗、宗门逆袭、群像成长与长线悬案的东方仙侠读者',
      protagonists: [{
        role: 'male_lead', name: '沈砚', age: '十八岁',
        background: '青霄宗杂役院少年，父亲沈铸曾是宗门阵师，却背负叛宗污名失踪；沈砚灵根驳杂，只能靠修补废阵换取妹妹药钱。',
        personalities: ['冷静敏锐', '护短重诺', '逆境果断', '敢赌但会复盘', '不轻信权威']
      }],
      storyDirection: '沈砚被逼上试剑台后发现父亲残阵盘能看见灵力破绽。他不靠突然暴涨的修为，而靠阵纹、判断、伙伴和代价连续破局；第一卷用十个事件、一百章，从试剑台反杀推进到九峰公审，逐层揭开父亲旧案、灵矿黑账和北境阵脉危机。',
      worldBackground: '九州修真世界，青霄宗控制北境灵矿与山门城镇；修炼分淬体、引气、筑基等境界，阵法依赖阵眼、灵石、地势和准备，越级取胜必须付出可见代价。',
      openingBackground: '杂役月考当日，韩烈当众踩碎沈砚替妹妹换药的灵石，逼他登上被人改过阵眼的试剑台。',
      stageOne: {
        start: '沈砚以残阵借力击败韩烈，保住药钱并拿到外门考核资格。',
        development: '他与许小川、苏青萝、阿九结盟，从黑风猎场一路查到灵矿总阵，在合作与分歧中对抗魏长庚及其上层。',
        end: '四人守住北境阵脉，在九峰公审公开证据，证明沈铸当年并非单纯叛宗，却发现真正主谋仍握有宗门核心阵权。'
      },
      fullBookOutline: '沈砚从杂役、外门、内门一路成长为阵道宗师；每卷解决一个迫在眉睫的生存或秩序问题，同时沿父亲旧案、北境灵矿、九州阵脉三层秘密递进。盟友有独立目标，会合作、质疑、犯错和成长。',
      mainTags: ['东方仙侠', '修仙', '逆袭', '智斗', '热血'],
      auxiliaryTags: ['阵法禁制', '剑修', '灵根', '宗门学院', '证据链'],
      storyTraits: ['快节奏', '越级战斗', '宗门成长', '群像', '智斗'],
      styleIntent: {
        languageTones: ['利落', '有画面感', '对白有辨识度'],
        emotionalTones: ['热血', '紧张', '伙伴关系有温度'],
        pacingAndPayoff: ['每章有状态变化', '每个事件独立兑现', '胜利保留代价'],
        atmospheres: ['宗门压迫', '秘境凶险', '公开翻盘'],
        custom: ['战斗讲清空间、阵眼、选择和代价，不用空喊招式名堆砌']
      },
      customTags: ['残阵破局', '草根组队', '宗门黑账', '父辈旧案', '北境阵脉', '多事件连续升级'],
      initialMap: '青霄宗杂役院、试剑台、外门七峰、黑风猎场、废弃灵矿、山门坊市、北境阵城与九峰公审台。',
      mustFollow: [
        '沈砚只能看见和理解阵纹破绽，不能凭空获得无限力量',
        '越级取胜必须依赖提前观察、环境、同伴配合或明确代价',
        '韩烈、魏长庚及后续对手有自身目标和学习能力，不能排队降智',
        '许小川、苏青萝、阿九都有独立动机、判断和行动，不能只是主角工具人'
      ]
    };
  },
  expressionProfile: {
    narrativePerson: 'third', viewpointDistance: 'close',
    languageTone: ['利落', '热血', '有画面感', '对白有辨识度'], textDensity: 'adaptive',
    targetAudience: '喜欢快节奏、阵法智取、群像成长和连续事件升级的东方仙侠读者',
    contentBoundaries: { powerRulesMustBeTraceable: true, noCostFreeVictory: true, noDisposableCompanions: true },
    humorSeriousness: 'balanced', voiceEvidence: [], impactScope: { appliesFrom: 'next_formal_work_order' }, confirm: true
  },
  answers: {
    'creative-concept': '核心创意是“弱者看见规则的缝”：沈砚没有无敌系统，只能借父亲残阵盘看清灵力和阵势的破绽。每次爽点来自观察、布置、伙伴选择与承担代价，长期主线是洗清父亲旧案并改变宗门把底层弟子当耗材的规则。',
    'reader-promise': '读者会持续得到阵法智取反杀、群像各展所长和十个事件逐级升级三种体验；每个事件当场兑现一个结果，同时让父亲旧案与北境阵脉出现新证据。',
    era: '故事发生在九州北境青霄宗。弟子分杂役、外门、内门与真传；淬体、引气、筑基等境界差距真实存在，阵法需要阵眼、灵石、地势和准备时间。',
    protagonist: '沈砚十八岁，冷静敏锐、坚韧护短，擅长修补残阵和压力判断；开篇只有淬体三重、半块残阵盘、许小川的消息渠道和必须替妹妹换药的现实压力。',
    motivation: '眼前目标是保住药钱、摆脱杂役身份并活过考核，深层目标是查明父亲旧案。底线是不牺牲无辜同门换胜利，也不把伙伴当阵眼耗材。',
    'must-follow': '力量、阵法和资源前后一致；越级反杀能复盘准备、地形、对手判断和代价。对手不能降智，伙伴不能工具化，新能力先有来源和试错再兑现。',
    'relationship-premise': '许小川负责情报与临场应变，苏青萝追查师兄失踪并擅长正面剑战，阿九掌握坊市和旧阵图线索；三人与沈砚利益相交但目标不同。',
    'relationship-obstacle': '许小川怕死却要救兄长，苏青萝一度怀疑沈铸真是叛徒，阿九隐藏与灵矿商会的关系；冲突来自秘密、利益和不同救人方式，不能靠一次坦白全部消失。',
    'case-rules': '父亲旧案与灵矿黑账按可核验线索推进：阵图、灵力残留、执事调令、阵眼改动和当事人行动互相印证；关键结论至少有两类来源。',
    'evidence-chain': '证据从试剑台阵眼、父亲阵盘同源纹路、猎场废矿异常灵流、灵矿调令、阵脉灾害记录逐层形成；传闻只作线索，不能直接洗清罪名。',
    'truth-layers': '前二十章确认魏长庚参与灵矿黑账；中段确认内门长老借阵脉灾害灭口；卷末只证明沈铸当年在阻止灾害，真正主谋与他的下落继续保留。'
  },
  eventMetas: [
    { title:'试剑台反杀', shortTitle:'试剑', responsibility:'让沈砚从被任意欺压的杂役变成有外门资格的主动调查者。', entry:'沈砚灵根驳杂、妹妹药钱将断，被韩烈逼签做过手脚的生死状。', trigger:'韩烈当众扣走药钱并逼沈砚登上暗藏杀阵的试剑台。', participants:['沈砚','许小川','苏青萝','阿九','韩烈','魏长庚'], goals:['沈砚保住药钱并取得资格','许小川查克扣证据','苏青萝核对阵台规则'], obstacles:['韩烈境界更高且会改变剑路','魏长庚掌握阵台维护权','残阵盘只看破绽不增力量'], costs:['救被波及杂役会错过直接取胜','首次布阵烧掉灵石并加重旧伤'], information:['生死状有沈铸暗记','废阵指向魏长庚私印'], steps:['生死状锁命','药房断供','废阵反噬','苏青萝拦路','第一次布阵失败','阿九交易阵图','封阵区取证','公议坪反咬','旧台决战','救人后反杀'], result:'沈砚借阵击败韩烈、救下同门、取得外门资格，并拿到指向黑风猎场的灭口任务。', endings:['韩烈败北但保留判断','沈砚得到外门资格','证据进入公开记录'], next:'外门令牌弹出的猎场任务既是晋级机会，也是魏长庚灭口陷阱。', characterArc:'沈砚从只想保药钱转为愿意与伙伴共同查旧案。', volumeImpact:'建立阵法智斗、群像配合和宗门黑账三条线。' },
    { title:'黑风猎场夺旗', shortTitle:'猎场', responsibility:'把公开胜利变成真实追杀，并以群像合作完成第一次大兑现。', entry:'沈砚刚入外门，底牌暴露，四人被送入规则遭篡改的猎场。', trigger:'传送把四人送入废矿旧区，地图与出口阵同时失效。', participants:['沈砚','许小川','苏青萝','阿九','韩烈','魏长庚'], goals:['沈砚带证据和同伴出场','许小川让黑账无法销毁','苏青萝证明规则被利用','阿九救兄长'], obstacles:['封山阵和执法队','韩烈反复站队','阵盘中段损坏'], costs:['救人会耗尽阵盘','阿九公开私心','沈砚强借残阵伤经脉'], information:['诱灵粉证明路线被做手脚','救援符连到魏长庚库房','黑账与旧阵图同藏阵眼'], steps:['猎场错传','赤松谷夺旗','裂石涧接应','废矿分队','救人耗尽阵盘','无阵盘反制','阵眼取黑账','出口反追杀','主峰破封山阵','祭旗台公开黑账'], result:'四人救出同门、夺得首旗、公开灵矿黑账，并取得沈铸旧阵图一角。', endings:['四人都有不可替代行动','首旗与黑账公开见证','阵盘损坏和伤势保留'], next:'旧阵图指向内门灵矿总阵，沈砚带伤进入下一事件。', characterArc:'沈砚学会分担任务，阿九从利益合作转向有限信任。', volumeImpact:'完成群像夺旗和黑账曝光双高潮。' },
    { title:'灵矿总阵潜行', shortTitle:'灵矿', responsibility:'沿猎场证据进入内门资源核心，证明黑账与阵脉抽取有关。', entry:'小队有黑账和旧阵图，但沈砚经脉受伤、公开身份受监视。', trigger:'黑账上的一批矿石将在三日内被秘密转走。', participants:['沈砚','许小川','苏青萝','阿九','裴照','矿监石无咎'], goals:['沈砚验证父亲阵图','许小川追账目','苏青萝保护证人','阿九找兄长线索'], obstacles:['总阵轮换密钥','矿工不信宗门弟子','裴照奉命监视'], costs:['公开黑账会连累无辜矿工','强开阵门会暴露残阵盘'], information:['矿石灵力被导向内门','沈铸曾改写总阵救矿工'], result:'小队保住矿工、截下转运证据并确认沈铸当年修改总阵是为阻止抽空阵脉。', endings:['矿工证词有双重来源','裴照开始质疑命令','总阵仍被幕后远程锁死'], next:'宗门以非法闯矿为由召开内门夺席审查。', characterArc:'沈砚第一次面对揭露真相会伤害普通人的两难。', volumeImpact:'把个人旧案升级为宗门资源秩序问题。' },
    { title:'内门夺席审查', shortTitle:'夺席', responsibility:'让小队在公开规则内争到调查资格，同时暴露规则被操控的层级。', entry:'小队握有证据却因非法闯矿面临逐出宗门。', trigger:'长老提出只有夺得内门席位者才有资格提交矿案。', participants:['沈砚','许小川','苏青萝','阿九','裴照','韩烈'], goals:['沈砚夺席保调查权','苏青萝挑战师门偏见','韩烈保住家族席位'], obstacles:['赛制临时改动','沈砚伤势未愈','证人被隔离'], costs:['夺席会公开更多底牌','苏青萝必须违抗师命'], information:['赛制阵眼与灵矿锁阵同源','韩烈家族也是被利用者'], result:'沈砚以团队分工夺得席位，韩烈转为有限证人，矿案进入内门议程。', endings:['席位合法确认','韩烈证词有保留','幕后改动赛制的权限浮现'], next:'新权限指向冰河秘境中的阵脉观测站。', characterArc:'沈砚学会利用规则而非只在规则外反抗。', volumeImpact:'取得正式调查权并扩大阵营。' },
    { title:'冰河秘境救援', shortTitle:'冰河', responsibility:'在秘境灾变中验证阵脉危机，并让不同阵营通过共同救援建立脆弱信任。', entry:'调查队获得秘境权限，但队内仍互不完全信任。', trigger:'冰河观测站提前崩塌，数支弟子队失联。', participants:['沈砚','许小川','苏青萝','阿九','裴照','韩烈'], goals:['沈砚取观测记录','裴照救师弟','韩烈证明家族未参与灾变'], obstacles:['冰阵不断改写地形','救援与取证时间冲突','有人伪造求救信号'], costs:['救人会失去最完整记录','沈砚借阵脉将留下永久暗伤'], information:['灾变并非自然发生','观测记录被内门权限删改'], result:'众人救出失联弟子、保住一份残缺记录，确认有人主动制造阵脉过载。', endings:['主要角色各救下一组人','证据残缺但来源可信','沈砚留下阵寒暗伤'], next:'制造灾变的权限被反指向沈铸，宗门准备问罪。', characterArc:'伙伴从利益合作走向愿意为彼此承担损失。', volumeImpact:'把抽象阵脉问题变成可见灾害和人命。' },
    { title:'宗门问罪翻案', shortTitle:'问罪', responsibility:'在不靠反派自白的情况下拆穿伪造记录，守住调查队合法性。', entry:'冰河记录被篡改成沈铸遗留后门，沈砚成了灾变嫌疑人。', trigger:'执法殿公开拘押沈砚并冻结全部证据。', participants:['沈砚','许小川','苏青萝','阿九','裴照','执法长老谢玄'], goals:['许小川保全证据副本','苏青萝争取公开审理','沈砚证明记录时间矛盾'], obstacles:['证据被官方封存','谢玄熟悉全部流程','队伍面临各自师门压力'], costs:['公开取证手段会暴露所有消息渠道','裴照作证将失去真传资格'], information:['伪造记录使用现在才有的阵墨','谢玄只是执行者并非主谋'], result:'小队证明冰河记录被事后伪造，沈砚获释，谢玄被迫交出北境阵城调令。', endings:['翻案依靠物证与时间线','裴照失去真传候选','谢玄保留未说出的上级'], next:'调令显示北境阵城将在七日后被主动断供。', characterArc:'沈砚接受伙伴主动替他承担代价，而不把责任全部揽回。', volumeImpact:'完成中段低谷后的公开反转。' },
    { title:'北境阵城守夜', shortTitle:'阵城', responsibility:'把宗门内部斗争推到城防危机，让主角群必须保护此前不信任他们的人。', entry:'调查队洗去嫌疑，却得知阵城即将断供。', trigger:'边境妖潮提前出现，宗门补给队失踪。', participants:['沈砚','许小川','苏青萝','阿九','裴照','城主陆沉沙'], goals:['沈砚修城防阵','苏青萝守缺口','许小川找失踪补给','阿九稳住商路'], obstacles:['城民排斥宗门弟子','旧阵图缺页','妖潮被人为引导'], costs:['启动备用阵会耗尽民用灵库','追补给会失去守城人手'], information:['妖潮路线对应阵脉抽取点','失踪补给被内门截走'], result:'群像分线守住阵城，截回补给并抓到操纵妖潮的活证人。', endings:['城防未靠无限力量','民用灵库损耗记录保留','活证人进入公开保护'], next:'证人供出下一次阵脉过载将在宗门九峰同时发生。', characterArc:'沈砚从洗清家名转向主动保护更大共同体。', volumeImpact:'完成卷内第一次大规模群像战。' },
    { title:'九峰阵脉抢修', shortTitle:'阵脉', responsibility:'让十个事件的知识与关系同时回收，在全宗危机中证明队伍不可替代。', entry:'阵城守住，但九峰阵脉即将连锁过载。', trigger:'九峰灵灯同时熄灭，宗门却命令封锁消息。', participants:['沈砚','许小川','苏青萝','阿九','裴照','韩烈','陆沉沙'], goals:['沈砚阻断连锁过载','伙伴各守一条信息与补给线','韩烈说服家族开阵库'], obstacles:['九峰规则互不相同','幕后人持续发假调令','沈砚暗伤恶化'], costs:['分队会失去统一指挥','公开危机会引发宗门恐慌'], information:['父亲旧阵图其实是安全停机方案','幕后目标是逼掌门启用核心阵权'], result:'众人分线完成抢修，保住九峰，却发现掌门核心阵权已经被人借机复制。', endings:['每名伙伴独立完成任务','沈砚没有遥控所有人','安全停机方案公开留档'], next:'掌门以测试忠诚为名召沈砚进入核心阵室。', characterArc:'沈砚真正学会相信伙伴在自己看不见的地方作决定。', volumeImpact:'回收前八十章知识并准备最终审判。' },
    { title:'掌门核心试局', shortTitle:'试局', responsibility:'迫使沈砚在个人清白与宗门安全之间选择，并辨认掌门立场。', entry:'九峰保住，核心阵权却被复制，所有人都怀疑掌门。', trigger:'掌门单独召见沈砚，提出用父亲罪名换取核心阵权归位。', participants:['沈砚','许小川','苏青萝','阿九','裴照','掌门闻道陵'], goals:['沈砚确认掌门是否可信','伙伴从外部验证核心阵室','闻道陵保住宗门不崩'], obstacles:['信息被刻意分割','任何拒绝都可能触发清洗','复制阵权正在启动'], costs:['沈砚若公开父亲线索会失去最后私密证据','伙伴擅闯核心区会被永久逐宗'], information:['闻道陵早知部分真相但选择压下','复制阵权来自九峰长老联合印'], result:'沈砚拒绝交易，以伙伴外部证据迫使掌门同意九峰公审，核心阵权暂时冻结。', endings:['掌门不是简单善恶标签','父亲私密证据仍有一部分保留','九峰公审正式启动'], next:'真正主谋将在公审前销毁所有联合印来源。', characterArc:'沈砚不再把洗清父亲当成可以牺牲一切的唯一目标。', volumeImpact:'把终局冲突从战力对决转为制度与证据对决。' },
    { title:'九峰公审问天', shortTitle:'公审', responsibility:'完成第一卷人物、证据和阵脉三线兑现，同时保留下一卷真实问题。', entry:'九峰公审获准，但联合印来源正在被逐一销毁。', trigger:'公审前夜，魏长庚越狱并带走最后一枚原始联合印。', participants:['沈砚','许小川','苏青萝','阿九','裴照','韩烈','闻道陵','魏长庚'], goals:['沈砚保住证据与证人','伙伴分别阻断销毁链','魏长庚换取幕后庇护'], obstacles:['公审规则偏向长老','魏长庚掌握反证','阵脉再次出现过载征兆'], costs:['追魏长庚与守公审只能分兵','公开沈铸安全方案会让各方学会破解'], information:['沈铸当年承担叛名是为延迟阵脉崩坏','联合印仍有一枚来自宗外'], result:'众人在公审和阵脉抢险两线同时成功，洗去沈铸一半污名、冻结涉案长老阵权，并发现宗外势力持有最后联合印。', endings:['十事件证据链公开可回查','主要角色代价与关系保留','幕后与父亲下落不被假结算'], next:'下一卷从宗外联合印、沈铸下落和受损北境阵脉的真实结算继续。', characterArc:'沈砚从独自背负父名走到愿与伙伴共同定义未来。', volumeImpact:'完成百章卷高潮并打开更大的九州阵脉格局。' }
  ]
});

const esports = makeScenario({
  key: 'esports',
  bookTitle: '零帧登顶',
  displayName: '游戏电竞数据流百章验收',
  volumeTitle: '第一卷·零帧逆袭',
  volumeGoal: '顾野用一百章从落选数据分析师成长为星海联赛冠军指挥，以可验证的比赛数据、队友选择和版本理解，揭开战队数据篡改链。',
  requiredNames: ['顾野', '唐梨', '陆沉舟', '乔麦', '邵锋', '罗放'],
  requiredTerms: ['帧率', '经济曲线', '视野', '联赛', '总决赛'],
  forbiddenTerms: ['林澈', '铜钥匙', '沈砚', '试剑台'],
  settingFallback: '近未来电竞联赛、游戏版本、数据来源、选手状态、战队合同和赛制必须可核验并前后一致。',
  openingBlueprint(taxonomyVersion) {
    return {
      creationMode: 'new', taxonomyVersion, channel: 'male', categoryKey: 'male-game-sports',
      targetAudience: '喜欢快节奏电竞、战术博弈、数据流成长、战队群像和职业逆袭的游戏读者',
      protagonists: [{
        role: 'male_lead', name: '顾野', age: '二十岁',
        background: '前青训选手，因手伤转做比赛数据分析，被原俱乐部夺走模型署名并扫地出门；他能在复盘中捕捉毫秒级操作和经济曲线异常，但不能预测没有数据的新战术。',
        personalities: ['冷静较真', '胜负欲强', '嘴硬护队友', '擅长复盘', '敢在关键局承担责任']
      }],
      storyDirection: '顾野带着被夺署名的数据模型进入濒临解散的零帧战队。他不是靠系统直接给答案，而是通过录像、帧率、经济曲线、对手习惯和队友临场选择建立战术；第一卷十个事件、一百章，从公开试训打到全球总决赛，并追出俱乐部篡改训练数据与操纵转会的证据链。',
      worldBackground: '近未来职业电竞《界限》采用五人实时战术竞技，联赛有版本轮换、工资帽、青训注册、设备审计和公开数据接口；数据可能缺失、延迟或被污染，任何结论必须标明样本和适用版本。',
      openingBackground: '零帧战队公开试训日，原俱乐部经理罗放把顾野列入行业黑名单，冠军打野邵锋则当众嘲讽他的模型只会解释已经发生的失败。',
      stageOne: {
        start: '顾野用一份现场复盘帮助零帧替补队击败主力，拿到短期分析师兼替补指挥合同。',
        development: '他与指挥唐梨、队长陆沉舟、辅助乔麦从新秀杯打进城市联赛，在数据内鬼、版本变动和战队拆分中形成自己的打法。',
        end: '零帧在全球总决赛击败邵锋所在的极昼战队，公开篡改数据证据，但幕后资本仍掌握下一赛季规则投票权。'
      },
      fullBookOutline: '顾野从青训弃子、数据分析师、替补指挥成长为冠军战术核心；每卷围绕一个赛季和一条行业规则展开，比赛胜负、队友职业选择与数据篡改真相同步推进。',
      mainTags: ['游戏', '电竞', '竞技', '逆袭', '热血'],
      auxiliaryTags: ['电子竞技', '公会战队', '联赛规则', '赛季', '排行榜', '行业内幕'],
      storyTraits: ['快节奏', '群像', '智斗', '职业选手', '赛事成长'],
      styleIntent: {
        languageTones: ['清晰利落', '比赛画面强', '角色口吻鲜明'],
        emotionalTones: ['热血', '紧张', '队友情绪克制但真实'],
        pacingAndPayoff: ['每章改变比赛或队伍状态', '每个事件完成一轮比赛兑现', '失败改变后续打法'],
        atmospheres: ['训练室压迫', '赛场喧嚣', '复盘冷静'],
        custom: ['数据只解释决策，不把人物写成表格；比赛讲清视野、资源、时间点与临场取舍']
      },
      customTags: ['毫秒复盘', '经济曲线', '零帧战队', '版本风暴', '冠军复仇', '数据证据链'],
      initialMap: '零帧训练基地、公开试训馆、城市联赛主场、职业联盟数据中心、世界服训练赛、季后赛场馆与全球总决赛舞台。',
      mustFollow: [
        '顾野只能分析已有或现场采集的数据，不能凭空预知对手未公开的新战术',
        '比赛胜负必须由视野、资源、阵容、版本理解、操作和临场选择共同形成',
        '唐梨、陆沉舟、乔麦都有独立职业目标和决策，不能只执行顾野命令',
        '罗放、邵锋及其他对手会复盘和改变策略，不能重复掉进同一种陷阱'
      ]
    };
  },
  expressionProfile: {
    narrativePerson: 'third', viewpointDistance: 'close',
    languageTone: ['清晰利落', '热血克制', '比赛画面强', '对白有辨识度'], textDensity: 'adaptive',
    targetAudience: '喜欢职业电竞、数据流战术、战队群像和连续比赛升级的游戏读者',
    contentBoundaries: { dataSourcesMustBeTraceable: true, noOmniscientPrediction: true, teammatesKeepAgency: true },
    humorSeriousness: 'balanced', voiceEvidence: [], impactScope: { appliesFrom: 'next_formal_work_order' }, confirm: true
  },
  answers: {
    'creative-concept': '核心创意是“数据不能替人比赛”：顾野能从帧率、经济曲线和视野记录里看出选择的后果，却不能预测没有样本的新战术。真正的爽点来自他把数据转成队友能临场使用的判断，并让每个人用自己的方式完成关键选择。',
    'reader-promise': '读者会持续看到可看懂的战术反杀、多名队员各自高光和从青训试训到全球冠军的赛季升级；每个事件完成一轮比赛结果，同时推进数据篡改与转会黑幕。',
    era: '近未来《界限》职业联赛，比赛采用五人战术竞技和公开数据接口；版本、地图、英雄、工资帽、注册、设备审计与赛季积分都有明确规则。',
    protagonist: '顾野二十岁，前青训选手，手伤后转数据分析。冷静较真、胜负欲强，能捕捉毫秒级操作和经济曲线异常，但必须依赖真实录像、采样范围和当前版本。',
    motivation: '眼前目标是拿到职业合同、保住零帧战队并证明自己的模型不是偷来的；深层目标是查清原俱乐部如何篡改训练数据和操纵转会。底线是不拿队友健康和职业前途做不可告知的实验。',
    'must-follow': '数据结论标明来源、样本和版本；比赛胜负由资源、视野、阵容、操作和临场选择形成。队友有自主判断，对手会复盘，不能靠万能面板或降智翻盘。',
    'relationship-premise': '唐梨是激进指挥，陆沉舟是想保住战队的老队长，乔麦兼辅助与数据工程；三人与顾野目标相交但对风险、版本和职业未来看法不同。',
    'relationship-obstacle': '唐梨担心数据扼杀临场创造，陆沉舟隐瞒手伤，乔麦曾参与原俱乐部的数据管线；冲突必须通过比赛选择、证据和长期信任推进。',
    'game-entry': '故事以现实职业联赛为主，没有穿越或虚拟现实伤害同步；训练、比赛与数据接口都受联盟规则和设备审计约束。',
    'player-npc': '所有参赛者都是真实职业选手；游戏内角色只承载技能与阵容功能，不具备独立人格。',
    'game-panel': '公开面板显示击杀、资源和赛后回放，战队私有数据包含视野热区、操作帧和沟通标记；数据可能延迟、缺失或被污染。',
    'class-skill': '选手按位置、英雄池和战术职责成长，不存在超自然升级；新打法必须经过训练赛、版本验证和赛场调整。',
    loot: '职业赛不靠随机装备掉落决定成长；局内装备由经济和阵容选择形成，局外资源是合同、训练时间、分析工具和版本信息。',
    'quest-instance': '赛事由公开试训、新秀杯、城市联赛、季后赛、国际邀请赛和全球总决赛组成；每轮有明确晋级、复活和淘汰规则。',
    ranking: '榜单按官方积分、胜负关系和小分计算，赛季重置保留注册与历史成绩；异常数据必须通过联盟审计，不能由战队自行定罪。'
  },
  eventMetas: [
    { title:'公开试训逆选', shortTitle:'试训', responsibility:'让顾野从行业黑名单上的落选者成为零帧短期分析师兼替补指挥。', entry:'顾野被原俱乐部夺走模型署名并列入黑名单，零帧战队濒临解散。', trigger:'试训主力临时缺席，唐梨要求顾野现场带替补打满一局。', participants:['顾野','唐梨','陆沉舟','乔麦','邵锋','罗放'], goals:['顾野证明分析能落地','唐梨找到可用新战术','陆沉舟保住战队名额'], obstacles:['数据接口被限制','替补互不熟悉','邵锋临场换打法'], costs:['顾野公开模型弱点','陆沉舟带伤上场'], information:['训练数据被人为裁剪','罗放提前拿到试训阵容'], result:'零帧替补击败主力，顾野拿到十场短约，并发现数据泄露来自联盟内网权限。', endings:['胜负能复盘','唐梨保留对数据打法的质疑','短约而非一步登天'], next:'新秀杯报名截止前，零帧必须用十场短约打出晋级积分。', characterArc:'顾野从只想证明自己转为开始对队伍结果负责。', volumeImpact:'建立数据、比赛和行业黑幕三条线。' },
    { title:'新秀杯连胜', shortTitle:'新秀', responsibility:'让四人形成第一套共同打法，并让对手开始针对数据习惯。', entry:'顾野只有十场短约，零帧阵容与信任都不稳定。', trigger:'新秀杯采用陌生版本，零帧首轮就遇到邵锋带队的极昼二队。', participants:['顾野','唐梨','陆沉舟','乔麦','邵锋','极昼二队'], goals:['唐梨保住临场指挥权','顾野建立可用复盘语言','乔麦修正数据管线'], obstacles:['版本样本不足','邵锋故意制造假习惯','陆沉舟手伤波动'], costs:['连胜打法会暴露英雄池','继续让陆沉舟上场会加重伤势'], information:['假数据只在零帧下载端出现','乔麦旧账号仍有原俱乐部权限'], result:'零帧以一场败局换来打法修正，随后连胜晋级，顾野获得赛季合同。', endings:['失败真实改变后续打法','四名角色都有高光','泄露入口尚未定罪'], next:'联盟审计前，战队内部数据又被人主动导出。', characterArc:'顾野学会把数据结论翻译成队友能质疑和修改的方案。', volumeImpact:'完成第一次赛场兑现和团队成形。' },
    { title:'数据内鬼追踪', shortTitle:'内鬼', responsibility:'在不破坏队伍信任的前提下查清数据泄露路径。', entry:'零帧晋级却被对手提前预判，乔麦旧账号成为最大嫌疑。', trigger:'关键训练赛录像在开赛前出现在匿名论坛。', participants:['顾野','唐梨','陆沉舟','乔麦','罗放','联盟审计员夏禾'], goals:['顾野保全证据不先定罪','乔麦证明账号被利用','唐梨保护训练计划'], obstacles:['日志时间被改写','战队成员互相怀疑','联盟只接受规范取证'], costs:['停用数据系统会失去备战优势','公开旧账号会伤害乔麦职业信誉'], information:['泄露通过设备同步而非乔麦手动导出','罗放持有供应商管理权'], result:'团队找到同步漏洞并保住乔麦清白，但罗放以合规合同掩盖供应商权限。', endings:['证据进入联盟留档','队内信任有裂痕也有修复','真正操作者仍未知'], next:'城市联赛开始，零帧必须在停用旧系统的情况下比赛。', characterArc:'顾野克制把相关性当结论的冲动，队伍建立证据边界。', volumeImpact:'把黑幕从猜测推进到可追溯权限链。' },
    { title:'城市联赛破局', shortTitle:'城赛', responsibility:'证明零帧在没有旧数据系统时仍能靠共同判断赢比赛。', entry:'旧系统停用，顾野只能现场手记，队伍失去最熟悉的复盘工具。', trigger:'城市联赛首日遭遇以视野压制著称的重岳战队。', participants:['顾野','唐梨','陆沉舟','乔麦','重岳队长韩彻','夏禾'], goals:['顾野建立低技术依赖战术','唐梨扩大临场自由','陆沉舟管理手伤'], obstacles:['视野数据延迟','客场设备不熟','对手针对顾野节奏'], costs:['放弃最稳阵容换取信息','陆沉舟必须轮休关键局'], information:['设备帧率异常只出现在零帧席位','异常与供应商权限同源'], result:'零帧用临场视野语言击败重岳，取得季后赛资格并拿到设备异常样本。', endings:['唐梨临场改令成为胜负点','陆沉舟轮休代价保留','样本交联盟'], next:'资本方以经营亏损为由要求出售战队席位。', characterArc:'顾野接受数据不是唯一指挥语言。', volumeImpact:'完成脱离工具后的能力验证。' },
    { title:'战队拆分风暴', shortTitle:'拆队', responsibility:'让人物职业选择成为主冲突，避免战队团结只靠口号。', entry:'零帧进季后赛却面临出售，队员收到不同俱乐部报价。', trigger:'投资人宣布三日内签转会意向，否则停止基地运营。', participants:['顾野','唐梨','陆沉舟','乔麦','罗放','投资人周闻'], goals:['陆沉舟保住席位','唐梨争取自主合同','乔麦保护数据产权','顾野查报价来源'], obstacles:['工资欠付','队员家庭压力','报价附带保密条款'], costs:['拒绝报价可能失去职业资格','接受众筹会让战术公开'], information:['四份报价都来自罗放关联公司','转会条款要求放弃历史数据权'], result:'四人选择不同方式暂留并共同买下短期运营权，保住季后赛资格但背上真实债务。', endings:['没有强迫所有人同一理由','合同来源可查','债务进入后续状态'], next:'为偿还运营款，零帧接受世界服高额训练赛邀请。', characterArc:'顾野学会尊重队友不同的职业风险承受方式。', volumeImpact:'把赛场胜负连接到现实行业压力。' },
    { title:'世界服副本战', shortTitle:'世界服', responsibility:'让零帧面对陌生赛区和无历史样本的新打法。', entry:'战队保住席位但负债，旧数据对世界服对手几乎无效。', trigger:'国际训练赛采用尚未上线的新地图和随机资源规则。', participants:['顾野','唐梨','陆沉舟','乔麦','韩国指挥尹海真','欧洲新人米洛'], goals:['顾野建立实时采样','唐梨对抗陌生节奏','乔麦保证数据合法'], obstacles:['语言沟通','样本极少','地图资源随机'], costs:['边打边试会输掉奖金','共享数据会暴露季后赛打法'], information:['罗放在国际供应商也有权限','新地图异常点与旧帧率问题一致'], result:'零帧失去部分奖金却赢下最后两局，形成不依赖预测的实时决策协议。', endings:['先败后学而非万能分析','国际角色有独立打法','债务只部分缓解'], next:'季后赛对手获得零帧实时协议的残缺版本。', characterArc:'顾野从追求正确预测转向帮助队伍更快修正。', volumeImpact:'扩大竞技格局并验证数据能力边界。' },
    { title:'季后赛生死局', shortTitle:'季后', responsibility:'回收前六事件战术，让队伍在对手已知打法时完成国内晋级。', entry:'零帧进入败者组，对手掌握残缺实时协议并针对唐梨。', trigger:'陆沉舟旧伤复发，联盟只允许一次紧急替补。', participants:['顾野','唐梨','陆沉舟','乔麦','邵锋','替补程雾'], goals:['顾野决定是否亲自上场','唐梨重建指挥链','陆沉舟完成交接'], obstacles:['替补磨合不足','对手公开嘲讽施压','赛点版本热修'], costs:['顾野上场会暴露手伤后操作短板','陆沉舟退场可能失去首发位置'], information:['极昼拿到协议但误解了修正条件','热修数据被供应商提前泄露'], result:'顾野以替补指挥身份上场，零帧通过队友自主修正赢下生死局，取得国际邀请赛名额。', endings:['陆沉舟交接而非被工具化淘汰','顾野操作有明确短板','泄露证据继续留档'], next:'联盟发布大版本，过去全部胜率模型失效。', characterArc:'顾野愿意在自己不擅长的位置承担可见责任。', volumeImpact:'完成国内赛季高潮并转入版本危机。' },
    { title:'版本风暴重构', shortTitle:'版本', responsibility:'让队伍主动推翻成功经验，防止百章后仍重复同一套路。', entry:'零帧取得国际名额，但核心英雄和地图资源被大改。', trigger:'大版本上线后，零帧训练赛胜率跌到末位。', participants:['顾野','唐梨','陆沉舟','乔麦','程雾','版本设计顾问林岚'], goals:['顾野废弃过时模型','唐梨开发双指挥','程雾争取正式位置'], obstacles:['时间只有七天','旧成功经验形成依赖','内部争夺上场位'], costs:['重构会放弃熟练阵容','公开训练赛可能打击士气'], information:['版本变化本身合规','供应商却在设备层继续制造帧差'], result:'零帧建立双指挥和角色交换体系，胜率回升，并把设备问题与版本问题彻底分开。', endings:['程雾获得正式职责','旧模型归档而非偷偷继续用','设备证据独立成链'], next:'国际邀请赛采用统一设备，罗放失去最熟悉的操纵入口。', characterArc:'顾野证明成长包括主动放弃曾让自己成功的方法。', volumeImpact:'更新百章中后段打法与人物结构。' },
    { title:'国际邀请赛夺冠', shortTitle:'邀请赛', responsibility:'在统一设备下与不同赛区强队博弈，并迫使黑幕转向更高层规则。', entry:'零帧完成版本重构，国际对手未知，设备首次统一。', trigger:'小组赛首局遇到尹海真率领的冠军队，对方专打双指挥沟通缝隙。', participants:['顾野','唐梨','陆沉舟','乔麦','程雾','尹海真','米洛'], goals:['唐梨稳定双指挥边界','顾野识别跨赛区节奏','乔麦验证统一设备'], obstacles:['赛程密集','语言与信息战','罗放推动临时规则解释'], costs:['针对一队会暴露给下一队','轮换让每个人数据样本变少'], information:['统一设备没有帧差','罗放开始操纵规则投票而非数据'], result:'零帧击败三种风格夺得邀请赛冠军，获得全球总决赛资格和联盟申诉席位。', endings:['每位队员至少一次决定胜局','跨赛区对手保持尊严和能力','申诉权有明确范围'], next:'全球总决赛前，罗放提交规则提案试图让旧证据失效。', characterArc:'队伍能够在顾野无法看全时自行完成判断。', volumeImpact:'完成国际赛场兑现并把终局转向规则证据。' },
    { title:'全球总决赛', shortTitle:'总决赛', responsibility:'完成比赛、人物和数据证据三线终局，同时留下下一赛季真实问题。', entry:'零帧获总决赛资格与申诉席位，极昼和罗放同时准备反击。', trigger:'罗放的新规则提案将旧设备日志定义为不可采信，邵锋则拿出完全陌生阵容。', participants:['顾野','唐梨','陆沉舟','乔麦','程雾','邵锋','罗放','夏禾'], goals:['零帧赢下总决赛','乔麦保住证据合法性','夏禾完成联盟审计','邵锋证明不靠黑幕也能赢'], obstacles:['陌生阵容无样本','申诉与比赛同时进行','陆沉舟最后一次首发'], costs:['分人处理申诉会削弱赛前准备','公开实时协议会让未来对手受益'], information:['邵锋不知全部篡改链','关键证据来自统一设备后的对照样本','幕后资本控制规则投票'], result:'零帧凭临场双指挥击败极昼夺冠，乔麦与夏禾公开数据篡改链，罗放被停职调查；幕后资本仍保有下赛季投票权。', endings:['冠军由角色选择与比赛过程形成','证据链可回查','陆沉舟职业选择留给本人','下一卷不假装行业已经净化'], next:'下一卷从冠军后的合同、规则投票、国际赛季和队伍新角色继续。', characterArc:'顾野从被夺署名的孤立分析师成长为愿把决定权和荣耀分给队伍的冠军指挥。', volumeImpact:'完成百章冠军爽点与行业黑幕阶段结算。' }
  ]
});

function deepReplace(value, pairs) {
  if (typeof value === 'string') return pairs.reduce((text, [from, to]) => text.split(from).join(to), value);
  if (Array.isArray(value)) return value.map((item) => deepReplace(item, pairs));
  if (value !== null && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, deepReplace(item, pairs)]));
  return value;
}

function transformedScenarioInput(base, overrides, pairs) {
  return { ...base, ...overrides,
    openingBlueprint(taxonomyVersion) { return deepReplace(base.openingBlueprint(taxonomyVersion), pairs); },
    expressionProfile: deepReplace(base.expressionProfile, pairs), answers: deepReplace(base.answers, pairs), eventMetas: deepReplace(base.eventMetas, pairs)
  };
}

const gameLordInput = transformedScenarioInput(genreExpansionScenarioInputs.lord, {
  key: 'game_lord', bookTitle: '界域领主日志', displayName: '游戏领主数据流百章验收', volumeTitle: '第一卷·晨星边境',
  volumeGoal: '苏砚通过十个因果连续事件，把八十一人的晨星领经营成三级游戏领地，守住资源、人口与自治权。',
  requiredNames: ['苏砚','宁霜','铁山','商晚','裴烈','狼爵'], requiredTerms: ['领主面板','领地等级','资源产出','英雄属性','建筑面板','升级消耗规划'],
  forbiddenTerms: ['顾临川','灰烬领','陆昭','霜尾','顾星河','银羽','沈砚','顾野'], settingFallback: '领地人口、库存、资源产出、英雄、建筑与升级必须有正文来源并能连续对账。'
}, [['灰烬领主','界域领主日志'],['顾临川','苏砚'],['灰烬领','晨星领'],['秦瑶','宁霜'],['岳重山','铁山'],['商九娘','商晚'],['赫连朔','裴烈'],['黑旗伯','狼爵'],['武将','英雄'],['苍原诸领','界域诸领'],['灵晶','界晶']]);

const douluoBaseInput = transformedScenarioInput(genreExpansionScenarioInputs.game_xianxia, {
  key: 'douluo_fanfic', bookTitle: '斗罗星轮行', displayName: '斗罗原创同人支线百章验收', volumeTitle: '第一卷·星轮初鸣',
  volumeGoal: '原创魂师顾星河与魂兽伙伴银羽通过十个连续事件，阻止镜魂祭坛篡改武魂和魂环记录，并守住彼此独立成长的权利。',
  requiredNames: ['顾星河','银羽','洛清弦','石岳','叶璃','司空夜'], requiredTerms: ['斗罗大陆','武魂','魂力等级','魂环','魂技','星斗大森林'],
  forbiddenTerms: ['陆昭','霜尾','顾临川','灰烬领','沈砚','顾野','唐三','小舞'], settingFallback: '武魂、魂力、魂环、魂技、魂骨和人物知情范围必须前后一致；原创支线不复述原著正文或既有主角剧情。'
}, [['灵契天墟','斗罗星轮行'],['职业觉醒战','武魂觉醒战'],['陆昭','顾星河'],['霜尾','银羽'],['叶绯','洛清弦'],['石拓','石岳'],['乌槐','叶璃'],['赫连魇','司空夜'],['御灵剑使','星轮魂师'],['职业等级','魂力等级'],['职业','武魂'],['技能','魂技'],['灵宠','魂兽伙伴'],['镜像祭坛','镜魂祭坛'],['星痕剑阵','星轮锁域'],['赤月剑匣','星纹魂骨匣'],['青铜灵剑','星纹短刃'],['天墟城觉醒广场','诺丁边城武魂觉醒堂'],['灰晶矿洞','寒铁矿洞'],['灵宠竞技场','魂兽斗场'],['浮空学院','天斗学院'],['赤月副本','星斗大森林赤月谷'],['兽潮边境','索托边城'],['王都','天斗城'],['天门','封号试炼天门'],['游戏规则侵入的仙侠异界','斗罗大陆背景中的原创边境支线'],['玩家','魂师'],['经验','修炼记录'],['契约','盟约'],['平等灵契','平等盟约'],['人物属性','魂师状态'],['灵宠属性','魂兽伙伴状态'],['进化','血脉觉醒']]);

const douluoInput = {
  ...douluoBaseInput,
  openingBlueprint(taxonomyVersion) {
    const blueprint = douluoBaseInput.openingBlueprint(taxonomyVersion);
    return {
      ...blueprint,
      auxiliaryTags: blueprint.auxiliaryTags.filter((tag) => tag !== '武魂魂技树'),
      customTags: [...new Set([...blueprint.customTags, '武魂魂技树'])]
    };
  }
};
const gameXianxia = makeScenario(genreExpansionScenarioInputs.game_xianxia);
const lord = makeScenario(genreExpansionScenarioInputs.lord);
const gameLord = makeScenario(gameLordInput);
const douluoFanfic = makeScenario(douluoInput);
export const workflowScenarios = Object.freeze({ xianxia, esports, game_xianxia: gameXianxia, lord, game_lord: gameLord, douluo_fanfic: douluoFanfic });

export function requireWorkflowScenario(key) {
  const scenario = workflowScenarios[key];
  if (scenario === undefined) throw new Error(`未知验收场景：${key}；只允许xianxia、esports、game_xianxia、lord、game_lord或douluo_fanfic`);
  return scenario;
}
