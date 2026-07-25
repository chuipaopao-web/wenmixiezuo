import { createHash } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import type { CreativeBlackboard, CreativeBlackboardRevision, CreativeSessionRecord } from '../../contracts/creative-session.js';
import type { Clock, IdGenerator } from '../../domain/ids.js';
import type { BookScope } from '../../domain/scope.js';
import { CreativeSessionRepository } from '../../infrastructure/db/repositories/creative-session-repository.js';

export interface CreativeSessionIntake {
  session: CreativeSessionRecord;
  blackboard: CreativeBlackboardRevision;
  created: boolean;
}

export class CreativeSessionService {
  private readonly repository: CreativeSessionRepository;

  public constructor(
    database: DatabaseSync,
    private readonly ids: IdGenerator,
    private readonly clock: Clock
  ) {
    this.repository = new CreativeSessionRepository(database);
  }

  public receiveOwnerMessage(scope: BookScope, input: {
    conversationId: string;
    messageId: string;
    content: string;
  }): CreativeSessionIntake {
    const canonRevision = this.repository.bookCanonRevision(scope);
    const now = this.clock.now().toISOString();
    let session = this.repository.active(scope);
    const created = session === null;
    if (session === null) {
      session = this.repository.create(scope, {
        sessionId: this.ids.next(),
        conversationId: input.conversationId,
        topic: input.content,
        openedByMessageId: input.messageId,
        canonRevision,
        now
      });
    } else {
      if (session.status === 'paused') {
        session = this.repository.updateStatus(scope, {
          sessionId: session.sessionId,
          expectedStatus: 'paused',
          status: resumedStatus(this.repository.blackboard(scope, session.sessionId)?.payload ?? null),
          now
        });
        this.repository.appendEvent(scope, {
          eventId: this.ids.next(),
          sessionId: session.sessionId,
          eventType: 'status_changed',
          sourceMessageId: input.messageId,
          payload: { from: 'paused', to: session.status, reason: 'owner_message_received' },
          now
        });
      }
      if (session.canonRevision !== canonRevision) {
        const existingBoard = this.repository.blackboard(scope, session.sessionId);
        if (existingBoard !== null) {
          this.repository.markForecastsStale(scope, {
            sessionId: session.sessionId,
            canonRevision,
            blackboardRevision: existingBoard.revision,
            sourceFingerprint: existingBoard.sourceFingerprint,
            reason: 'canon_revision_changed',
            now
          });
        }
        session = this.repository.updateStatus(scope, {
          sessionId: session.sessionId,
          expectedStatus: session.status,
          status: session.status,
          canonRevision,
          now
        });
      }
    }

    this.repository.appendEvent(scope, {
      eventId: this.ids.next(),
      sessionId: session.sessionId,
      eventType: 'owner_message',
      sourceMessageId: input.messageId,
      payload: { messageId: input.messageId, content: input.content },
      now
    });
    const previous = this.repository.blackboard(scope, session.sessionId);
    const payload = nextBlackboard(previous?.payload ?? null, input.content);
    const sourceFingerprint = createHash('sha256').update(JSON.stringify({
      sessionId: session.sessionId,
      canonRevision,
      previousContentHash: previous?.contentHash ?? null,
      messageId: input.messageId,
      content: input.content
    })).digest('hex');
    const blackboard = this.repository.appendBlackboard(scope, {
      sessionId: session.sessionId,
      expectedRevision: session.currentBlackboardRevision,
      payload,
      sourceFingerprint,
      createdBy: 'workflow',
      now,
      revisionId: this.ids.next()
    });
    return { session: this.repository.require(scope, session.sessionId), blackboard, created };
  }

  public pauseActive(scope: BookScope, sourceMessageId: string): CreativeSessionRecord | null {
    const session = this.repository.active(scope);
    if (session === null || session.status === 'paused') return session;
    const now = this.clock.now().toISOString();
    const paused = this.repository.updateStatus(scope, {
      sessionId: session.sessionId,
      expectedStatus: session.status,
      status: 'paused',
      now
    });
    this.repository.appendEvent(scope, {
      eventId: this.ids.next(),
      sessionId: session.sessionId,
      eventType: 'action',
      sourceMessageId,
      payload: { action: 'pause_session', from: session.status },
      now
    });
    return paused;
  }

  public resumeActive(scope: BookScope, sourceMessageId: string): CreativeSessionRecord | null {
    const session = this.repository.active(scope);
    if (session === null || session.status !== 'paused') return session;
    const now = this.clock.now().toISOString();
    const resumed = this.repository.updateStatus(scope, {
      sessionId: session.sessionId,
      expectedStatus: 'paused',
      status: resumedStatus(this.repository.blackboard(scope, session.sessionId)?.payload ?? null),
      now
    });
    this.repository.appendEvent(scope, {
      eventId: this.ids.next(),
      sessionId: session.sessionId,
      eventType: 'action',
      sourceMessageId,
      payload: { action: 'resume_session', to: resumed.status },
      now
    });
    return resumed;
  }

