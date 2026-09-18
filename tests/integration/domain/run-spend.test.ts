import { afterEach, describe, it, expect } from 'vitest';
import { createTestContext, type TestContext } from '../../helpers/test-context.js';
import { BookRepository } from '../../../apps/api/src/infrastructure/db/repositories/book-repository.js';
import { computeRunSpend } from '../../../apps/api/src/application/books/time-machine-run-spend.js';

// d8407c59复核·run级预算统计反例：当前+归档attempts按调用ID去重
// 归档前后总数不降、恢复归档不倍增、他书不混入、未知转actual不重复计费
const contexts: TestContext[] = [];
afterEach(() => contexts.splice(0).forEach(c => c.close()));

const RUN = 'run-spend-1';
function setup() {
  const c = createTestContext(); contexts.push(c);
  const scope = { ownerId: c.config.ownerId, bookId: 'spend-book' };
  c.database.prepare('INSERT INTO owners VALUES(?,?,1,?,?)').run(scope.ownerId, '统计作者', '2026-09-18', '2026-09-18');
  new BookRepository(c.database).create(scope, '统计书', '2026-09-18', 'active');
  c.database.prepare("INSERT INTO tm2_books(owner,book,revision,manifest) VALUES(?,?,0,'{}')").run(scope.ownerId, scope.bookId);
  return { c, scope };
}
function addCall(c: TestContext, scope: { ownerId: string; bookId: string }, id: string, step: string, call: { state: string; input?: number; output?: number; reserved?: number }) {
  c.database.prepare("INSERT OR IGNORE INTO tm2_steps(owner,book,id,input_hash,member,state,attempt) VALUES(?,?,?,?,?,'succeeded',?)")
    .run(scope.ownerId, scope.bookId, step, 'h', 'm1', id);
  c.database.prepare("INSERT INTO tm2_model_calls(id,owner_id,book_id,member_id,provider,model_id,request_hash,state,reserved_tokens,input_tokens,output_tokens,started_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)")
    .run(id, scope.ownerId, scope.bookId, 'm1', 'p', 'm', 'h', call.state, call.reserved ?? 1000, call.input ?? null, call.output ?? null, '2026-09-18');
  c.database.prepare('INSERT INTO tm2_attempts(id,owner,book,step,state,started_at) VALUES(?,?,?,?,?,?)')
    .run(id, scope.ownerId, scope.bookId, step, call.state === 'succeeded' ? 'succeeded' : call.state === 'failed' ? 'failed' : 'unknown', 1);
}
function archiveAttempts(c: TestContext, scope: { ownerId: string; bookId: string }, stepId: string, callIds: string[]) {
  const attempts = callIds.map(id => ({ id, owner: scope.ownerId, book: scope.bookId, step: stepId, state: 'succeeded', started_at: 1, finished_at: 2 }));
  c.database.prepare("INSERT INTO tm2_step_archive(owner,book,id,archived_at,reason,row_json,attempts_json,output_json) VALUES(?,?,?,?,?,?,?,?)")
    .run(scope.ownerId, scope.bookId, stepId, '2026-09-18', '输入版本变化', '{}', JSON.stringify(attempts), null);
}

