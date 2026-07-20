import { createHash } from 'node:crypto';
import type { ModelAdapter, ModelRequest, ModelResult } from './model-adapter.js';
import type { ReviewerRole } from '../../contracts/production-review.js';

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

export class DeterministicNovelWriterAdapter implements ModelAdapter {
  public readonly provider = 'local-deterministic-writer';
  public readonly modelId = 'wenmi-novel-writer-v1';

  public async generate(request: ModelRequest, signal?: AbortSignal): Promise<ModelResult> {
    assertNotAborted(signal);
    const prompt = JSON.parse(request.prompt) as DraftPrompt | RewritePrompt;
    const output = prompt.operation === 'rewrite'
      ? rewriteNovel(prompt.content, prompt.requiredActions)
      : buildNovel(request.bookId, prompt.chapterNumber, prompt.title, prompt.previousState ?? '故事刚刚开始');
    return result(this.provider, this.modelId, request.prompt, output);
  }
}

export class DeterministicNovelCandidateBAdapter implements ModelAdapter {
  public readonly provider = 'local-deterministic-candidate-b';
  public readonly modelId = 'wenmi-novel-candidate-b-v1';

  public async generate(request: ModelRequest, signal?: AbortSignal): Promise<ModelResult> {
    assertNotAborted(signal);
    const prompt = JSON.parse(request.prompt) as DraftPrompt | RewritePrompt;
    const output = prompt.operation === 'rewrite'
      ? rewriteNovel(prompt.content, prompt.requiredActions).replaceAll('他', '林澈')
      : buildNovel(request.bookId, prompt.chapterNumber, `${prompt.title}·备选`, prompt.previousState ?? '故事刚刚开始').replaceAll('他', '林澈');
    return result(this.provider, this.modelId, request.prompt, output);
  }
}

export class DeterministicNovelReviewerAdapter implements ModelAdapter {
  public readonly provider = 'local-deterministic-reviewer';
  public readonly modelId = 'wenmi-novel-reviewer-v1';

  public async generate(request: ModelRequest, signal?: AbortSignal): Promise<ModelResult> {
    assertNotAborted(signal);
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
  const characterCount = countNovelCharacters(content);
  if (characterCount < 2_500 || characterCount > 3_500) {
    issues.push({
      location: '全文', issueType: 'length_contract', severity: 'blocker',
      evidence: `正文有效字符${characterCount}`, requiredAction: '将正文调整到2500至3500字'
    });
  }
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

function deterministicFactCandidates(content: string): Array<Record<string, unknown>> {
  const candidates: Array<Record<string, unknown>> = [];
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

function buildNovel(bookId: string, chapterNumber: number, title: string, previousState: string): string {
  const digest = createHash('sha256').update(`${bookId}:${chapterNumber}:${title}`).digest('hex');
  const weathers = ['细雨', '北风', '薄雾', '晚霞'];
  const sounds = ['檐铃', '脚步', '水声', '木门轻响'];
  const weather = weathers[Number.parseInt(digest.slice(0, 2), 16) % weathers.length]!;
  const sound = sounds[Number.parseInt(digest.slice(2, 4), 16) % sounds.length]!;
  const paragraphs: string[] = [];
  paragraphs.push(`第${chapterNumber}章 ${title}\n\n${weather}贴着旧城的屋脊压下来。${previousState}，林澈没有急着往前，他先听见${sound}从巷口传来，再看见石阶上那一道被雨水切断的泥痕。就在这时，就在这时，他把手从门环上收回，决定先弄清是谁比自己早到一步。`);
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
  let rewritten = content.replace('就在这时，就在这时，他把手从门环上收回', '转折来得很轻：他把手从门环上收回');
  if (requiredActions.some((action) => action.includes('老板拒绝'))) {
    rewritten = rewritten.replace('他没有立刻追问答案。', '他把先前的判断全部推倒，重新核对每一处能被证实的痕迹。');
  }
  if (requiredActions.some((action) => action.includes('2500至3500')) && countNovelCharacters(rewritten) < 2_500) {
    rewritten += '\n\n林澈重新核对了每一道痕迹，直到行动、证据和判断能够彼此印证。';
  }
  if (rewritten === content && requiredActions.length > 0) {
    rewritten = rewritten.replace('林澈没有急着往前', '林澈收回先前的判断，没有急着往前');
  }
  return rewritten;
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
