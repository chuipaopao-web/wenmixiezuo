import { createHash } from 'node:crypto';
import { assessManuscriptMetaNarration } from '@wenmi/contracts';
import type { ModelAdapter, ModelRequest, ModelResult } from './model-adapter.js';
import type { ReviewerRole } from '../../contracts/production-review.js';
import { assertDeterministicCreativeFixtureAllowed } from './deterministic-model.js';
import { buildEsportsNovel, longXianxiaPlan } from './deterministic-longform-scenarios.js';
import {
  buildDouluoFanficNovel, buildGameLordNovel, buildGameXianxiaNovel, buildLordNovel, structuredGenreFactCandidates
} from './deterministic-structured-genre-scenarios.js';

interface DraftPrompt {
  operation: 'draft';
  chapterNumber: number;
  title: string;
  previousState?: string;
}

interface RewritePrompt {
  operation: 'rewrite';
  content: string;
  requiredActions: string[];
}

interface WriterContextSource {
  sourceType: string | undefined;
  content: string | undefined;
}

interface WriterPromptEnvelope {
  taskInput: DraftPrompt | RewritePrompt;
  sources: WriterContextSource[];
}

export interface StructuredReviewIssue {
  location: string;
  issueType: string;
  severity: 'blocker' | 'major' | 'minor' | 'observation';
  evidence: string;
  requiredAction: string;
}

export interface StructuredReview {
  verdict: 'pass' | 'rewrite' | 'blocked';
  summary: string;
  issues: StructuredReviewIssue[];
  scores: { continuity: number; character: number; pacing: number; style: number; hook: number };
}

export function assertDeterministicNovelFixtureAllowed(env: NodeJS.ProcessEnv = process.env): void {
  assertDeterministicCreativeFixtureAllowed(env);
}

export class DeterministicNovelWriterAdapter implements ModelAdapter {
  public readonly provider = 'local-deterministic-writer';
  public readonly modelId = 'wenmi-novel-writer-v1';

  public async generate(request: ModelRequest, signal?: AbortSignal): Promise<ModelResult> {
    assertNotAborted(signal);
    assertDeterministicNovelFixtureAllowed();
    const parsed = parseWriterPrompt(request.prompt);
    const prompt = parsed.taskInput;
    const output = prompt.operation === 'rewrite'
      ? rewriteNovel(prompt.content, prompt.requiredActions)
      : buildContextAwareNovel(request.bookId, prompt, parsed.sources);
    return result(this.provider, this.modelId, request.prompt, output);
  }
}

export class DeterministicNovelCandidateBAdapter implements ModelAdapter {
  public readonly provider = 'local-deterministic-candidate-b';
  public readonly modelId = 'wenmi-novel-candidate-b-v1';

  public async generate(request: ModelRequest, signal?: AbortSignal): Promise<ModelResult> {
    assertNotAborted(signal);
    assertDeterministicNovelFixtureAllowed();
    const parsed = parseWriterPrompt(request.prompt);
    const prompt = parsed.taskInput;
    const output = prompt.operation === 'rewrite'
      ? rewriteNovel(prompt.content, prompt.requiredActions)
      : buildContextAwareNovel(request.bookId, { ...prompt, title: `${prompt.title}·备选` }, parsed.sources);
    return result(this.provider, this.modelId, request.prompt, output);
  }
}

export class DeterministicNovelReviewerAdapter implements ModelAdapter {
  public readonly provider = 'local-deterministic-reviewer';
  public readonly modelId = 'wenmi-novel-reviewer-v1';

  public async generate(request: ModelRequest, signal?: AbortSignal): Promise<ModelResult> {
    assertNotAborted(signal);
    assertDeterministicCreativeFixtureAllowed();
    const input = JSON.parse(request.prompt) as { content: string; reviewerRole?: ReviewerRole; manuscriptVersionId?: string; modelSnapshotId?: string };
    const review = reviewNovel(input.content);
    const output = JSON.stringify(input.reviewerRole === undefined
      ? review
      : productionReview(input.reviewerRole, input.manuscriptVersionId ?? '', input.modelSnapshotId ?? '', input.content, review));
    return result(this.provider, this.modelId, request.prompt, output);
  }
}

export class DeterministicProductionReviewerAdapter implements ModelAdapter {
  public readonly provider = 'local-deterministic';
  public constructor(public readonly modelId: string, private readonly reviewerRole: ReviewerRole) {}

  public async generate(request: ModelRequest, signal?: AbortSignal): Promise<ModelResult> {
    assertNotAborted(signal);
    assertDeterministicCreativeFixtureAllowed();
    const input = JSON.parse(request.prompt) as { content: string; manuscriptVersionId: string; modelSnapshotId: string };
    const review = reviewNovel(input.content);
    const output = JSON.stringify(productionReview(this.reviewerRole, input.manuscriptVersionId, input.modelSnapshotId, input.content, review));
    return result(this.provider, this.modelId, request.prompt, output);
  }
}

export function countNovelCharacters(content: string): number {
  return [...content].filter((character) => /[\p{L}\p{N}]/u.test(character)).length;
}

export function reviewNovel(content: string): StructuredReview {
  const issues: StructuredReviewIssue[] = [];
  if (content.includes('就在这时，就在这时')) {
    issues.push({
      location: '首个场景转折处', issueType: 'style_repetition', severity: 'major',
      evidence: '就在这时，就在这时', requiredAction: '删除重复转折词并保留动作因果'
    });
  }
  if (/【|TODO|待补|占位/u.test(content)) {
    issues.push({
      location: '全文', issueType: 'placeholder', severity: 'blocker',
      evidence: '检测到占位或元叙事标记', requiredAction: '用完整叙事替换占位内容'
    });
  }
  const metaNarration = assessManuscriptMetaNarration(content);
  if (!metaNarration.passed) {
    issues.push({
      location: '全文', issueType: 'quality_governance_leak', severity: 'major',
      evidence: metaNarration.issues.map((issue) => issue.evidence).join('；').slice(0, 240),
      requiredAction: '把资料核对、结算和质量规则改写成场景、动作、对白与具体后果'
    });
  }
  const blocker = issues.some((issue) => issue.severity === 'blocker');
  const needsRewrite = issues.some((issue) => issue.severity === 'major' || issue.severity === 'minor');
  return {
    verdict: blocker ? 'blocked' : needsRewrite ? 'rewrite' : 'pass',
    summary: issues.length === 0 ? '结构、连续性、人物行动和文风均通过确定性审校。' : `发现${issues.length}项可定位问题。`,
    issues,
    scores: {
      continuity: 92,
      character: 90,
      pacing: issues.length === 0 ? 91 : 86,
      style: content.includes('就在这时，就在这时') ? 68 : 90,
      hook: 89
    }
  };
}

