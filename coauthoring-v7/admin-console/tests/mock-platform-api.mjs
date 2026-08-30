import { createServer } from 'node:http';

const adminAccount = { userId: 'admin-local', email: 'admin@local.test', displayName: '本地管理员', role: 'admin', status: 'active' };
const userAccount = { userId: 'user-local', email: 'user@local.test', displayName: '普通作者', role: 'user', status: 'active' };
const openingTeam = {
  credentials: { codingPlanConfigured: true, agentPlanConfigured: false },
  roles: [
    role('chief_editor', '主编', '理解作者想法、建立任务书、审查资料包并把分歧交还作者决定。', [
      member('chief-deepseek-v4-pro', '一号主编', 'deepseek-v4-pro', 'coding', true, true, 1),
      member('chief-glm-5-3', '二号主编', 'glm-5.3', 'coding', true, false, 2),
      member('chief-kimi-k3', '三号主编', 'kimi-k3', 'agent', true, false, 3)
    ]),
    role('screenwriter', '编剧', '根据冻结任务书设计完整、可修改且彼此一致的开书资料包。', [
      member('screenwriter-deepseek-v4-pro', '一号编剧', 'deepseek-v4-pro', 'coding', true, true, 1),
      member('screenwriter-doubao-seed-2-1-turbo', '二号编剧', 'doubao-seed-2.1-turbo', 'coding', true, false, 2),
      member('screenwriter-kimi-k3', '三号编剧', 'kimi-k3', 'agent', true, false, 3)
    ])
  ]
};

