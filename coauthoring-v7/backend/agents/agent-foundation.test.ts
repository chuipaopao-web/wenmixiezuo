import assert from 'node:assert/strict';
import {
  V7_OPENING_MEMBERS,
  V7_OPENING_ROLES,
  buildOpeningFallbackChain,
  listOpeningMembers,
  memberAvailability,
  validateMemberModelPolicy,
  validateOpeningAgentRoster
} from './agent-roster.js';
import {
  V7_AGENT_TOOLS,
  V7_NODE_ROLE_PERMISSIONS,
  assertOpeningToolAuthorized,
  validateAgentToolRegistry
} from './agent-tools.js';
import {
  V7_AGENT_SKILLS,
  compileOpeningSkillBundle,
  validateAgentSkillRegistry
} from './agent-skills.js';
import {
  V7_MAX_AUTOMATIC_MEMBER_SWITCHES,
  decideV7AgentFailure,
  nextFallbackMember
} from './agent-failure-policy.js';

assert.deepEqual(validateOpeningAgentRoster(), [], '成员注册表必须通过结构与套餐策略校验');
assert.deepEqual(validateAgentToolRegistry(), [], '工具注册表必须通过校验');
assert.deepEqual(validateAgentSkillRegistry(), [], 'Skill注册表必须通过校验');
assert.deepEqual(V7_OPENING_ROLES.map((item) => item.roleKey), ['chief_editor', 'screenwriter']);

const expectedOpeningMembersByRole = {
  chief_editor: 3,
  screenwriter: 3
} as const;

for (const role of V7_OPENING_ROLES) {
  const members = listOpeningMembers({ roleKey: role.roleKey });
  const expectedCount = expectedOpeningMembersByRole[role.roleKey];
  assert.equal(members.length, expectedCount, `${role.publicName}成员数量必须符合当前稳定编制`);
  assert.equal(members.filter((item) => item.defaultForRole).length, 1);
  assert.equal(
    new Set(members.map((item) => item.model.modelId)).size,
    expectedCount,
    `${role.publicName}成员必须使用不同模型`
  );
}

const kimiChief = V7_OPENING_MEMBERS.find((item) => item.memberKey === 'chief-kimi-k3')!;
assert.deepEqual(kimiChief.model, {
  provider: 'volcengine-ark-agent-plan', modelId: 'kimi-k3', plan: 'agent'
}, 'Kimi K3主编必须走Agent Plan');
assert.deepEqual(validateMemberModelPolicy({
  ...kimiChief,
  model: { provider: 'volcengine-ark-coding-plan', modelId: 'kimi-k3', plan: 'coding' }
}), ['chief-kimi-k3：Kimi K3必须使用火山方舟Agent Plan']);

for (const member of V7_OPENING_MEMBERS.filter((item) => item.model.modelId !== 'kimi-k3')) {
  assert.equal(member.model.provider, 'volcengine-ark-coding-plan');
  assert.equal(member.model.plan, 'coding');
}

const defaultChiefChain = buildOpeningFallbackChain('chief_editor');
assert.deepEqual(defaultChiefChain.map((item) => item.memberKey), [
  'chief-deepseek-v4-pro', 'chief-kimi-k3', 'chief-glm-5-3'
]);
const selectedKimiChiefChain = buildOpeningFallbackChain('chief_editor', { selectedMemberKey: 'chief-kimi-k3' });
assert.deepEqual(selectedKimiChiefChain.map((item) => item.memberKey), [
  'chief-kimi-k3', 'chief-deepseek-v4-pro', 'chief-glm-5-3'
]);
const disabledGlmChain = buildOpeningFallbackChain('chief_editor', {
  enabledOverrides: { 'chief-glm-5-3': false }
});
assert.deepEqual(disabledGlmChain.map((item) => item.memberKey), ['chief-deepseek-v4-pro', 'chief-kimi-k3']);
assert.throws(
  () => buildOpeningFallbackChain('chief_editor', {
    selectedMemberKey: 'chief-kimi-k3', enabledOverrides: { 'chief-kimi-k3': false }
  }),
  /未上岗或不存在/u
);