function productionReview(
  reviewerRole: ReviewerRole,
  manuscriptVersionId: string,
  modelSnapshotId: string,
  content: string,
  review: StructuredReview
): Record<string, unknown> {
  const paragraphs = content.split(/\n\s*\n/u).filter((paragraph) => paragraph.trim().length > 0);
  const repeated = content.includes('就在这时，就在这时');
  const common = {
    reviewerRole,
    manuscriptVersionId,
    modelSnapshotId,
    verdict: review.verdict,
    summary: reviewerRole === 'fact' ? '已核对当前正文的连续性、人物行动因果与硬约束。' : review.summary,
    issues: review.issues,
    scores: reviewerRole === 'fact'
      ? { continuity: review.scores.continuity, character: review.scores.character, causality: 91 }
      : reviewerRole === 'literary'
        ? { literary: 89, characterVoice: 90, rhythm: review.scores.pacing, aiStyle: repeated ? 68 : 92 }
        : { immersion: 90, hook: review.scores.hook, emotionalForce: 88, compliance: 96 }
  };
  if (reviewerRole === 'literary') {
    const flagged = repeated ? 1 : 0;
    return {
      ...common,
      aiStyle: {
        riskScore: repeated ? 32 : 8,
        flaggedParagraphCount: flagged,
        totalParagraphCount: Math.max(1, paragraphs.length),
        flaggedParagraphRatio: flagged / Math.max(1, paragraphs.length),
        isAuthorshipProbability: false,
        evidence: repeated ? ['首段重复使用“就在这时”，形成可定位的机械转折。'] : []
      }
    };
  }
  if (reviewerRole === 'experience') {
    const none = (policyVersion: string) => ({ level: 'none', locations: [], evidence: [], recommendedAction: '无需修改，继续保持基于正文证据复核。', policyVersion });
    return { ...common, politicalRisk: none('wenmi-content-policy-2026-07'), sexualContentRisk: none('wenmi-content-policy-2026-07') };
  }
  return { ...common, factCandidates: deterministicFactCandidates(content) };
}

