import { createHash } from 'node:crypto';
import type { Clock, IdGenerator } from '../../domain/ids.js';
import type { BookScope } from '../../domain/scope.js';
import type { ContextCompressionRepository } from '../../infrastructure/db/repositories/context-compression-repository.js';
import type { UnitOfWork } from '../../infrastructure/db/unit-of-work.js';

export interface CompressionMessage { messageId: string; role: 'boss' | 'agent'; content: string; kind?: 'decision' | 'fact' | 'objection' | 'commitment' | 'ordinary' }

export class ContextCompressionService {
  public constructor(
    private readonly repository: ContextCompressionRepository, private readonly unitOfWork: UnitOfWork,
    private readonly ids: IdGenerator, private readonly clock: Clock
  ) {}
  public compress(scope: BookScope, conversationId: string, messages: CompressionMessage[], probe: (summary: Record<string, unknown>) => boolean): { snapshotId: string; activated: boolean; summary: Record<string, unknown> } {
    if (messages.length === 0) throw new Error('压缩范围不能为空');
    const previous = this.repository.active(scope, conversationId);
    const anchors = messages.filter((message) => message.role === 'boss' || ['decision', 'fact', 'objection', 'commitment'].includes(message.kind ?? 'ordinary'))
      .map((message) => ({ messageId: message.messageId, role: message.role, kind: message.kind ?? 'ordinary', content: message.content }));
    const summary = {
      previousSnapshotId: previous?.snapshotId ?? null,
      decisions: messages.filter((message) => message.kind === 'decision').map(reference),
      facts: messages.filter((message) => message.kind === 'fact').map(reference),
      objections: messages.filter((message) => message.kind === 'objection').map(reference),
      commitments: messages.filter((message) => message.kind === 'commitment').map(reference),
      recent: messages.slice(-4).map(reference)
    };
    if (!probe(summary)) return { snapshotId: previous?.snapshotId ?? '', activated: false, summary: previous?.summary ?? summary };
    const snapshotId = this.ids.next();
    const sourceText = messages.map((message) => `${message.messageId}\0${message.role}\0${message.content}`).join('\n');
    this.unitOfWork.run(() => this.repository.activate(scope, {
      snapshotId, conversationId, previousSnapshotId: previous?.snapshotId ?? null,
      startId: messages[0]!.messageId, endId: messages.at(-1)!.messageId,
      rangeHash: createHash('sha256').update(sourceText).digest('hex'), anchorsJson: JSON.stringify(anchors),
      summaryJson: JSON.stringify(summary), probesJson: JSON.stringify({ passed: true }), now: this.clock.now().toISOString()
    }));
    return { snapshotId, activated: true, summary };
  }
}
function reference(message: CompressionMessage): Record<string, unknown> { return { messageId: message.messageId, content: message.content }; }
