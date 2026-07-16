import { existsSync, readFileSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';

const projectRoot = process.cwd();
if (!existsSync(resolve(projectRoot, 'RELEASE_ID'))) {
  throw new Error('拒绝在文秘写作项目根目录之外执行清理');
}

for (const relativePath of ['apps/api/dist', 'apps/worker/dist', 'apps/web/dist', 'coverage']) {
  const target = resolve(projectRoot, relativePath);
  if (!target.startsWith(`${resolve(projectRoot)}\\`) && !target.startsWith(`${resolve(projectRoot)}/`)) {
    throw new Error(`拒绝清理项目外路径：${target}`);
  }
  rmSync(target, { force: true, recursive: true });
}

console.log(`已清理 ${readFileSync(resolve(projectRoot, 'RELEASE_ID'), 'utf8').trim()} 的构建产物`);

