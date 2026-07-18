import { createHash } from 'node:crypto';
import type { LocalUtilityCandidate, LocalUtilityModel, LocalUtilityRequest } from '../contracts/local-utility-model.js';

export class DeterministicLocalUtilityModel implements LocalUtilityModel {
  public readonly available = true;
  public readonly modelSnapshotId = 'deterministic-local-utility-v1';
  public readonly degradationReason = null;

  public async infer(request: LocalUtilityRequest): Promise<LocalUtilityCandidate> {
    const text = request.text.trim();
    if (text.length === 0) throw new Error('本地工具输入不能为空');
    const values = request.task === 'intent_classification'
      ? { intent: classifyIntent(text) }
      : request.task === 'entity_candidates'
        ? { entities: (request.allowedEntityNames ?? []).filter((name) => text.includes(name)) }
        : request.task === 'negation_detection'
          ? { negated: /不|没|未|从未|并非/u.test(text) }
          : { extractiveLines: text.split(/(?<=[。！？!?])/u).map((line) => line.trim()).filter(Boolean).slice(0, 3) };
    return {
      schemaVersion: 1, task: request.task, confidence: 1, values,
      sourceTextHash: createHash('sha256').update(request.text).digest('hex'), modelSnapshotId: this.modelSnapshotId
    };
  }
}

function classifyIntent(text: string): string {
  if (/讨论.*剧情|剧情.*讨论/u.test(text)) return 'plot_discussion';
  if (/写.*章|开始写/u.test(text)) return 'chapter_request';
  if (/取消.*任务/u.test(text)) return 'cancel_task';
  if (/设置|字体|颜色/u.test(text)) return 'settings';
  return 'general_chat';
}
