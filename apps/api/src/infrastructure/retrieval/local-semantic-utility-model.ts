import { createHash } from 'node:crypto';
import type { LocalUtilityCandidate, LocalUtilityModel, LocalUtilityRequest } from '../../application/local-assistant/local-utility-model.js';
import type { EmbeddingAdapter } from './embedding-adapter.js';

const INTENT_PROTOTYPES = {
  plot_discussion: ['我们讨论下一段剧情走向', '一起推演角色接下来该怎么行动', '分析这场冲突后面如何发展'],
  chapter_request: ['开始写下一章正文', '继续创作下一回内容', '资料齐了请主笔动笔'],
  task_status: ['查看当前任务进度', '现在成员正在做什么', '打开任务详情'],
  settings: ['调整字体大小和背景颜色', '修改界面显示设置', '切换阅读主题'],
  general_chat: ['你好，我想随便聊聊', '帮我看看现在的资料', '我有一个普通问题']
} as const;

export class LocalSemanticUtilityModel implements LocalUtilityModel {
  public readonly available: boolean;
  public readonly degradationReason: string | null;
  public readonly modelSnapshotId: string;
  #prototypeVectors: Promise<Record<string, number[]>> | null = null;

  public constructor(private readonly embedding: EmbeddingAdapter) {
    this.available = embedding.available;
    this.degradationReason = embedding.degradationReason;
    this.modelSnapshotId = `${embedding.modelSnapshotId}:semantic-utility-v1`;
  }

  public async infer(request: LocalUtilityRequest): Promise<LocalUtilityCandidate> {
    const text = request.text.trim();
    if (text.length === 0) throw new Error('LOCAL_UTILITY_INPUT_EMPTY');
    if (!this.available) throw new Error(this.degradationReason ?? 'LOCAL_UTILITY_MODEL_UNAVAILABLE');
    const values: Record<string, unknown> = request.task === 'intent_classification'
      ? await this.classifyIntent(text)
      : request.task === 'entity_candidates'
        ? { entities: (request.allowedEntityNames ?? []).filter((name) => text.includes(name)) }
        : request.task === 'negation_detection'
          ? { negated: /不|没|未|从未|并非|无意/u.test(text) }
          : await this.compress(text);
    const confidence = typeof values.confidence === 'number' ? values.confidence : 1;
    const { confidence: _removed, ...publicValues } = values;
    return {
      schemaVersion: 1, task: request.task, confidence, values: publicValues,
      sourceTextHash: createHash('sha256').update(request.text).digest('hex'), modelSnapshotId: this.modelSnapshotId
    };
  }

  private async classifyIntent(text: string): Promise<Record<string, unknown> & { confidence: number }> {
    const query = await this.embedding.embedQuery(text);
    const prototypes = await (this.#prototypeVectors ??= this.buildPrototypes());
    const scores = Object.entries(prototypes).map(([intent, vector]) => ({ intent, score: dot(query, vector) }))
      .sort((left, right) => right.score - left.score || left.intent.localeCompare(right.intent));
    const top = scores[0]!;
    const margin = top.score - (scores[1]?.score ?? 0);
    // 该值是经归一化嵌入的相似度置信，不是统计概率；最终路由还必须同时检查领先间隔。
    const confidence = clamp(top.score);
    return { intent: top.intent, confidence, similarity: Number(top.score.toFixed(6)), margin: Number(margin.toFixed(6)) };
  }

  private async buildPrototypes(): Promise<Record<string, number[]>> {
    const result: Record<string, number[]> = {};
    for (const [intent, examples] of Object.entries(INTENT_PROTOTYPES)) {
      const vectors = await this.embedding.embedDocuments([...examples]);
      result[intent] = normalize(mean(vectors));
    }
    return result;
  }

  private async compress(text: string): Promise<Record<string, unknown> & { confidence: number }> {
    const sentences = text.split(/(?<=[。！？!?])/u).map((sentence) => sentence.trim()).filter(Boolean).slice(0, 80);
    if (sentences.length <= 3) return { extractiveLines: sentences, confidence: 1 };
    const [query, vectors] = await Promise.all([this.embedding.embedQuery(text), this.embedding.embedDocuments(sentences)]);
    const ranked = sentences.map((sentence, index) => ({ sentence, index, score: dot(query, vectors[index]!) }))
      .sort((left, right) => right.score - left.score || left.index - right.index).slice(0, 3)
      .sort((left, right) => left.index - right.index);
    return { extractiveLines: ranked.map((item) => item.sentence), sourceSentenceIndexes: ranked.map((item) => item.index), confidence: 0.75 };
  }
}

function dot(left: number[], right: number[]): number { return left.reduce((sum, value, index) => sum + value * right[index]!, 0); }
function mean(vectors: number[][]): number[] {
  return vectors[0]!.map((_, index) => vectors.reduce((sum, vector) => sum + vector[index]!, 0) / vectors.length);
}
function normalize(vector: number[]): number[] {
  const norm = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0)) || 1;
  return vector.map((value) => value / norm);
}
function clamp(value: number): number { return Math.max(0, Math.min(1, value)); }
