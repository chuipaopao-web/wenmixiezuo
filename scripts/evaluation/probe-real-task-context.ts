import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { ModelAdapterFactory } from '../../apps/api/src/infrastructure/models/model-adapter-factory.js';
import { loadModelRuntimeConfig } from '../../apps/api/src/infrastructure/models/model-runtime-config.js';
import type { CreativeRoleKey } from '../../apps/api/src/contracts/agent-team-v2.js';

const taskId = process.argv[2];
if (!taskId) throw new Error('usage: tsx scripts/evaluation/probe-real-task-context.ts <task-id>');

const database = new DatabaseSync('data/database/wenmi.sqlite', { readOnly: true });
const task = database.prepare(`
  SELECT owner_id, book_id, task_brief_json
  FROM tasks WHERE task_id = ?
`).get(taskId) as { owner_id: string; book_id: string; task_brief_json: string } | undefined;
database.close();
if (task === undefined) throw new Error(`task not found: ${taskId}`);

const brief = JSON.parse(task.task_brief_json) as { scopeText?: string };
const prompt = brief.scopeText?.trim();
if (prompt === undefined || prompt.length === 0) throw new Error('task does not contain scopeText');

const config = loadModelRuntimeConfig(process.env, { codexWorkingDirectory: process.cwd() });
if (config.activeMode !== 'subscription-plan' || !config.strictPlanOnly || config.cashFallbackAllowed) {
  throw new Error('real task context probe requires strict subscription-plan mode');
}
const factory = new ModelAdapterFactory(config);
const allProbes: Array<{ roleKey: CreativeRoleKey; modelId: string }> = [
  { roleKey: 'chief_editor', modelId: config.roleProfiles.chief_editor.modelId },
  { roleKey: 'second_screenwriter', modelId: config.roleProfiles.continuity.modelId },
  { roleKey: 'researcher', modelId: config.roleProfiles.researcher.modelId }
];
const requestedRoles = new Set((process.env.WENMI_TASK_CONTEXT_PROBE_ROLES ?? '')
  .split(',').map((value) => value.trim()).filter(Boolean));
const probes = requestedRoles.size === 0
  ? allProbes
  : allProbes.filter((probe) => requestedRoles.has(probe.roleKey));
if (probes.length === 0) throw new Error('WENMI_TASK_CONTEXT_PROBE_ROLES did not match an allowed probe role');
const maxOutputTokens = Number(process.env.WENMI_TASK_CONTEXT_PROBE_MAX_OUTPUT_TOKENS ?? '3600');
if (!Number.isInteger(maxOutputTokens) || maxOutputTokens < 256 || maxOutputTokens > 8_000) {
  throw new Error('WENMI_TASK_CONTEXT_PROBE_MAX_OUTPUT_TOKENS must be an integer from 256 to 8000');
}

for (const [index, probe] of probes.entries()) {
  const startedAt = Date.now();
  try {
    const result = await factory.resolve(
      'volcengine-ark-agent-plan', probe.modelId, 'discussion', probe.roleKey
    ).generate({
      requestId: `task-context-probe-${index + 1}`,
      taskId: `task-context-probe-${taskId}`,
      ownerId: task.owner_id,
      bookId: task.book_id,
      agentId: probe.roleKey,
      prompt,
      maxOutputTokens
    });
    process.stdout.write(`${JSON.stringify({
      roleKey: probe.roleKey,
      modelId: result.modelId,
      state: result.state,
      inputTokens: result.inputTokens,
      outputTokens: result.outputTokens,
      outputCharacters: [...result.output].length,
      outputSha256: createHash('sha256').update(result.output).digest('hex'),
      cashCostCny: result.cashCostCny,
      durationMs: Date.now() - startedAt
    })}\n`);
  } catch (error) {
    process.stdout.write(`${JSON.stringify({
      roleKey: probe.roleKey,
      modelId: probe.modelId,
      state: 'failed',
      errorName: error instanceof Error ? error.name : 'UnknownError',
      errorMessage: error instanceof Error ? error.message : String(error),
      durationMs: Date.now() - startedAt
    })}\n`);
  }
}