describe('run级预算统计统一入口（d8407c59）', () => {
  it('归档前后总数不降：归档步骤的实耗不从统计消失（按调用ID去重）', () => {
    const { c, scope } = setup();
    addCall(c, scope, 'call-1', `${RUN}:skeleton`, { state: 'succeeded', input: 100, output: 50 });
    addCall(c, scope, 'call-2', `${RUN}:review-anchors:0`, { state: 'succeeded', input: 200, output: 80 });
    const before = computeRunSpend(c.database, scope, RUN);
    expect(before).toMatchObject({ calls: 2, tokens: 430, gaps: [] });
    // 模拟归档：当前attempts删除、attempts_json保留（archiveStep语义）
    c.database.prepare('DELETE FROM tm2_attempts WHERE id=?').run('call-2');
    archiveAttempts(c, scope, `${RUN}:review-anchors:0`, ['call-2']);
    const after = computeRunSpend(c.database, scope, RUN);
    expect(after.calls).toBe(2); // 归档后不降
    expect(after.tokens).toBe(430);
    expect(after.gaps).toEqual([]);
  });
  it('恢复归档不倍增：当前与归档同ID只计一次', () => {
    const { c, scope } = setup();
    addCall(c, scope, 'call-1', `${RUN}:revise-volume:v3:revision-1`, { state: 'succeeded', input: 300, output: 100 });
    // 恢复后当前attempts与归档attempts_json同ID并存
    archiveAttempts(c, scope, `${RUN}:revise-volume:v3:revision-1`, ['call-1']);
    const spend = computeRunSpend(c.database, scope, RUN);
    expect(spend.calls).toBe(1);
    expect(spend.tokens).toBe(400);
  });
  it('他书不混入：owner/book/run三重隔离', () => {
    const { c, scope } = setup();
    addCall(c, scope, 'call-1', `${RUN}:skeleton`, { state: 'succeeded', input: 100, output: 50 });
    addCall(c, scope, 'call-2', 'other-run:skeleton', { state: 'succeeded', input: 999, output: 999 });
    addCall(c, scope, 'call-3', `${RUN}x:skeleton`, { state: 'succeeded', input: 777, output: 1 }); // 前缀相似非本run
    const spend = computeRunSpend(c.database, scope, RUN);
    expect(spend.calls).toBe(1);
    expect(spend.tokens).toBe(150);
  });
  it('未知保守占额、未知转actual只按actual计一次；已发截断usage照计', () => {
    const { c, scope } = setup();
    addCall(c, scope, 'call-u', `${RUN}:review-source:0`, { state: 'unknown', reserved: 5000 });
    addCall(c, scope, 'call-t', `${RUN}:review-anchors:0`, { state: 'failed', reserved: 9000, input: 3000, output: 12000 }); // 截断已上报usage
    let spend = computeRunSpend(c.database, scope, RUN);
    expect(spend.calls).toBe(2);
    expect(spend.tokens).toBe(5000 + 15000);
    // 未知转actual：只按actual计一次（不叠加reserved）
    c.database.prepare("UPDATE tm2_model_calls SET state='succeeded', input_tokens=4000, output_tokens=2000 WHERE id='call-u'").run();
    spend = computeRunSpend(c.database, scope, RUN);
    expect(spend.tokens).toBe(6000 + 15000);
    expect(spend.calls).toBe(2);
  });
  it('历史关联不可解析报告缺口并fail closed（不按0）', () => {
    const { c, scope } = setup();
    // 归档attempts_json指向本run但调用行不存在于本owner/book
    archiveAttempts(c, scope, `${RUN}:ghost`, ['call-ghost']);
    const spend = computeRunSpend(c.database, scope, RUN);
    expect(spend.calls).toBe(0);
    expect(spend.gaps.length).toBeGreaterThan(0); // 缺口必须显式报告
    expect(spend.gaps[0]).toContain('call-ghost');
  });
  it('预算预检拒绝（无调用行+step budget标记）明确未发送：不计消耗不报缺口', () => {
    const { c, scope } = setup();
    // 预算预检在创建调用行前拒绝：attempt存在、调用行不存在、step error_code=budget（7662b6f6 skeleton:revision-1实证）
    c.database.prepare("INSERT INTO tm2_steps(owner,book,id,input_hash,member,state,attempt,error_code) VALUES(?,?,?,?,?,'failed','call-pre','budget')")
      .run(scope.ownerId, scope.bookId, `${RUN}:skeleton:revision-1`, 'h', 'm1');
    c.database.prepare("INSERT INTO tm2_attempts(id,owner,book,step,state,started_at) VALUES(?,?,?,?,'failed',1)")
      .run('call-pre', scope.ownerId, scope.bookId, `${RUN}:skeleton:revision-1`);
    addCall(c, scope, 'call-real', `${RUN}:skeleton`, { state: 'succeeded', input: 100, output: 50 });
    const spend = computeRunSpend(c.database, scope, RUN);
    expect(spend.calls).toBe(1); // 只有真实发送的1次
    expect(spend.tokens).toBe(150);
    expect(spend.gaps).toEqual([]);
  });
});