  public appendEditorReply(scope: BookScope, input: {
    sessionId: string;
    messageId: string;
    content: string;
  }): CreativeBlackboardRevision {
    const session = this.repository.require(scope, input.sessionId);
    const previous = this.repository.blackboard(scope, input.sessionId);
    if (previous === null) throw new Error('创作会话缺少黑板');
    const payload: CreativeBlackboard = {
      ...previous.payload,
      candidates: mergeUnique(
        previous.payload.candidates,
        [{ sourceMessageId: input.messageId, content: clipText(input.content, 1_200) }],
        8
      ),
      maturity: previous.payload.maturity === 'exploring' ? 'comparing' : previous.payload.maturity,
      nextStep: '继续讨论、要求重大改向，或在方向明确后锁定当前方向'
    };
    const sourceFingerprint = createHash('sha256').update(JSON.stringify({
      sessionId: input.sessionId,
      canonRevision: session.canonRevision,
      previousContentHash: previous.contentHash,
      replyMessageId: input.messageId,
      content: input.content
    })).digest('hex');
    const now = this.clock.now().toISOString();
    const revision = this.repository.appendBlackboard(scope, {
      sessionId: input.sessionId,
      expectedRevision: previous.revision,
      payload,
      sourceFingerprint,
      createdBy: 'chief_editor',
      now,
      revisionId: this.ids.next()
    });
    this.repository.appendEvent(scope, {
      eventId: this.ids.next(),
      sessionId: input.sessionId,
      eventType: 'editor_reply',
      sourceMessageId: input.messageId,
      payload: { messageId: input.messageId },
      now
    });
    return revision;
  }

  public lockDirection(scope: BookScope, input: {
    sessionId: string;
    decisionId: string;
    summary: string;
    sourceMessageId: string;
  }): CreativeBlackboardRevision {
    const session = this.repository.require(scope, input.sessionId);
    if (!['exploring', 'awaiting_direction'].includes(session.status)) {
      throw new Error('当前创作会话不在可锁定方向的阶段');
    }
    const previous = this.repository.blackboard(scope, input.sessionId);
    if (previous === null) throw new Error('创作会话缺少可锁定的黑板修订');
    const payload: CreativeBlackboard = {
      ...previous.payload,
      lockedDirection: { decisionId: input.decisionId, summary: input.summary },
      maturity: 'planning',
      nextStep: '由双编剧在锁定方向上独立估算故事弧跨度，再由主编只细化未来1至3章'
    };
    const sourceFingerprint = createHash('sha256').update(JSON.stringify({
      sessionId: input.sessionId,
      canonRevision: session.canonRevision,
      previousContentHash: previous.contentHash,
      decisionId: input.decisionId,
      summary: input.summary
    })).digest('hex');
    const now = this.clock.now().toISOString();
    const revision = this.repository.appendBlackboard(scope, {
      sessionId: input.sessionId,
      expectedRevision: previous.revision,
      payload,
      sourceFingerprint,
      createdBy: 'boss_action',
      now,
      revisionId: this.ids.next()
    });
    this.repository.updateStatus(scope, {
      sessionId: input.sessionId,
      expectedStatus: session.status,
      status: 'planning',
      lockedDecisionId: input.decisionId,
      now
    });
    this.repository.appendEvent(scope, {
      eventId: this.ids.next(),
      sessionId: input.sessionId,
      eventType: 'direction_locked',
      sourceMessageId: input.sourceMessageId,
      payload: { decisionId: input.decisionId, blackboardRevision: revision.revision },
      now
    });
    return revision;
  }
}

function nextBlackboard(previous: CreativeBlackboard | null, content: string): CreativeBlackboard {
  if (previous === null) {
    return {
      ownerMessages: [clipText(content, 1_200)],
      currentGoal: clipText(content, 1_200),
      confirmedFacts: [],
      candidates: [],
      disagreements: [],
      risks: [],
      unknowns: [],
      evidence: [],
      maturity: 'exploring',
      nextStep: '两名异模型编剧独立推演'
    };
  }
  return {
    ...previous,
    ownerMessages: [...previous.ownerMessages, clipText(content, 1_200)].slice(-8),
    currentGoal: clipText(content, 1_200),
    maturity: previous.maturity === 'ready' ? 'comparing' : previous.maturity,
    nextStep: '主编结合当前会话继续追问或比较方案'
  };
}

function mergeUnique(values: unknown[], additions: unknown[], limit = 12): unknown[] {
  const seen = new Set(values.map((value) => JSON.stringify(value)));
  const result = [...values];
  for (const addition of additions) {
    const key = JSON.stringify(addition);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(addition);
  }
  return result.slice(-limit);
}

function clipText(value: string, maximum: number): string {
  if (value.length <= maximum) return value;
  return `${value.slice(0, maximum - 16)}……（原文见会话事件）`;
}

function resumedStatus(blackboard: CreativeBlackboard | null): CreativeSessionRecord['status'] {
  if (blackboard?.maturity === 'ready') return 'ready';
  if (blackboard?.maturity === 'planning') return 'planning';
  if (blackboard?.maturity === 'direction_ready') return 'awaiting_direction';
  return 'exploring';
}
