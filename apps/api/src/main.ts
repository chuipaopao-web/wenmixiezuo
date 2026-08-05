import { bootstrapDatabase } from './infrastructure/db/bootstrap.js';
import { openDatabase } from './infrastructure/db/database.js';
import { loadRuntimeConfig } from './infrastructure/runtime-config.js';
import { createServer } from './http/server.js';
import { ModelBindingService } from './application/agents/model-binding-service.js';
import { SystemClock, UuidGenerator } from './domain/ids.js';
import { ChapterStateRecoveryService } from './application/creation/chapter-state-recovery-service.js';
import { AgentGovernanceRepository } from './infrastructure/db/repositories/agent-governance-repository.js';
import { LegacyBookUpgradeRepository } from './infrastructure/db/repositories/legacy-book-upgrade-repository.js';
import { PromptTemplateRepository } from './infrastructure/db/repositories/prompt-template-repository.js';
import { UnitOfWork } from './infrastructure/db/unit-of-work.js';
import { TeamTemplateService } from './application/agents/team-template-service.js';
import { PromptCompiler } from './application/agents/prompt-compiler.js';
import { LegacyBookUpgradeService } from './application/agents/legacy-book-upgrade-service.js';

const config = loadRuntimeConfig();
const database = openDatabase(config.databasePath);
bootstrapDatabase(database, config);
const clock = new SystemClock();
const ids = new UuidGenerator();
const unitOfWork = new UnitOfWork(database);
new ChapterStateRecoveryService(database, clock).reconcileAllCancelledShells();
const legacyUpgrade = new LegacyBookUpgradeService(
  new LegacyBookUpgradeRepository(database),
  new TeamTemplateService(new AgentGovernanceRepository(database), unitOfWork, ids, clock),
  new PromptCompiler(new PromptTemplateRepository(database), ids, clock),
  unitOfWork, ids, clock, config.modelRuntime.roleProfiles
).upgradeAll();
if (legacyUpgrade.deferredBooks > 0) {
  console.warn(JSON.stringify({
    event: 'legacy_team_upgrade_deferred',
    deferredBooks: legacyUpgrade.deferredBooks,
    reason: 'nonterminal_tasks'
  }));
}
new ModelBindingService(database, ids, clock, config.modelRuntime.roleProfiles)
  .bindAllBooks({ preserveActiveRevision: true, migrateAllMembersToAgentPlan: true });
const app = await createServer(config, database);

const shutdown = async (): Promise<void> => {
  await app.close();
  database.close();
};
process.once('SIGINT', () => void shutdown());
process.once('SIGTERM', () => void shutdown());

await app.listen({ host: config.apiHost, port: config.apiPort });