export function deterministicFactCandidates(content: string): Array<Record<string, unknown>> {
  const structuredFacts = structuredGenreFactCandidates(content);
  if (structuredFacts.length > 0) return structuredFacts;
  const candidates: Array<Record<string, unknown>> = [];
  const chapterNumber = Number(content.match(/^第(\d+)章/u)?.[1] ?? 0);
  const storyTime = chapterNumber > 0 ? `第${chapterNumber}章` : null;
  const scenarioNames = /(?:顾野|唐梨|陆沉舟|乔麦|邵锋|罗放)/u.test(content)
    ? ['顾野', '唐梨', '陆沉舟', '乔麦', '邵锋', '罗放']
    : /(?:沈砚|许小川|苏青萝|阿九|韩烈|魏长庚)/u.test(content)
      ? ['沈砚', '许小川', '苏青萝', '阿九', '韩烈', '魏长庚']
      : [];
  const addEvidenceEntity = (subjectName: string, entityType: 'location' | 'organization' | 'item' | 'resource', relationKey: string, value: string): void => {
    const evidence = sentenceContaining(content, subjectName);
    if (evidence === null) return;
    candidates.push({
      subjectName,
      entityType,
      relationKey,
      value,
      evidenceQuote: evidence,
      evidenceLocation: chapterNumber > 0 ? `第${chapterNumber}章正文` : '当前正文',
      epistemicStatus: 'objective',
      negated: false,
      viewpointName: null,
      knowledgeSubjectName: null,
      knowledgeTimeStart: null,
      knowledgeTimeEnd: null,
      storyTimeStart: storyTime,
      storyTimeEnd: storyTime
    });
  };
  if (scenarioNames.length > 0) {
    const location = content.match(/，([^，。\n]{2,32})(?:的灵灯|还没喧闹起来)/u)?.[1]?.trim();
    if (location !== undefined && location.length > 0) {
      addEvidenceEntity(location, 'location', 'location.appears_in_chapter', `${location}是本章实际发生的场景`);
    }
    const isEsports = scenarioNames[0] === '顾野';
    const organization = (isEsports ? ['零帧', '联盟'] : ['青霄宗']).find((name) => content.includes(name));
    if (organization !== undefined) {
      addEvidenceEntity(organization, 'organization', 'organization.appears_in_chapter', `${organization}在本章正文中实际出现`);
    }
    const item = (isEsports
      ? ['合同', '设备', '账号']
      : ['残缺阵盘', '残阵盘', '阵旗', '黑账', '联合印']
    ).find((name) => content.includes(name));
    if (item !== undefined) {
      addEvidenceEntity(item, 'item', 'item.appears_in_chapter', `${item}在本章正文中实际出现`);
    }
    const resource = (isEsports
      ? ['比赛记录', '设备日志', '原始记录', '训练数据', '视野记录']
      : ['灵石', '阵图', '账页']
    ).find((name) => content.includes(name));
    if (resource !== undefined) {
      addEvidenceEntity(resource, 'resource', 'resource.appears_in_chapter', `${resource}在本章正文中实际出现`);
    }
  }
  for (const name of scenarioNames) {
    const evidence = sentenceContaining(content, name);
    if (evidence === null) continue;
    candidates.push({
      subjectName: name,
      entityType: 'character',
      relationKey: chapterNumber > 0 ? `event.chapter_${String(chapterNumber).padStart(3, '0')}` : 'event',
      value: chapterNumber > 0 ? `${name}参与了第${chapterNumber}章的行动` : `${name}参与了当前行动`,
      evidenceQuote: evidence,
      evidenceLocation: chapterNumber > 0 ? `第${chapterNumber}章正文` : '当前正文',
      epistemicStatus: 'objective',
      negated: false,
      viewpointName: null,
      knowledgeSubjectName: null,
      knowledgeTimeStart: null,
      knowledgeTimeEnd: null,
      storyTimeStart: storyTime,
      storyTimeEnd: storyTime
    });
  }
  const relationshipPairs = scenarioNames[0] === '顾野'
    ? [['顾野', '唐梨'], ['顾野', '陆沉舟'], ['顾野', '乔麦'], ['顾野', '邵锋'], ['顾野', '罗放']]
    : scenarioNames[0] === '沈砚'
      ? [['沈砚', '许小川'], ['沈砚', '苏青萝'], ['沈砚', '阿九'], ['沈砚', '韩烈'], ['沈砚', '魏长庚']]
      : [];
  for (const [from, to] of relationshipPairs) {
    const evidence = sentenceContaining(content, from!, to!);
    if (evidence === null) continue;
    const hostile = ['邵锋', '罗放', '韩烈', '魏长庚'].includes(to!);
    candidates.push({
      subjectName: from,
      entityType: 'character',
      relationKey: `relationship.${to}.${hostile ? 'rivalry' : 'cooperation'}`,
      value: to,
      evidenceQuote: evidence,
      evidenceLocation: chapterNumber > 0 ? `第${chapterNumber}章人物互动` : '当前人物互动',
      epistemicStatus: 'objective',
      negated: false,
      viewpointName: null,
      knowledgeSubjectName: null,
      knowledgeTimeStart: null,
      knowledgeTimeEnd: null,
      storyTimeStart: storyTime,
      storyTimeEnd: storyTime
    });
  }
  const possession = sentenceContaining(content, '林澈', '铜钥匙');
  if (possession !== null) candidates.push({
    subjectName: '林澈', entityType: 'character', relationKey: 'possesses:item', value: '铜钥匙',
    evidenceQuote: possession, evidenceLocation: '正文中提及铜钥匙的场景', epistemicStatus: 'objective',
    negated: false, viewpointName: null, knowledgeSubjectName: null,
    knowledgeTimeStart: null, knowledgeTimeEnd: null, storyTimeStart: null, storyTimeEnd: null
  });
  const keyRule = sentenceContaining(content, '钥匙', '开门');
  if (keyRule !== null) candidates.push({
    subjectName: '林澈', entityType: 'character', relationKey: 'believes:item_capability', value: '铜钥匙能开门并可能决定账本读取方式',
    evidenceQuote: keyRule, evidenceLocation: '正文对钥匙作用的判断', epistemicStatus: 'belief',
    negated: false, viewpointName: '林澈', knowledgeSubjectName: '林澈',
    knowledgeTimeStart: null, knowledgeTimeEnd: null, storyTimeStart: null, storyTimeEnd: null
  });
  return candidates;
}

function sentenceContaining(content: string, ...needles: string[]): string | null {
  const sentence = content.split(/(?<=[。！？])/u).find((item) => needles.every((needle) => item.includes(needle)))?.trim();
  return sentence === undefined || sentence.length === 0 ? null : sentence;
}

function parseWriterPrompt(raw: string): WriterPromptEnvelope {
  const parsed = JSON.parse(raw) as unknown;
  if (isObject(parsed) && isObject(parsed.taskInput)) {
    return {
      taskInput: parsed.taskInput as unknown as DraftPrompt | RewritePrompt,
      sources: Array.isArray(parsed.sources)
        ? parsed.sources.filter(isObject).map((source) => ({
            sourceType: typeof source.sourceType === 'string' ? source.sourceType : undefined,
            content: typeof source.content === 'string' ? source.content : undefined
          }))
        : []
    };
  }
  if (isObject(parsed)) {
    return {
      taskInput: parsed as unknown as DraftPrompt | RewritePrompt,
      sources: Array.isArray(parsed.sources)
        ? parsed.sources.filter(isObject).map((source) => ({
            sourceType: typeof source.sourceType === 'string' ? source.sourceType : undefined,
            content: typeof source.content === 'string' ? source.content : undefined
          }))
        : []
    };
  }
  return { taskInput: parsed as DraftPrompt | RewritePrompt, sources: [] };
}

function buildContextAwareNovel(bookId: string, prompt: DraftPrompt, sources: WriterContextSource[]): string {
  const context = [prompt.title, prompt.previousState ?? '', ...sources.map((source) => source.content ?? '')].join('\n');
  if (/(界域领主日志|苏砚|晨星领|领主面板|英雄属性|狼爵)/u.test(context)) {
    return buildGameLordNovel(bookId, prompt.chapterNumber, prompt.title);
  }
  if (/(斗罗星轮行|斗罗大陆|武魂觉醒战|顾星河|银羽|星轮魂师|魂力等级|镜魂祭坛)/u.test(context)) {
    return buildDouluoFanficNovel(bookId, prompt.chapterNumber, prompt.title);
  }
  if (/(灵契天墟|陆昭|霜尾|御灵剑使|灵宠状态|镜像祭坛)/u.test(context)) {
    return buildGameXianxiaNovel(bookId, prompt.chapterNumber, prompt.title);
  }
  if (/(灰烬领主|顾临川|灰烬领|领地状态|资源结算|黑旗伯)/u.test(context)) {
    return buildLordNovel(bookId, prompt.chapterNumber, prompt.title);
  }
  if (/(游戏体育|电子竞技|电竞|联赛|战队|帧率|经济曲线|零帧|总决赛)/u.test(context)) {
    return buildEsportsNovel(bookId, prompt.chapterNumber, prompt.title, context);
  }
  if (/(东方仙侠|修仙|灵根|阵法|宗门|试剑台|猎场)/u.test(context)) {
    return buildXianxiaNovel(bookId, prompt.chapterNumber, prompt.title, context);
  }
  return buildNovel(bookId, prompt.chapterNumber, prompt.title, prompt.previousState ?? '故事刚刚开始');
}

