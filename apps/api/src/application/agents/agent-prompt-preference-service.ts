import { DomainError, errorCodes } from '../../domain/errors.js';
import type { Clock, IdGenerator } from '../../domain/ids.js';
import { assertBookScope, type BookScope } from '../../domain/scope.js';
import {
  AgentPromptPreferenceRepository,
  type AgentPromptPreferenceRow
} from '../../infrastructure/db/repositories/agent-prompt-preference-repository.js';

export interface AgentPromptPreference {
  promptPreferenceId: string | null;
  agentId: string;
  version: number;
  content: string;
  createdAt: string | null;
}

export class AgentPromptPreferenceService {
  public constructor(
    private readonly repository: AgentPromptPreferenceRepository,
    private readonly ids: IdGenerator,
    private readonly clock: Clock
  ) {}

  public list(scope: BookScope): AgentPromptPreference[] {
    assertBookScope(scope);
    return this.repository.listAgentIds(scope).map((agentId) => this.active(scope, agentId));
  }

  public active(scope: BookScope, agentId: string): AgentPromptPreference {
    this.assertAgent(scope, agentId);
    const row = this.repository.active(scope, agentId);
    return row === null
      ? { promptPreferenceId: null, agentId, version: 0, content: '', createdAt: null }
      : this.view(row);
  }

  public revise(scope: BookScope, agentId: string, expectedVersion: number, content: string): AgentPromptPreference {
    assertBookScope(scope);
    this.assertAgent(scope, agentId);
    const normalized = content.replaceAll('\r\n', '\n').trim();
    if (normalized.length > 4000) {
      throw new DomainError(errorCodes.validation, '岗位补充提示词最多4000个字符', {}, false, 400);
    }
    const current = this.active(scope, agentId);
    if (current.version !== expectedVersion) {
      throw new DomainError(errorCodes.bookVersionConflict, '提示词已被更新，请刷新后再保存', {
        expectedVersion, actualVersion: current.version
      }, false, 409);
    }
    if (current.content === normalized) return current;
    const id = this.ids.next();
    const version = current.version + 1;
    const now = this.clock.now().toISOString();
    this.repository.insertRevision(scope, { id, agentId, version, content: normalized, now });
    return this.active(scope, agentId);
  }

  private assertAgent(scope: BookScope, agentId: string): void {
    if (!this.repository.agentExists(scope, agentId)) {
      throw new DomainError(errorCodes.validation, '成员不存在或不属于当前书籍', {}, false, 404);
    }
  }

  private view(row: AgentPromptPreferenceRow): AgentPromptPreference {
    return {
      promptPreferenceId: row.prompt_preference_id,
      agentId: row.agent_id,
      version: row.version,
      content: row.content,
      createdAt: row.created_at
    };
  }
}
