import { afterEach, describe, expect, it } from 'vitest';
import { BookOnboardingService } from '../../../apps/api/src/application/books/book-onboarding-service.js';
import { AgentTeamService } from '../../../apps/api/src/application/agents/agent-team-service.js';
import { PositioningService } from '../../../apps/api/src/application/books/positioning-service.js';
import { loadModelRuntimeConfig } from '../../../apps/api/src/infrastructure/models/model-runtime-config.js';
import { createTestContext, FixedClock, SequenceIds, type TestContext } from '../../helpers/test-context.js';

describe('subscription onboarding model allocation', () => {
  let context: TestContext | undefined;

  afterEach(() => {
    context?.close();
    context = undefined;
  });

  it('creates the eleven-member team with only valid Agent Plan role bindings', () => {
    context = createTestContext();
    const ids = new SequenceIds();
    const clock = new FixedClock();
    const runtime = loadModelRuntimeConfig({
      WENMI_MODEL_MODE: 'subscription-plan',
      WENMI_ARK_AGENT_PLAN_API_KEY: 'agent-plan-test-key'
    });
    const draft = new PositioningService(context.database, ids, clock).createDraft(
      { ownerId: context.config.ownerId },
      { title: 'AgentPlan开书测试', text: 'A grounded contemporary character story.' }
    );

    const result = new BookOnboardingService(
      context.database,
      ids,
      clock,
      runtime.roleProfiles,
      context.config.releaseId
    ).confirmDraft({ ownerId: context.config.ownerId }, draft.draftId, draft.version);

    const byRole = new Map(
      new AgentTeamService(context.database, ids, clock)
        .list({ ownerId: context.config.ownerId, bookId: result.bookId })
        .map((member) => [String(member.roleKey), member.modelId])
    );

    expect(byRole.size).toBe(11);
    expect(Object.fromEntries(byRole)).toMatchObject({
      chief_editor: 'kimi-k2.7-code',
      deputy_editor: 'glm-5.2',
      lead_screenwriter: 'deepseek-v4-pro',
      second_screenwriter: 'glm-5.2',
      setting: 'glm-5.2',
      lead_writer: 'deepseek-v4-pro',
      backup_writer: 'kimi-k2.7-code',
      literary_reviewer: 'minimax-m3',
      experience_reviewer: 'doubao-seed-2.1-turbo',
      researcher: 'deepseek-v4-flash',
      copyright: 'kimi-k2.7-code'
    });
  });
});