interface XianxiaChapterPlan {
  location: string;
  objective: string;
  opponent: string;
  ally: string;
  setback: string;
  insight: string;
  payoff: string;
  hook: string;
}

function buildXianxiaNovel(bookId: string, chapterNumber: number, title: string, context: string): string {
  const hero = context.includes('沈砚') ? '沈砚' : extractProfileProtagonist(context) ?? '主角';
  const xu = context.includes('许小川') ? '许小川' : '机灵同伴';
  const su = context.includes('苏青萝') ? '苏青萝' : '冷面剑修';
  const ajiu = context.includes('阿九') ? '阿九' : '神秘商贩';
  const han = context.includes('韩烈') ? '韩烈' : '外门强敌';
  const wei = context.includes('魏长庚') ? '魏长庚' : '执事';
  const plan = xianxiaPlan(chapterNumber, { hero, xu, su, ajiu, han, wei });
  const digest = createHash('sha256').update(`${bookId}:${chapterNumber}:${title}:xianxia`).digest('hex');
  const weather = ['晨雾压着石阶', '山雨敲在青瓦上', '冷风卷过试剑坪', '暮色沉进松林'][Number.parseInt(digest.slice(0, 2), 16) % 4]!;
  const paragraphs: string[] = [
    `第${chapterNumber}章 ${title}\n\n${weather}，${plan.location}的灵灯一盏盏亮起。${hero}没有跟着人群抬头，他先看地面：三道阵纹在砖缝下交错，其中一道比昨夜偏了半寸。今天真正要争的不是一句口舌，而是${plan.objective}。`,
    `${plan.opponent}没有等他准备好便先动了。对方把规矩、身份和围观者的目光一起压下来，每一步都留有退路，显然并不打算做一个只会叫嚣的蠢人。${hero}若当场硬顶，输掉的不只是脸面，还有继续追查父亲旧案的资格。`,
    `${plan.ally}也没有站在旁边等命令。对方借着整理器具或查看地形的动作绕到另一侧，把最危险的位置留给自己，只丢来一句极短的提醒。那句话并不温顺，却替${hero}补上了他视线之外的一块空白。`,
    `${hero}按住袖中的残缺阵盘。阵盘没有送来灵力，只把灵气流动中细小的不协调放大：阵眼附近有一线灰白，像被人用钝刀反复刮过。看见破绽不等于能够取胜，他仍要判断谁会在什么时候踩进那道破绽。`,
    `第一次尝试果然失败了。${plan.setback}。反震顺着手臂撞进胸口，喉间立刻涌上一股铁锈味。围观者发出压低的笑声，${hero}却借着后退的两步重新量过距离——代价已经付出，至少不能白付。`,
    `“还要继续？”${plan.opponent}问。\n\n${hero}擦掉嘴角的血，只回了一句：“你若真有把握，就不会问。”\n\n这句话不是逞强。对方越急着让他认输，越说明眼前这套安排存在必须在众目睽睽下完成的部分。`,
    `${plan.ally}听懂了他的意思，却没有完全赞同。两人用最短的几句话分清目标：一个负责把人逼向阵眼，一个负责守住退路；若局势超出判断，先保人，再保证据。合作不是无条件服从，分歧也没有被一句“相信我”轻轻抹掉。`,
    `${hero}故意露出右侧空当。${plan.opponent}果然调整脚步，却没有立刻追击，而是先封住他能借力的石柱。这个应对让${hero}心里一沉，也让他更确定对手一直在观察。胜负从来不是等人排队犯错，而是谁能迫使对方在两种坏选择中先选一个。`,
    `阵纹在他眼中重新连成一张网。${plan.insight}。父亲留下的知识并没有替他给出答案，只教他把灵力、地形和人的欲望放在同一张图上。真正可用的破绽，往往不是阵法坏了，而是操阵者相信别人不敢碰它。`,
    `${hero}改变了原先的顺序。他先让出一小步，换${plan.ally}取得主动位置；又故意放弃最显眼的收益，逼${plan.opponent}亲自来收尾。这个选择立刻带来损失：灵石碎了一角，旧伤重新裂开，退路也从两条缩成了一条。`,
    `冲突在下一息爆开。剑气擦着石面掠过，阵纹被震得一明一灭。${hero}不与更强的灵力正面对撞，而是踏进先前量好的半步空隙，让对方的力量撞上被改动过的导流纹。石屑迸起时，他仍能感觉到骨头发麻，借力从来不等于没有代价。`,
    `${plan.opponent}很快察觉不对，立即收招改向，还命人切断${plan.ally}的支援。对手的修正比预想更快，原本足以取胜的布置只剩一次机会。${hero}没有临时长出新的本领，只能把已经验证过的条件压到极限。`,
    `关键处，${plan.ally}作出了自己的选择。对方没有照搬${hero}的手势，而是根据眼前变化提前截住另一条线，承担了本不属于自己的风险。那一瞬间，几个人第一次不像临时拼起的队伍，而像真正知道彼此为什么站在这里。`,
    `${hero}抓住这半息，将残阵最后一段导向改了方向。灵光贴地横扫，没有壮观到遮天蔽日，却准确切断了${plan.opponent}最依赖的落点。${plan.payoff}。先前所有观察、受伤和让步，终于在这一刻得到可以复盘的结果。`,
    `胜负落下后，场面并没有立刻安静。有人想抢先解释，有人悄悄后退，还有人盯住地上的阵纹而不是倒下的人。${hero}记住这些反应，因为真正危险的从来不只是台前的对手，而是谁会因这次结果失去利益。`,
    `${plan.opponent}也没有因为一次受挫便失去判断。对方带走能带走的人，舍掉暴露的棋子，同时留下一个足以牵制${hero}的后手。短暂的兑现因此没有变成无代价碾压，反而把下一轮对抗推向更窄、更凶险的地方。`,
    `${hero}检查同伴伤势，又把取得的证据分成两份保管。他没有把所有人都变成自己的工具：有人要救亲人，有人要洗清旧债，有人只是不能容忍宗门继续把弱者当耗材。目标并不完全相同，但眼下仍能沿同一条因果链向前。`,
    `离开${plan.location}前，${hero}最后回头看了一眼阵眼。那里多出一道不属于本次交手的旧刻痕，与父亲残阵图上的缺口恰好相合。${plan.hook}。他把疑问压在心里，知道下一步必须主动踏进去。`
  ];
  let cursor = Number.parseInt(digest.slice(2, 4), 16) % xianxiaExpansion.length;
  while (countNovelCharacters(paragraphs.join('\n\n')) < 2_780) {
    paragraphs.splice(paragraphs.length - 1, 0,
      xianxiaExpansion[cursor % xianxiaExpansion.length]!(hero, plan.ally, plan.opponent, plan));
    cursor += 1;
  }
  return paragraphs.join('\n\n');
}

