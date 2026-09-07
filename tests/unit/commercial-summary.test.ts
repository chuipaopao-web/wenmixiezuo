import { DatabaseSync } from 'node:sqlite';
import { expect, it } from 'vitest';
import { commercialSummary, HISTORICAL_TEST_USER_IDS } from '../../apps/api/src/application/admin/commercial-summary.js';

it('商业统计排除精确测试身份，付费档与收款分列，北京时间边界及零日期正确', () => {
  const db = new DatabaseSync(':memory:');
  try {
    db.exec(`CREATE TABLE user_accounts(user_id TEXT,role TEXT,created_at TEXT);
      CREATE TABLE user_memberships(user_id TEXT,plan TEXT);
      CREATE TABLE membership_transactions(user_id TEXT,event_type TEXT,amount_cash_micros INTEGER);`);
    const insert = db.prepare('INSERT INTO user_accounts VALUES (?, ?, ?)');
    insert.run('admin', 'admin', '2026-09-06T16:00:00.000Z');
    insert.run('paid', 'user', '2026-09-06T16:00:00.000Z');
    insert.run('free', 'user', '2026-09-06T15:59:59.000Z');
    insert.run(HISTORICAL_TEST_USER_IDS[0], 'user', '2026-09-06T16:00:00.000Z');
    db.prepare('INSERT INTO user_memberships VALUES (?, ?)').run('paid', 'gold');
    db.prepare('INSERT INTO user_memberships VALUES (?, ?)').run('free', 'bronze');
    db.prepare('INSERT INTO user_memberships VALUES (?, ?)').run(HISTORICAL_TEST_USER_IDS[0], 'diamond');
    db.exec("INSERT INTO membership_transactions VALUES ('paid','grant',98000000),('paid','renew',198000000)");
    db.prepare('INSERT INTO membership_transactions VALUES (?, ?, ?)').run(HISTORICAL_TEST_USER_IDS[0], 'grant', 980000000);
    const summary = commercialSummary(db, new Date('2026-09-07T00:00:00.000Z'));
    expect(summary).toMatchObject({registeredUsers: 2, newUsersToday: 1, paidUsers: 1, paidRate: 0.5,
      excludedTestUsers: 1, estimatedRevenueCashMicros: 198000000, recordedRevenueCashMicros: 296000000});
    expect(summary.daily.slice(0, 3)).toEqual([{day:'2026-09-07',newUsers:1},{day:'2026-09-06',newUsers:1},{day:'2026-09-05',newUsers:0}]);
    expect(summary.daily).toHaveLength(30);
    db.exec('DELETE FROM user_accounts');
    expect(commercialSummary(db, new Date())).toMatchObject({registeredUsers:0,paidUsers:0,paidRate:null});
  } finally { db.close(); }
});
