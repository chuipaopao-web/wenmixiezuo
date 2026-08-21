import { bootstrapDatabase } from './infrastructure/db/bootstrap.js';
import { openDatabase } from './infrastructure/db/database.js';
import { loadRuntimeConfig } from './infrastructure/runtime-config.js';
import { createServer } from './http/server.js';
import { ModelBindingService, toCreativeProfiles } from './application/agents/model-binding-service.js';
import { PlatformModelSchemeService } from './application/agents/platform-model-scheme-service.js';
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
if (config.publicOrigin === null) {
  console.warn(JSON.stringify({
    event: 'public_origin_missing',
    reason: 'rate_limit_disabled_insecure_cookies',
    hint: '公网部署必须设置 WENMI_PUBLIC_ORIGIN（如 https://wenmixiezuo.com），否则登录/注册限流与 Secure Cookie 会静默关闭'
  }));
} else if (config.webOrigin !== config.publicOrigin) {
  console.warn(JSON.stringify({
    event: 'web_origin_mismatch',
    webOrigin: config.webOrigin,
    publicOrigin: config.publicOrigin,
    hint: 'WENMI_WEB_ORIGIN 与 WENMI_PUBLIC_ORIGIN 不一致会拒绝浏览器写入请求，请确认是否故意配置'
  }));
}
if (config.publicOrigin !== null && config.adminOrigin === null) {
  console.warn(JSON.stringify({
    event: 'admin_origin_missing',
    hint: '独立管理后台需设置 WENMI_ADMIN_ORIGIN=https://admin.wenmixiezuo.com'
  }));
}
// 管理后台保存的平台模型方案优先于环境默认；启动收敛与后台调整走同一条 reviseFuture 链路。
const platformSchemes = new PlatformModelSchemeService(database, ids, clock, config.modelRuntime.activeMode);
new ModelBindingService(database, ids, clock, config.modelRuntime.roleProfiles)
  .bindAllBooks({
    preserveActiveRevision: true,
    migrateAllMembersToCurrentPlan: true,
    creativeProfilesOverride: platformSchemes.currentProfiles(toCreativeProfiles(config.modelRuntime.roleProfiles))
  });
const app = await createServer(config, database);

const shutdown = async (): Promise<void> => {
  await app.close();
  database.close();
};
process.once('SIGINT', () => void shutdown());
process.once('SIGTERM', () => void shutdown());

await app.listen({ host: config.apiHost, port: config.apiPort });