assert.deepEqual(memberAvailability(kimiChief, { codingPlan: true, agentPlan: false }), {
  available: false, reason: 'Agent Plan凭证未配置'
});
assert.deepEqual(memberAvailability(defaultChiefChain[0]!, { codingPlan: true, agentPlan: false }), {
  available: true, reason: null
});

assert.equal(V7_AGENT_SKILLS.filter((item) => item.kind === 'core').length, 1);
assert.equal(V7_AGENT_SKILLS.filter((item) => item.kind === 'role').length, 2);
assert.equal(V7_AGENT_SKILLS.filter((item) => item.kind === 'node').length, 2);
assert.doesNotMatch(JSON.stringify(V7_AGENT_SKILLS), /chief-kimi-k3|screenwriter-kimi-k3/u,
  'Skill不能按成员复制或绑定成员私有人设');

for (const [nodeKey, roleKey] of Object.entries(V7_NODE_ROLE_PERMISSIONS)) {
  const bundle = compileOpeningSkillBundle(roleKey, nodeKey as keyof typeof V7_NODE_ROLE_PERMISSIONS);
  assert.equal(bundle.skillVersionIds.length, 3, '每次只编译核心、岗位、节点三份Skill');
  assert.ok(bundle.responsibilities.length > 0);
  assert.ok(bundle.toolKeys.length > 0);
  assert.ok(Object.keys(bundle.outputContract).length > 0);
  assert.match(bundle.candidateBoundary, /候选/u);
}
const writerBundle = compileOpeningSkillBundle('screenwriter', 'opening_package_design');
assert.ok(writerBundle.toolKeys.includes('search_narrative_methods'));
assert.ok(writerBundle.toolKeys.includes('search_plot_patterns'));
assert.equal(writerBundle.toolKeys.includes('create_book' as never), false);
assert.throws(() => compileOpeningSkillBundle('screenwriter', 'opening_package_review'), /不能执行节点/u);
assert.doesNotThrow(() => assertOpeningToolAuthorized('chief_editor', 'opening_package_review', 'read_opening_candidate'));
assert.throws(
  () => assertOpeningToolAuthorized('chief_editor', 'opening_package_review', 'search_plot_patterns'),
  /无权调用/u
);
assert.equal(V7_AGENT_TOOLS.some((item) => item.toolKey === ('create_book' as never)), false,
  '作者确认前Agent工具不得创建正式书籍');

assert.equal(decideV7AgentFailure({
  failureClass: 'outcome_unknown', sameMemberStructureRepairs: 0, automaticMemberSwitches: 0
}).action, 'reconcile');
assert.equal(decideV7AgentFailure({
  failureClass: 'invalid_output', sameMemberStructureRepairs: 0, automaticMemberSwitches: 0
}).action, 'repair_same_member');
assert.equal(decideV7AgentFailure({
  failureClass: 'invalid_output', sameMemberStructureRepairs: 1, automaticMemberSwitches: 0
}).action, 'switch_member');
assert.equal(decideV7AgentFailure({
  failureClass: 'timeout', sameMemberStructureRepairs: 0, automaticMemberSwitches: 0
}).action, 'switch_member');
assert.equal(decideV7AgentFailure({
  failureClass: 'timeout', sameMemberStructureRepairs: 0,
  automaticMemberSwitches: V7_MAX_AUTOMATIC_MEMBER_SWITCHES
}).action, 'stop');
assert.equal(decideV7AgentFailure({
  failureClass: 'quality_rejected', sameMemberStructureRepairs: 0, automaticMemberSwitches: 0
}).action, 'stop', '主观质量不满意不能伪装成技术失败自动换人');
assert.equal(nextFallbackMember(defaultChiefChain, new Set(['chief-deepseek-v4-pro']))?.memberKey, 'chief-kimi-k3');
assert.equal(nextFallbackMember(defaultChiefChain, new Set(defaultChiefChain.map((item) => item.memberKey))), null);

process.stdout.write(`V7 opening agent foundation validated: ${V7_OPENING_MEMBERS.length} members, ${V7_AGENT_SKILLS.length} skills, ${V7_AGENT_TOOLS.length} tools.\n`);
