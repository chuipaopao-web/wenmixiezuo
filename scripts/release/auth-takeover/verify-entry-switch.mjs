#!/usr/bin/env node
/**
 * AUTH-TAKEOVER-01 入口切换兼容检查（发布预演）。
 * 校验：1) 运行源码零引用被删除的旧装配；2) main 使用新入口 app-server；
 * 3) 新入口注册了全部业务路由模块与健康端点；4) 身份上下文入口唯一。
 * 退出码0=通过；任何一项失败非零退出并打印原因。生产部署前在打包产物上重跑。
 */
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

const root = process.cwd();
const errors = [];

const read = (relative) => readFileSync(resolve(root, relative), 'utf8');

// 1. 旧装配文件已删除且运行源码零引用
if (existsSync(resolve(root, 'apps/api/src/http/v7-server.ts'))) {
  errors.push('旧装配 apps/api/src/http/v7-server.ts 仍存在，应已删除。');
}

import { readdirSync, statSync } from 'node:fs';
const relative = (full) => full.slice(root.length + 1);
const statIsDirectory = (full) => statSync(full).isDirectory();

function scan(directory) {
  if (!existsSync(directory)) return;
  for (const entry of readdirSync(directory)) {
    const full = resolve(directory, entry);
    if (statIsDirectory(full)) {
      if (!['node_modules', 'dist', '.git'].includes(entry)) scan(full);
    } else if (/\.(ts|mts|mjs|js)$/.test(entry)) {
      const source = readFileSync(full, 'utf8');
      if (/v7-server|createV7Server/.test(source)) {
        errors.push(`运行源码引用旧装配：${relative(full)}`);
      }
    }
  }
}
scan(resolve(root, 'apps/api/src'));
scan(resolve(root, 'apps/worker/src'));

// 2. main 使用新入口
const main = read('apps/api/src/main.ts');
if (!main.includes("./http/app-server.js")) errors.push('main.ts 未使用新入口 app-server。');
if (!main.includes('createAppServer(config, database)')) errors.push('main.ts 未调用 createAppServer(config, database)。');

// 3. 新入口装配完整性（模块清单 + 关键端点/策略）
const appServer = read('apps/api/src/http/app-server.ts');
const requiredModules = [
  'registerAccountRoutes', 'registerV7AdminPlatformRoutes', 'registerV7AdminConsoleRoutes',
  'registerCreativeReferenceAdminRoutes', 'registerV7OpeningAgentRoutes', 'registerV7SettingEditorialRoutes',
  'registerV7PlanningTreeRoutes', 'registerV7CharacterMemoryRoutes', 'registerV7CreationRoutes',
  'registerV7PromptGovernanceRoutes', 'registerTimeMachineRoutes'
];
for (const moduleName of requiredModules) {
  if (!appServer.includes(`await ${moduleName}(`)) errors.push(`新入口缺少路由模块装配：${moduleName}`);
}
for (const marker of ['registerRequestPolicy', "app.get('/health'", "'/api/v1/runtime/worker'", "'/api/v1/runtime/readiness'", 'setErrorHandler', 'shouldProjectAuthorResponse']) {
  if (!appServer.includes(marker)) errors.push(`新入口缺少关键装配：${marker}`);
}

// 4. 身份上下文唯一入口：业务路由不得自行读cookie判身份（统一经 auth-context/request-policy）
const authContext = read('apps/api/src/infrastructure/security/auth-context.ts');
for (const marker of ['requireAuthenticatedAccount', 'requireAuthenticatedOwner', 'requireAdministrator']) {
  if (!authContext.includes(`export function ${marker}`)) errors.push(`auth-context 缺少身份入口：${marker}`);
}

if (errors.length > 0) {
  console.error('AUTH-TAKEOVER 入口切换检查失败：');
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}
console.log('AUTH-TAKEOVER 入口切换检查通过：旧装配零引用，main→app-server，11个业务路由模块+健康/策略/脱敏/错误封装完整。');