const server = createServer(async (request, response) => {
  const url = new URL(request.url ?? '/', 'http://127.0.0.1:43172');
  const session = /mock_session=([^;]+)/u.exec(request.headers.cookie ?? '')?.[1] ?? '';
  if (request.method === 'GET' && url.pathname === '/api/v1/auth/me') {
    if (session === 'admin') return send(response, 200, { data: adminAccount });
    if (session === 'user') return send(response, 200, { data: userAccount });
    return send(response, 401, { error: { message: '请先登录' } });
  }
  if (request.method === 'POST' && url.pathname === '/api/v1/auth/login') {
    const body = await readJson(request);
    const ordinary = String(body.email ?? '').startsWith('user@');
    response.setHeader('set-cookie', `mock_session=${ordinary ? 'user' : 'admin'}; Path=/; HttpOnly; SameSite=Lax`);
    return send(response, 200, { data: { account: ordinary ? userAccount : adminAccount, expiresInSeconds: 3600 } });
  }
  if (request.method === 'POST' && url.pathname === '/api/v1/auth/logout') {
    response.setHeader('set-cookie', 'mock_session=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax');
    return send(response, 200, { data: { loggedOut: true } });
  }
  if (!url.pathname.startsWith('/api/v1/admin/')) return send(response, 404, { error: { message: '不存在' } });
  if (session !== 'admin') return send(response, 403, { error: { message: '需要管理员权限' } });

  if (request.method === 'GET' && url.pathname === '/api/v1/admin/v7/opening-agent/members') {
    return send(response, 200, { data: teamView() });
  }
  if (request.method === 'PATCH' && url.pathname.startsWith('/api/v1/admin/v7/opening-agent/members/')) {
    const memberKey = decodeURIComponent(url.pathname.split('/').at(-1) ?? '');
    const body = await readJson(request);
    const activeRole = openingTeam.roles.find((item) => item.members.some((itemMember) => itemMember.memberKey === memberKey));
    const activeMember = activeRole?.members.find((item) => item.memberKey === memberKey);
    if (!activeRole || !activeMember) return send(response, 400, { error: { message: 'AI成员不存在' } });
    if (body.expectedRevision !== activeRole.revision) return send(response, 409, { error: { message: '岗位刚刚被更新，请刷新' } });
    if (typeof body.enabled === 'boolean') activeMember.enabled = body.enabled;
    if (body.defaultForRole === true) {
      activeRole.members.forEach((item) => { item.defaultForRole = item.memberKey === memberKey; });
      activeMember.enabled = true;
    }
    if (Number.isInteger(body.fallbackPriority)) {
      activeRole.members.sort((left, right) => left.fallbackPriority - right.fallbackPriority);
      activeRole.members.splice(activeRole.members.indexOf(activeMember), 1);
      activeRole.members.splice(Math.max(0, Math.min(activeRole.members.length, body.fallbackPriority - 1)), 0, activeMember);
    }
    activeRole.members.sort((left, right) => Number(right.defaultForRole) - Number(left.defaultForRole));
    activeRole.members.forEach((item, index) => { item.fallbackPriority = index + 1; });
    activeRole.revision += 1;
    activeRole.updatedAt = new Date().toISOString();
    return send(response, 200, { data: teamView() });
  }

  if (url.pathname === '/api/v1/admin/dashboard') return send(response, 200, { data: {
    overview: { failedTasksToday: 2, apiCashMicrosToday: 1280000, activeMembers: 18, computeToday: 986000, openIssues: 5, revenueCashMicros: 128800000, monthRevenueCashMicros: 25800000 },
    business: { registeredUsers: 126, cumulativePaidUsers: 32, cumulativePaidRate: 0.254, newUsers30d: 24, firstPaidUsers30d: 7, firstPaidRate30d: 0.292, activePaidUsers: 18, recordedMembershipRevenueCashMicros: 128800000 },
    trend: Array.from({ length: 7 }, (_, index) => ({ day: `2026-08-${String(18 + index).padStart(2, '0')}`, cashMicros: 500000 + index * 80000, compute: 260000 + index * 40000, calls: 12 + index, revenueCashMicros: index % 2 === 0 ? 9900000 : 0 })),
    topUsers: [{ userId: 'u-1', displayName: '张作者', email: 'zhang@example.com', compute: 328000, cashMicros: 620000, calls: 18 }],
    expiring: []
  } });
  if (url.pathname === '/api/v1/admin/user-operations') return send(response, 200, { data: { timezone: 'Asia/Shanghai', day: '2026-08-24', items: [
    { userId: 'u-1', email: 'zhang@example.com', displayName: '张作者', status: 'active', createdAt: '2026-07-10T08:00:00.000Z', lastLoginAt: '2026-08-24T08:10:00.000Z', lastActivityAt: '2026-08-24T10:20:00.000Z', membership: { plan: 'gold', status: 'active', periodEnd: '2026-09-30T00:00:00.000Z' }, bookCount: 2, activeBookCount: 1, archivedBookCount: 1, today: { day: '2026-08-24', taskCount: 6, failed: false, failureCount: 0 }, books: [{ bookId: 'b-1', title: '三国小兵崛起', status: 'active', workflowStage: 'volume', currentVolume: 2, currentEvent: 4, currentChapter: 36, latestManuscriptAt: '2026-08-24T09:00:00.000Z', latestSettlementAt: '2026-08-24T09:30:00.000Z', latestTaskId: 't-1', latestTaskStatus: 'completed', latestTaskAt: '2026-08-24T09:30:00.000Z' }], failures: [] },
    { userId: 'u-2', email: 'li@example.com', displayName: '李作者', status: 'active', createdAt: '2026-08-01T08:00:00.000Z', lastLoginAt: '2026-08-23T08:00:00.000Z', lastActivityAt: '2026-08-23T09:00:00.000Z', membership: null, bookCount: 1, activeBookCount: 1, archivedBookCount: 0, today: { day: '2026-08-24', taskCount: 1, failed: true, failureCount: 1 }, books: [{ bookId: 'b-2', title: '雾城调查局', status: 'active', workflowStage: 'event', currentVolume: 1, currentEvent: 2, currentChapter: 8, latestManuscriptAt: null, latestSettlementAt: null, latestTaskId: 't-2', latestTaskStatus: 'failed', latestTaskAt: '2026-08-24T03:00:00.000Z' }], failures: [{ taskId: 't-2', bookId: 'b-2', bookTitle: '雾城调查局', taskType: 'event', workflowNode: 'generation', status: 'failed', errorCode: 'MODEL_UNAVAILABLE', occurredAt: '2026-08-24T03:00:00.000Z', frontEndPage: '事件', errorSummary: '成员暂时不可用', recoveryKey: 'recover-t-2' }] }
  ] } });
  if (url.pathname === '/api/v1/admin/usage') return send(response, 200, { data: { totalTokens: 6800000, totalInputTokens: 4300000, totalOutputTokens: 2500000, totalCashMicros: 12800000, totalCalls: 284, perUser: [{ userId: 'u-1', email: 'zhang@example.com', displayName: '张作者', role: 'user', status: 'active', books: 2, tokens: 1200000, calls: 62, cashMicros: 2600000 }], perModel: [{ provider: 'volcengine', modelId: 'doubao-seed-2.1', calls: 120, tokens: 2800000, inputTokens: 1800000, outputTokens: 1000000, cashMicros: 5200000 }], daily: [] } });
  if (url.pathname === '/api/v1/admin/issues') return send(response, 200, { data: { total: 2, items: [
    { sourceType: 'failed_task', sourceId: 't-2', taskId: 't-2', bookId: 'b-2', bookTitle: '雾城调查局', userId: 'u-2', displayName: '李作者', email: 'li@example.com', category: '事件生成失败', detail: '模型调用中断，已保留其他成员结果。', errorCode: 'MODEL_UNAVAILABLE', pagePath: '/event', occurredAt: '2026-08-24T03:00:00.000Z', status: 'open', severity: 'high', note: '' },
    { sourceType: 'feedback', sourceId: 'f-1', taskId: null, bookId: 'b-1', bookTitle: '三国小兵崛起', userId: 'u-1', displayName: '张作者', email: 'zhang@example.com', category: '体验建议', detail: '希望分卷方向解释更清楚。', errorCode: null, pagePath: '/volume', occurredAt: '2026-08-23T03:00:00.000Z', status: 'in_progress', severity: 'medium', note: '正在评估' }
  ] } });
  if (url.pathname === '/api/v1/admin/membership-stats') return send(response, 200, { data: { summary: { activeMembers: 18, totalRevenueCashMicros: 128800000, monthRevenueCashMicros: 25800000, renewals: 9, expiringIn30Days: 4 }, byPlan: [{ plan: 'gold', members: 9 }, { plan: 'silver', members: 6 }, { plan: 'bronze', members: 3 }], transactions: [{ transactionId: 'm-1', eventType: 'renew', plan: 'gold', amountCashMicros: 9900000, periodStart: '2026-08-01T00:00:00.000Z', periodEnd: '2026-09-01T00:00:00.000Z', note: '', createdAt: '2026-08-24T02:00:00.000Z', userId: 'u-1', displayName: '张作者', email: 'zhang@example.com' }] } });
  return send(response, 404, { error: { message: '不存在' } });
});