function xianxiaPlan(chapterNumber: number, names: {
  hero: string; xu: string; su: string; ajiu: string; han: string; wei: string;
}): XianxiaChapterPlan {
  const plans: XianxiaChapterPlan[] = [
    { location:'杂役院试剑台', objective:'保住妹妹的药钱并拒绝一份做过手脚的生死状', opponent:names.han, ally:names.xu, setback:'生死状上的禁制先一步锁住气机', insight:'擂台东南角的卸力纹被人反向接入杀阵', payoff:'他让第一记重剑偏开三寸，当众撕破必败的假象', hook:'生死状背面浮出父亲独有的阵师暗记' },
    { location:'杂役院药房外', objective:'追回被扣走的灵石并查清生死状从何而来', opponent:names.han, ally:names.xu, setback:'药房账册被临时换走，妹妹的药已断供', insight:'灵石箱底的阵灰与试剑台完全相同', payoff:'两人拿到一枚能指向阵库的封签', hook:'封签登记人竟在三年前已经死亡' },
    { location:'废阵修补库', objective:'在执事封库前复原父亲暗记的读取顺序', opponent:names.wei, ally:names.xu, setback:'修补阵突然反噬，许小川为护住图纸受伤', insight:'所谓废阵其实在替试剑台转移反震', payoff:'他们留下拓印并让执事无法销毁全部证据', hook:'苏青萝持剑堵住唯一出口' },
    { location:'外门问剑廊', objective:'说服苏青萝暂缓交人并验证她掌握的另一半事实', opponent:names.su, ally:names.xu, setback:'苏青萝只认剑痕证据，不接受对宗门的猜测', insight:'她剑鞘上的裂痕来自同一种逆接阵纹', payoff:'双方以一次有限合作换来半日调查时间', hook:'韩烈提前宣布三日后公开再战' },
    { location:'后山废弃阵坪', objective:'完成一套能在不提升修为的前提下借地势卸力的阵法', opponent:names.han, ally:names.su, setback:'第一次布阵烧毁最后三块灵石', insight:'苏青萝的剑路能替代一处昂贵阵眼', payoff:'两人第一次完成可复现的配合', hook:'阿九带来韩烈私换擂台阵图的消息' },
    { location:'山门坊市暗巷', objective:'从阿九手中换到阵图又不把同伴拖进无底债务', opponent:names.ajiu, ally:names.su, setback:'阿九不要灵石，只要他们在猎场替他取回一件东西', insight:'交易条件与父亲旧案指向同一座废矿', payoff:'沈砚用另一条真消息压低代价并保留拒绝权', hook:'阵图上写着魏长庚的私印编号' },
    { location:'试剑台封阵区', objective:'在公开再战前验证阵眼而不惊动操阵者', opponent:names.wei, ally:names.xu, setback:'守阵弟子临时更换巡查路线', insight:'许小川发现供能灵石的磨损方向与账面相反', payoff:'他们用假故障逼出真正维护者', hook:'维护者看见沈砚后喊出他父亲的名字' },
    { location:'外门公议坪', objective:'让证据进入公开记录，阻止魏长庚私下抹平事件', opponent:names.wei, ally:names.su, setback:'执事以证据来源非法为由反咬沈砚', insight:'苏青萝主动承认自己参与取证，迫使长老审理', payoff:'试剑台被临时封存，韩烈失去暗中改阵的机会', hook:'韩烈要求在未封存的旧台立刻决胜' },
    { location:'旧试剑台', objective:'在韩烈改变策略后守住同伴和公开证据', opponent:names.han, ally:names.su, setback:'韩烈舍弃重剑改用速度，绕开原有卸力布置', insight:'对手每次变向都依赖同一只受过伤的脚', payoff:'沈砚用连续逼位把韩烈送进唯一仍有效的阵区', hook:'魏长庚在台下启动了毁台禁制' },
    { location:'崩裂的试剑台', objective:'赢下决斗并救出被毁台阵波及的杂役弟子', opponent:names.han, ally:names.xu, setback:'救人会失去直接击败韩烈的最佳时机', insight:'同伴能替他守住证据，胜利不必由一人独占', payoff:'沈砚救人后仍借韩烈自己的剑势完成反杀，取得外门资格', hook:'外门令牌中弹出黑风猎场的灭口任务' },
    { location:'黑风猎场入口', objective:'带四人小队进入猎场并确认首旗规则是否被篡改', opponent:names.wei, ally:names.ajiu, setback:'入场后地图立刻失效，出口阵也被封死', insight:'风向与地脉显示他们被送进废矿旧区', payoff:'阿九凭自己的渠道找到未登记的补给点', hook:'补给箱里有一截父亲旧阵图' },
    { location:'赤松谷旗点', objective:'抢在围猎队前夺下第一枚阵旗并保全退路', opponent:names.han, ally:names.xu, setback:'旗点下埋着会引来妖兽的诱灵粉', insight:'诱灵粉只铺在沈砚一队的路线', payoff:'许小川反用机关把兽群引向空旗点', hook:'真正的旗被苏青萝从敌队手中夺走' },
    { location:'裂石涧', objective:'接应独自持旗的苏青萝并查出规则突变来源', opponent:names.han, ally:names.su, setback:'韩烈用救援信号逼迫两队同时暴露位置', insight:'信号符的编号属于魏长庚管辖的库房', payoff:'苏青萝不等救援，主动切断追兵绳桥', hook:'队伍因此被迫分成两路' },
    { location:'废矿北井', objective:'在分队状态下重建联络并避开魏长庚的封锁', opponent:names.wei, ally:names.ajiu, setback:'阿九隐瞒了自己来猎场寻找失踪兄长的目的', insight:'他的私心与队伍目标并非完全冲突，失踪者可能握有黑账', payoff:'沈砚给出有期限的合作条件而非强迫服从', hook:'井壁后传来被困弟子的敲击暗号' },
    { location:'坍塌矿道', objective:'救出被困弟子并决定是否放弃夺旗时机', opponent:names.wei, ally:names.xu, setback:'支撑阵只能再维持半刻，救人会耗尽阵盘', insight:'被困者知道黑账藏处，却没人能保证他可信', payoff:'众人共同承担损耗救出活口，换来可交叉验证的证词', hook:'阵盘裂开，沈砚短时间失去看破阵纹的依仗' },
    { location:'风骨岭', objective:'在失去阵盘辅助后穿过韩烈的追击线', opponent:names.han, ally:names.su, setback:'沈砚必须只靠此前学会的观察方法判断破绽', insight:'能力可以损坏，已经形成的判断习惯不会消失', payoff:'苏青萝正面牵制，沈砚用地形完成第一次无阵盘反制', hook:'韩烈交出魏长庚灭口令换取活路' },
    { location:'废矿阵眼', objective:'验证灭口令并取出黑账而不触发自毁', opponent:names.wei, ally:names.ajiu, setback:'黑账与阿九兄长被锁在不同方向，时间只够救一边', insight:'锁阵将两处灵力汇入同一阵眼，可以先改写读取顺序', payoff:'阿九自己承担危险去救兄长，沈砚与同伴取得账页', hook:'魏长庚带执法队堵住矿口' },
    { location:'废矿出口', objective:'带人证和账页突破执法队反追杀', opponent:names.wei, ally:names.xu, setback:'魏长庚公开宣称他们杀人夺旗，其他参赛者开始动摇', insight:'只有让旁观者看见规则矛盾，证据才不会被私下销毁', payoff:'许小川把账页编号刻上所有阵旗，逼更多队伍卷入见证', hook:'魏长庚启动封山大阵' },
    { location:'猎场主峰', objective:'在封山前夺得首旗并让黑账进入长老视线', opponent:names.wei, ally:names.su, setback:'阵盘只修复一半，强行借阵会伤及经脉', insight:'四名同伴分别掌握一段阵路，必须同时行动', payoff:'群像配合让封山阵反向照亮黑账位置，沈砚夺旗而不独占功劳', hook:'魏长庚抛下韩烈独自逃向旧矿深处' },
    { location:'黑风猎场祭旗台', objective:'完成事件结算、保住同伴并截住最后灭口者', opponent:names.wei, ally:names.ajiu, setback:'追击与救治伤员只能选择一个优先', insight:'真正的胜利是让证据和人都能走出猎场，而非亲手抓住每个敌人', payoff:'队伍夺得首旗、救出同门并公开黑账，魏长庚失去宗门庇护', hook:'父亲旧阵图的一角指出黑账背后还有内门长老' }
  ];
  if (chapterNumber <= plans.length) return plans[Math.max(0, chapterNumber - 1)]!;
  return longXianxiaPlan(chapterNumber, names);
}

