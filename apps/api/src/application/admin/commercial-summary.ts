import type { DatabaseSync } from 'node:sqlite';

// 第142批逐一核实的历史验收账号；只排除这些身份，不用邮箱关键词或IP判断真实用户。
// 数据保留至删除影响确认完成，之后自然不再命中；不影响账号权限或作品。
export const HISTORICAL_TEST_USER_IDS = [
  '63779c04-bce6-4bc8-aacc-422b4fbdc4a3',
  'a849ba77-39b8-41bc-a644-851df668199c',
  '5395c55e-1fe1-4c9a-ae4b-d9b5960cba76',
  '92c5b515-b08d-4bbd-b462-5819052c5ef3',
  'd15e439d-9945-4d85-a3dd-55f1b954ec88'
] as const;

export function commercialSummary(database: DatabaseSync, now: Date) {
  const marks = HISTORICAL_TEST_USER_IDS.map(() => '?').join(',');
  const members = database.prepare(`SELECT a.created_at AS createdAt, m.plan
    FROM user_accounts a LEFT JOIN user_memberships m ON m.user_id=a.user_id
    WHERE a.role='user' AND a.user_id NOT IN (${marks})`).all(...HISTORICAL_TEST_USER_IDS) as unknown as Array<{createdAt: string; plan: string | null}>;
  const dayFor = (value: Date) => new Date(value.getTime() + 8 * 3_600_000).toISOString().slice(0, 10);
  const today = dayFor(now);
  const byDay = new Map<string, number>();
  for (const member of members) {
    const day = dayFor(new Date(member.createdAt));
    byDay.set(day, (byDay.get(day) ?? 0) + 1);
  }
  // 老板明确确认现有付费档全部按付费人数计算；免费青铜不纳入。
  const paidUsers = members.filter((m) => m.plan !== null && ['silver', 'gold', 'diamond'].includes(m.plan)).length;
  const receipts = database.prepare(`SELECT COALESCE(SUM(t.amount_cash_micros),0) AS amount
    FROM membership_transactions t JOIN user_accounts a ON a.user_id=t.user_id
    WHERE a.role='user' AND a.user_id NOT IN (${marks}) AND t.event_type IN ('grant','renew')`).get(...HISTORICAL_TEST_USER_IDS) as {amount: number};
  const excluded = database.prepare(`SELECT COUNT(*) AS count FROM user_accounts WHERE role='user' AND user_id IN (${marks})`).get(...HISTORICAL_TEST_USER_IDS) as {count: number};
  return {
    timezone: 'Asia/Shanghai', registeredUsers: members.length, newUsersToday: byDay.get(today) ?? 0,
    paidUsers, paidRate: members.length === 0 ? null : paidUsers / members.length,
    estimatedRevenueCashMicros: paidUsers * 198_000_000, estimateUnitCny: 198,
    recordedRevenueCashMicros: Number(receipts.amount), excludedTestUsers: Number(excluded.count),
    daily: Array.from({length: 30}, (_, i) => {
      const day = dayFor(new Date(now.getTime() - i * 86_400_000));
      return {day, newUsers: byDay.get(day) ?? 0};
    })
  };
}
