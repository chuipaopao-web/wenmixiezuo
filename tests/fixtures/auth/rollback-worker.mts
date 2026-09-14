/**
 * AUTH-TAKEOVER-01 回滚兼容演练worker：独立进程打开既有库文件，
 * 对v1历史/已升级v2/新装v2三类账号执行登录，并验证既有会话cookie仍可认证。
 * 输出单行JSON：{logins:{...}, legacySessionValid:boolean}；全部成功exit 0。
 */
import { DatabaseSync } from 'node:sqlite';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
const imp = (p: string) => import(pathToFileURL(resolve(process.cwd(), p)).href);
const { IdentityService } = await imp('apps/api/src/identity/identity-service.ts');

const [dbPath, legacyCookie] = process.argv.slice(2);
if (dbPath === undefined) {
  console.error('usage: rollback-worker.mts <db> [cookieHeader]');
  process.exit(64);
}
const database = new DatabaseSync(resolve(dbPath));
const service = new IdentityService(database, false, 'rollback-legacy-owner');
const result: { logins: Record<string, string>; legacySessionValid: boolean | null } = { logins: {}, legacySessionValid: null };
try {
  for (const [label, email, password] of [
    ['legacyV1', 'rollback-legacy@example.com', 'Legacy-roll-123!'],
    ['upgradedV2', 'rollback-upgraded@example.com', 'Upgrade-roll-123!'],
    ['freshV2', 'rollback-fresh@example.com', 'Fresh-roll-123!']
  ] as const) {
    try {
      await service.login({ email, password });
      result.logins[label] = 'ok';
    } catch (error) {
      result.logins[label] = error instanceof Error ? (error as { code?: string }).code ?? error.message : String(error);
    }
  }
  if (legacyCookie !== undefined) {
    result.legacySessionValid = service.authenticate(legacyCookie) !== null;
  }
  database.close();
  process.stdout.write(JSON.stringify(result) + '\n');
  process.exit(Object.values(result.logins).every((value) => value === 'ok') && (result.legacySessionValid ?? true) ? 0 : 1);
} catch (error) {
  database.close();
  process.stdout.write(JSON.stringify({ fatal: String(error) }) + '\n');
  process.exit(2);
}