const xianxiaExpansion: Array<(
  hero: string, ally: string, opponent: string, plan: XianxiaChapterPlan
) => string> = [
  (hero,ally)=>`${hero}没有替${ally}决定该冒什么险。他把已知条件和最坏结果说清，让同伴自己选择站位。${ally}沉默片刻后改了其中一步，证明这支队伍的配合来自各自判断，而不是所有人围着主角旋转。`,
  (hero,_ally,opponent)=>`${hero}重新检查${opponent}留下的痕迹，把亲眼所见、合理推断和仍未确认的部分分开。越是接近父亲旧案，他越不允许愿望代替证据；一个漂亮猜测若不能被下一步行动验证，就只能暂时留在纸外。`,
  (hero,ally,_opponent,plan)=>`${plan.location}的灵气仍在缓慢回流。${hero}与${ally}逐段复盘方才的变化，确认哪一处来自阵法、哪一处来自人的临时决定。这样做拖慢了离开的速度，却让下一次交手不必靠重复受伤换取答案。`,
  (hero,_ally,opponent)=>`${opponent}的后手并非凭空出现。此前被忽略的一次调度、一枚封签和一道改过的巡查令此刻连成线，说明对方也在根据${hero}的选择修正计划。对手越像真实的人，接下来的每一步就越不能侥幸。`,
  (hero,ally)=>`${ally}提出另一条更稳的路，代价是放弃眼前的兑现。${hero}没有立即否决，两人把时间、伤势和证据存活率逐项摆开，最终保留一条撤离界线。热血不是假装没有恐惧，而是知道何时值得把退路押上去。`,
  (hero,_ally,_opponent,plan)=>`${hero}把${plan.insight}记进阵图边缘，又刻意留出一块空白。那块空白提醒他：目前的解释只能支撑当前行动，不能提前替下一章、下一场战斗或更大的旧案写死答案。`
];

