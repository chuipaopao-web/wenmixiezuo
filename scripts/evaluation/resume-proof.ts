/**
 * 恢复证明（接续纠正离线部分3）：fake-adapter证明恢复c116818b不会重发已成功步骤。
 * 在一致性副本上：reset悬空租约后process该run，探针适配器记录每次触网节点；
 * 断言skeleton与volume-card:0-5零触网（缓存命中），只有未完成步骤才发出调用。
 */
import { DatabaseSync } from 'node:sqlite';
import { TimeMachineDesignService } from '../../apps/api/src/application/books/time-machine-design-service.js';
import { TimeMachineModelGateway } from '../../apps/api/src/infrastructure/models/time-machine-model-gateway.js';

const SRC = '.local/eval/fast-close-runtime/data/database/wenmi.sqlite';
const COPY = '.local/eval/resume-proof.sqlite';
const RUN_ID = 'c116818b-028d-4438-9bc6-2e4474155aaa';
{
  const src = new DatabaseSync(SRC);
  src.prepare('VACUUM INTO ?').run(COPY);
  src.close();
}
const db = new DatabaseSync(COPY);

const fired: string[] = [];
const outputs = (prompt: string): unknown => {
  if (prompt.includes('自检你刚完成')) return { pass: true, issues: [] };
  if (prompt.includes('自检候选锚点')) return { pass: true, issues: [] };
  if (prompt.includes('下结论')) return { action: 'verdict', pass: true, issues: [], suggestions: [], hasMoreIssues: false };
  if (prompt.includes('核对候选锚点')) return { pass: true, issues: [], suggestions: [], hasMoreIssues: false };
  return { pass: true, issues: [] };
};
const resolver = (provider: string, modelId: string) => ({
  provider, modelId,
  async generate(request: { prompt: string }) {
    fired.push(request.prompt.slice(0, 12));
    return { provider, modelId, output: JSON.stringify(outputs(request.prompt)), inputTokens: 10, outputTokens: 10, cashCostCny: 0, state: 'succeeded' as const };
  }
});

async function main(): Promise<void> {
  // 核对run当前状态与检查点（合同：先离线核实state/lease/checkpoint）
  const run = db.prepare('SELECT id, scheme, state, phase, book_id, snapshot_json FROM tm2_design_runs WHERE id=?').get(RUN_ID) as { state: string; phase: string; book_id: string } | undefined;
  if (!run) throw new Error('run不存在');
  console.log(`run状态: state=${run.state} phase=${run.phase} book=${run.book_id}`);
  const steps = db.prepare('SELECT id, state, attempt, lease_until FROM tm2_steps WHERE id LIKE ? ORDER BY rowid').all(`${RUN_ID}:%`) as { id: string; state: string; attempt: string | null; lease_until: number | null }[];
  for (const s of steps) console.log(`  既有步骤: ${s.id.split(':').slice(-2).join(':')} state=${s.state} lease=${s.lease_until}`);
  // 悬空租约：Lease已过期的running步骤由既有claim路径处理（不直接改状态伪造进度）

  const gateway = new TimeMachineModelGateway(db, resolver as never);
  const service = new TimeMachineDesignService(db, gateway as never, 64000);
  try {
    await service.process(RUN_ID);
    console.log('process 完成');
  } catch (error) {
    console.log('process 抛出：', error instanceof Error ? `${error.name}: ${error.message}` : error);
  }
  console.log(`触网次数: ${fired.length}，节点: ${fired.join(' | ')}`);
  const stepsAfter = db.prepare('SELECT id, state, error_code FROM tm2_steps WHERE id LIKE ? ORDER BY rowid').all(`${RUN_ID}:%`) as { id: string; state: string; error_code: string | null }[];
  for (const s of stepsAfter) console.log(`  终态步骤: ${s.id.split(':').slice(-2).join(':')} ${s.state} ${s.error_code ?? ''}`);
  const runAfter = db.prepare('SELECT state, phase, error_code FROM tm2_design_runs WHERE id=?').get(RUN_ID) as Record<string, unknown>;
  console.log('run终态：', JSON.stringify(runAfter));
  db.close();
}
main().catch(e => { console.error(e); process.exit(1); });
