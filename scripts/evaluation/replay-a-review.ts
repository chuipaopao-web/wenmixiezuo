/**
 * A方案review-source:1 budget失败复盘：在隔离库副本上用探针网关重放设计流程，
 * 逐步记录每个节点提示长度与真实失败点（不重发真实模型调用——探针适配器即时成功返回）。
 */
import { copyFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { TimeMachineDesignService } from '../../apps/api/src/application/books/time-machine-design-service.js';
import { TimeMachineModelGateway } from '../../apps/api/src/infrastructure/models/time-machine-model-gateway.js';

const SRC = '.local/eval/fast-close-runtime/data/database/wenmi.sqlite';
const COPY = '.local/eval/replay-a.sqlite';
// 一致性副本由VACUUM INTO预先生成（live WAL下copyFileSync会拿到未检查点旧数据，禁用）
{
  const src = new DatabaseSync(SRC);
  src.prepare('VACUUM INTO ?').run(COPY);
  src.close();
}
const db = new DatabaseSync(COPY);

const RUN_ID = '4d9cfdf9-2ab1-4878-a643-eeae630929fd';
const scope = { ownerId: '13981d08-402f-488d-89b4-08a1aa155399', bookId: 'v7-book-7360dfb5a9ce22770728cfa76ba29a78' };

// 探针适配器：即时成功（JSON按提示类型给最小合法输出），记录每个节点提示长度
const calls: { node: string; chars: number; maxOutput: number }[] = [];
const outputs = (prompt: string): unknown => {
  if (prompt.includes('下结论')) return { action: 'verdict', pass: true, issues: [], suggestions: [], hasMoreIssues: false };
  if (prompt.includes('核对候选锚点')) return { pass: true, issues: [], suggestions: [], hasMoreIssues: false };
  return { pass: true, issues: [] };
};
const resolver = (provider: string, modelId: string) => ({
  provider, modelId,
  async generate(request: { prompt: string; maxOutputTokens?: number }) {
    calls.push({ node: request.prompt.slice(0, 30), chars: request.prompt.length, maxOutput: request.maxOutputTokens ?? 0 });
    return { provider, modelId, output: JSON.stringify(outputs(request.prompt)), inputTokens: 10, outputTokens: 10, cashCostCny: 0, state: 'succeeded' as const };
  }
});

async function main(): Promise<void> {
  // 复位A的失败步骤与run（副本上）
  db.prepare("UPDATE tm2_steps SET state='ready',attempt=NULL,error_code=NULL,input_hash='reset-by-replay' WHERE id LIKE ? AND state='failed'").run(`${RUN_ID}:%`);
  db.prepare("UPDATE tm2_design_runs SET state='queued',error_code=NULL,error_message=NULL WHERE id=?").run(RUN_ID);
  const gateway = new TimeMachineModelGateway(db, resolver as never);
  // 捕获budget错误的原始消息（区分字符红线/窗口预留/成员预算）
  const originalGenerate = gateway.generate.bind(gateway);
  gateway.generate = (async (request: { prompt: string; maxOutputTokens: number; windowTokens: number; thinkingHeadroomTokens?: number }) => {
    try {
      return await originalGenerate(request as never);
    } catch (error) {
      if (error instanceof Error) console.log(`[budget源头] message="${error.message}" promptChars=${request.prompt.length} promptBytes=${Buffer.byteLength(request.prompt, 'utf8')} maxOutput=${request.maxOutputTokens} headroom=${request.thinkingHeadroomTokens ?? 'default'} window=${request.windowTokens}`);
      throw error;
    }
  }) as never;
  const service = new TimeMachineDesignService(db, gateway as never, 64000);
  // 冲突定位：打印review-source:0既有输入hash与新输入差异
  const innerSteps = (service as unknown as { steps: { create: (scope: unknown, id: string, input: unknown, member: string) => void } }).steps;
  const origCreate = innerSteps.create.bind(innerSteps);
  innerSteps.create = ((scope2: unknown, id: string, input: unknown, member: string) => {
    if (id.includes('review-source:0')) {
      const row = db.prepare('SELECT input_hash, member FROM tm2_steps WHERE id=?').get(id) as { input_hash: string; member: string } | undefined;
      const inp = input as { prompt: string; member: unknown; window: number };
      console.log(`[create比对] member=${row?.member}→${member} 新prompt前160=${JSON.stringify(inp.prompt.slice(0, 160))}`);
      const savedPrompt = db.prepare('SELECT output FROM tm2_steps WHERE id=?').get(id) as { output: string | null } | undefined;
      void savedPrompt;
    }
    return origCreate(scope2 as never, id, input as never, member);
  }) as never;
  try {
    await service.process(RUN_ID);
    console.log('process 完成');
  } catch (error) {
    console.log('process 抛出：', error instanceof Error ? `${error.name}: ${error.message}` : error);
  }
  const run = db.prepare('SELECT state, phase, error_code, error_message FROM tm2_design_runs WHERE id=?').get(RUN_ID) as Record<string, unknown>;
  console.log('run终态：', JSON.stringify(run));
  const steps = db.prepare('SELECT id, state, error_code FROM tm2_steps WHERE id LIKE ? ORDER BY rowid').all(`${RUN_ID}:%`) as { id: string; state: string; error_code: string | null }[];
  for (const s of steps) console.log('step:', s.id.split(':').slice(-2).join(':'), s.state, s.error_code ?? '');
  db.close();
}
main().catch(e => { console.error(e); process.exit(1); });