server.listen(43172, '127.0.0.1', () => process.stdout.write('V7 mock platform API http://127.0.0.1:43172\n'));

function send(response, status, payload) {
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  response.end(JSON.stringify(payload));
}

async function readJson(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { return {}; }
}

function role(roleKey, publicName, responsibility, members) {
  return { roleKey, publicName, responsibility, revision: 1, updatedAt: '2026-08-25T02:00:00.000Z', members };
}

function member(memberKey, displayName, modelId, plan, enabled, defaultForRole, fallbackPriority) {
  const configured = plan === 'coding';
  return {
    memberKey, displayName, modelId, plan, planName: plan === 'coding' ? 'Coding Plan' : 'Agent Plan',
    enabled, defaultForRole, fallbackPriority,
    credential: { configured, message: configured ? '套餐凭据已配置' : 'Agent Plan凭证未配置' }
  };
}

function teamView() {
  const members = openingTeam.roles.flatMap((item) => item.members);
  return {
    summary: {
      roleCount: openingTeam.roles.length,
      memberCount: members.length,
      enabledMemberCount: members.filter((item) => item.enabled).length,
      unavailableMemberCount: members.filter((item) => !item.credential.configured).length
    },
    credentials: openingTeam.credentials,
    roles: openingTeam.roles
  };
}
