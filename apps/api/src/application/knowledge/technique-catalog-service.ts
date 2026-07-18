import type { Clock, IdGenerator } from '../../domain/ids.js';
import type { TechniqueCardRepository } from '../../infrastructure/db/repositories/technique-card-repository.js';

const CORE_TECHNIQUES = [
  { key: 'conflict-escalation', name: '冲突升级', goals: ['提高场景压力'], methods: ['代价递增', '选择收窄'], risks: ['为冲突而冲突'], counterexamples: ['无因升级'] },
  { key: 'emotional-closeup', name: '情绪近景', goals: ['呈现人物细微变化'], methods: ['身体反应', '含蓄动作'], risks: ['解释过量'], counterexamples: ['逐句标注情绪'] },
  { key: 'action-clarity', name: '动作清晰度', goals: ['保持战斗空间可理解'], methods: ['目标锚点', '动作因果'], risks: ['流水账'], counterexamples: ['招式清单'] },
  { key: 'dialogue-subtext', name: '对白潜台词', goals: ['让关系和意图同时推进'], methods: ['回避', '答非所问'], risks: ['人人谜语'], counterexamples: ['所有角色同一种机锋'] },
  { key: 'reveal-control', name: '信息揭示', goals: ['控制悬念与认知差'], methods: ['证据递进', '局部兑现'], risks: ['强行隐瞒'], counterexamples: ['角色无理由不说'] },
  { key: 'scene-rhythm', name: '场景节奏', goals: ['匹配当前剧情功能'], methods: ['长短句变化', '段落呼吸'], risks: ['机械套节拍'], counterexamples: ['固定三段式'] }
] as const;

export class TechniqueCatalogService {
  public constructor(
    private readonly repository: TechniqueCardRepository,
    private readonly ids: IdGenerator,
    private readonly clock: Clock
  ) {}

  public seedAbstractCatalog(): number {
    const now = this.clock.now().toISOString();
    return CORE_TECHNIQUES.filter((card) => this.repository.insertIfMissing({
      cardId: this.ids.next(), key: card.key, displayName: card.name,
      goalsJson: JSON.stringify(card.goals), methodsJson: JSON.stringify(card.methods),
      risksJson: JSON.stringify(card.risks), counterexamplesJson: JSON.stringify(card.counterexamples),
      mechanizationWarning: '仅作为场景级软建议；不得覆盖人物声音、正史事实或主笔自由创作区。',
      applicabilityJson: JSON.stringify({ selection: 'per_scene', mandatory: false }), now
    })).length;
  }

  public list(): Array<Record<string, unknown>> {
    return this.repository.listActive().map((row) => ({
      ...row,
      narrative_goals: JSON.parse(row.narrative_goals_json as string) as unknown,
      optional_methods: JSON.parse(row.optional_methods_json as string) as unknown,
      risks: JSON.parse(row.risks_json as string) as unknown,
      counterexamples: JSON.parse(row.counterexamples_json as string) as unknown,
      applicability: JSON.parse(row.applicability_json as string) as unknown
    }));
  }
}