function extractProfileProtagonist(context: string): string | null {
  const match = context.match(/"protagonists"\s*:\s*\[\s*\{[\s\S]{0,600}?"name"\s*:\s*"([^"\\]{1,12})"/u);
  return match?.[1] ?? null;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function buildNovel(bookId: string, chapterNumber: number, title: string, previousState: string): string {
  const digest = createHash('sha256').update(`${bookId}:${chapterNumber}:${title}`).digest('hex');
  const weathers = ['细雨', '北风', '薄雾', '晚霞'];
  const sounds = ['檐铃', '脚步', '水声', '木门轻响'];
  const weather = weathers[Number.parseInt(digest.slice(0, 2), 16) % weathers.length]!;
  const sound = sounds[Number.parseInt(digest.slice(2, 4), 16) % sounds.length]!;
  const paragraphs: string[] = [];
  paragraphs.push(`第${chapterNumber}章 ${title}\n\n${weather}贴着旧城的屋脊压下来。${visiblePreviousState(previousState)}，林澈没有急着往前，他先听见${sound}从巷口传来，再看见石阶上那一道被雨水切断的泥痕。就在这时，就在这时，他把手从门环上收回，决定先弄清是谁比自己早到一步。`);
  const scenes = [
    '他沿着墙根向北，故意让鞋底踩进积水。水纹推开落叶，也照出二楼窗缝里一闪而过的灯。那不是欢迎的信号，更像有人在计算他的脚程。林澈没有抬头，只借卖伞人的铜镜看清窗后轮廓，随后把铜钥匙换到左手。',
    '巷子尽头的茶摊已经收火，桌上却留着半盏温茶。杯沿朝东，杯底压着一根断线，这是顾衡教过他的旧记号：路能走，话不能信。他摸了摸杯壁，温度尚在，说明留信的人没有走远。',
    '北塔的影子横在街面，像一把没有收鞘的刀。守门人问他来意，他只报出货栈的旧名，没有提约定。对方眼角一动，先看钥匙，再看他的袖口。这个细小次序让林澈确认，真正被等候的不是人，而是钥匙。',
    '门轴转动时没有发出声音，里面却传来纸张翻动的沙响。林澈数到第三下才跨过门槛，右脚落在干燥处，左脚仍留在雨里。他给自己保留退路，也给暗处的人留下一点误判。',
    '第一层堆着废弃账册，墨迹被潮气泡成灰团。他没有逐页翻找，而是比较书脊上的尘。最旧的那排中间少了一册，空隙边缘干净，取走时间不会超过半日。有人正在把过去改成另一种说法。',
    '楼梯上方忽然滚下一枚木珠。林澈侧身让过，木珠撞墙后裂成两半，里面没有毒针，只有一小片写着数字的薄纸。他捡起纸片，却没有立刻读，先观察裂口的新旧和滚落角度。',
    '暗处的人终于开口，声音被塔壁折成两层。对方要他交出钥匙，承诺解释顾衡的失踪。林澈听完只问了一个问题：昨夜北门落锁时，谁在钟楼值守。沉默比答案更快暴露了破绽。',
    '他把钥匙放在掌心，却没有递出去。铜齿间藏着一道极细的黑线，是早晨才沾上的煤灰；若对方真见过钥匙的旧主人，就不会忽略这个变化。林澈因此确定，眼前人掌握的是画像，不是实物。',
    '塔外的雨忽然变急，街上人声被冲散。林澈借雷声踢开侧门，风卷起账页，遮住两边视线。他没有追向逃走的人，而是按住那本被风翻开的账册，因为纸上出现了自己的名字。',
    '名字后没有金额，只有三个日期。第一个是他抵达旧城那天，第二个是今晚，第三个尚未发生。林澈盯着最后的空格，意识到这场会面并非临时安排，他的每次选择都有人提前留下位置。',
    '他撕下空白边角，把三个日期誊写一遍，再将原页放回。带走证据会惊动记账人，留下错误的证据却能迫使对方修正。于是他把第二个日期的时辰改早一刻，等下一次翻阅者暴露行踪。',
    '脚步声从下层逼近，不止一人。林澈吹灭灯，靠记忆退到窗边。黑暗让追兵失去人数优势，也让他听清其中一人呼吸里的哨音——那是北门守卫换班时才会用的节拍。',
    '他翻出窗外，没有立刻落地，而是抓住排水链悬在檐下。两名追兵从窗边探头，只看见空巷。等他们转身，他才顺着链条滑下，在泥地留出一串通往南街的假脚印。',
    '真正的路线穿过染坊后院。蓝色水汽遮住衣角，老匠人没有问话，只把一块干布推到桌边。林澈擦掉钥匙上的煤灰，发现黑线下面还有一道新刻痕，形状与账册日期旁的符号一致。',
    '这意味着钥匙不仅能开门，也可能决定账本如何被读取。他想起顾衡说过，最危险的锁从不拦人，只拦错误的理解。过去他把这句话当作训诫，现在才明白那是一条具体线索。',
    '林澈没有因此放松。线索越清楚，布置线索的人越值得怀疑。他把刻痕拓在湿布上，又将钥匙恢复原样，随后请老匠人把拓印缝进伞骨。即使他被搜身，证据也不会与人一起消失。',
    '离开染坊前，他从后门看见守门人站在街角。那人没有追来，只用指尖敲了三次伞柄。林澈认出那是继续前往北塔的暗号，却故意向相反方向走，让对方必须决定是否打破伪装。',
    '守门人果然跟了两步，又停下。这个迟疑说明他受命监视，却没有临场处置权。林澈在心里把风险重新排序：塔中的人负责设局，守门人负责确认，真正下令的人仍未露面。',
    '夜色落稳时，他回到临时住处。门缝里的细线没有断，窗台的灰也保持原状，但桌上多了一滴已经凝住的蜡。来客没有进屋，只把火贴近门板听过里面的动静。',
    '林澈坐在黑暗里，把今晚的每个声音按先后重排。木珠、雷声、脚步和守门人的敲击并非四件事，它们共同指向同一刻：有人需要他在钟响之前看到那三个日期。',
    '远处钟楼终于响起第一声。林澈撑开那把藏着拓印的伞，发现伞面内侧映出一行平时看不见的小字。字迹只有一句：不要相信第三个日期。钟声继续，他却第一次确信，顾衡仍在用某种方式参与这场局。'
  ];
  let cursor = Number.parseInt(digest.slice(4, 6), 16) % scenes.length;
  while (countNovelCharacters(paragraphs.join('\n\n')) < 2_780) {
    paragraphs.push(scenes[cursor % scenes.length]!);
    cursor += 1;
  }
  paragraphs.push('他把伞合上，没有立刻追问答案。真正的选择不是信或不信，而是赶在第三个日期到来前，找到写下日期的人。北塔的灯在雨幕后重新亮起，这一次，亮的是最高一层。');
  return paragraphs.join('\n\n');
}

function rewriteNovel(content: string, requiredActions: string[]): string {
  let rewritten = stripEmbeddedWorkflowPayload(content).replace('就在这时，就在这时，他把手从门环上收回', '转折来得很轻：他把手从门环上收回');
  if (requiredActions.some((action) => action.includes('老板拒绝'))) {
    rewritten = rewritten.replace(
      '他把伞合上，没有立刻追问答案。',
      '他把伞合上，也把先前的判断全部推倒，重新核对每一处能被证实的痕迹。'
    );
  }
  const minimum = requiredActions.some((action) => /2700至3200|2700到3200/u.test(action)) ? 2_700 : 2_500;
  for (const paragraph of deterministicRevisionExpansion) {
    if (countNovelCharacters(rewritten) >= minimum) break;
    rewritten += `\n\n${paragraph}`;
  }
  if (rewritten === content && requiredActions.length > 0) {
    rewritten = rewritten.replace('林澈没有急着往前', '林澈收回先前的判断，没有急着往前');
  }
  return rewritten;
}

const deterministicRevisionExpansion = [
  '他没有急着把推断当成答案，而是把刚才发生的事情按先后重新排开，先分清哪些是亲眼所见，哪些只是别人希望他相信的解释。环境仍在变化，他便用人物行动、现场痕迹和已经确认的规则互相校正，宁可慢一步，也不让未经证实的猜测混进下一次选择。',
  '他又从头复盘每个人当时能够知道的事情。有人看见结果，却未必知道原因；有人熟悉一部分规则，也可能只是在转述命令。把知情范围分开以后，先前显得整齐的安排露出一道缝：真正的推动者一直躲在传话人与执行者之后，从未亲自为任何一句话负责。',
  '他沿着这道缝继续推演，却没有贸然改变目标。他只把验证顺序调换过来：先确认能留下可靠证据的部分，再接触最可能隐瞒的人，最后才处理那个看似最紧迫的期限。这样一来，即使判断错了一半，他和同伴也仍有可以承担的退路。',
  '周围的声响与光线发生细微变化，短暂露出一处先前被忽略的痕迹。真正的观察者若想继续确认他们的行动，就必须重新靠近。他没有立刻回头，只让同伴守住另一侧，把等待本身变成一次能够看见结果的试探。',
  '时间一点点过去，最先变化的不是外部动静，而是他对风险的排序。眼前收益仍然重要，期限也仍然危险，但更值得警惕的是对手已经开始预判他们的选择。他提醒自己，接下来的每个决定都要保留一个不依赖侥幸的备用出口。',
  '等现场再次安静下来，他终于把零散线索压缩成一条可以验证的因果链。那条链并不完美，仍有位置留着空白，可它至少解释了谁在观察、谁在传递、谁会因结果受益。未知没有消失，却从混乱变成了能够继续追查的问题。',
  '他收好刚确认的东西，最后检查了一遍现场。他没有增添新的结论，只确认现有证据仍能支持当前选择。接下来无论出现谁，他都不会因为一句解释放弃已经验证过的事实，也不会因为一次意外把尚未证实的怀疑写成定论。'
];
function visiblePreviousState(previousState: string): string {
  const value = previousState.trim();
  if (value.startsWith('{') || /(?:"chapterNumber"|"continuityAnchors"|"sourceId"|"source_id")/u.test(value)) {
    return '上一章留下的行动后果仍在发酵';
  }
  return value.replace(/\s+/gu, ' ').slice(0, 180) || '故事刚刚开始';
}

function stripEmbeddedWorkflowPayload(content: string): string {
  let output = '';
  let cursor = 0;
  for (let start = 0; start < content.length; start += 1) {
    if (content[start] !== '{') continue;
    const end = balancedObjectEnd(content, start);
    if (end < 0) continue;
    const candidate = content.slice(start, end + 1);
    if (!/(?:"chapterNumber"|"continuityAnchors"|"sourceId"|"source_id"|"workflowArtifact")/u.test(candidate)) continue;
    output += content.slice(cursor, start) + '上一章留下的行动后果仍在发酵';
    cursor = end + 1;
    start = end;
  }
  return output + content.slice(cursor);
}

function balancedObjectEnd(content: string, start: number): number {
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = start; index < content.length; index += 1) {
    const character = content[index]!;
    if (inString) {
      if (escaped) escaped = false;
      else if (character === '\\') escaped = true;
      else if (character === '"') inString = false;
      continue;
    }
    if (character === '"') inString = true;
    else if (character === '{') depth += 1;
    else if (character === '}' && --depth === 0) return index;
  }
  return -1;
}

function result(provider: string, modelId: string, prompt: string, output: string): ModelResult {
  return {
    provider,
    modelId,
    output,
    inputTokens: Math.ceil(prompt.length / 2),
    outputTokens: Math.ceil(output.length / 2),
    cashCostCny: 0,
    state: 'succeeded'
  };
}

function assertNotAborted(signal?: AbortSignal): void {
  if (signal?.aborted === true) throw signal.reason ?? new DOMException('调用已取消', 'AbortError');
}
