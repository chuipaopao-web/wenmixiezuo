import { MEMBER_SLOTS, OPENING_EVALUATION_REPORT, SETTING_EVALUATION_REPORT, SETTING_DESIGN_PRIORITY, settingReviewRanking, openingRanking, publicMemberIdentity } from '@wenmi/agent-catalog';
import {
  V7_MODEL_PROFILE_LABELS,
  V7_ROLE_CONTRACTS,
  allowedModelProfilesForRole,
  candidateModelProfilesForRole,
  modelAdmissionForRole,
  effectiveTemperature,
  independentReviewers,
  modelBindingForProfile,
  settingRosterFromGlobal,
  type V7AgentTaskKind,
  type V7AgentTaskSnapshot,
  type V7EffectiveMember,
  type V7FixedRoleKey
} from '@wenmi/v7-backend';
import type { Clock, IdGenerator } from '../../domain/ids.js';
import { DomainError, errorCodes } from '../../domain/errors.js';
import {
  V7AgentGovernanceRepository,
  type V7AgentGovernanceSnapshot
} from '../../infrastructure/db/repositories/v7-agent-governance-repository.js';

export interface V7AgentCredentialState {
  codingPlan: boolean;
  agentPlan: boolean;
  image: boolean;
}

export class V7AgentGovernanceService {
  public constructor(
    private readonly repository: V7AgentGovernanceRepository,
    private readonly ids: IdGenerator,
    private readonly clock: Clock,
    private readonly credentials: V7AgentCredentialState
  ) {
    this.repository.ensureSeeded(this.clock.now().toISOString());
  }

  public snapshot(): V7AgentGovernanceSnapshot {
    return this.repository.snapshot();
  }

  /** Opening admission is node-specific; it never expands the global role roster. */
  public openingRoster(): import('@wenmi/v7-backend').V7OpeningMemberDefinition[] {
    const snapshot=this.snapshot();
    const candidates=this.repository.candidateSlots();
    const result: import('@wenmi/v7-backend').V7OpeningMemberDefinition[]=[];
    for (const node of ['review','design'] as const) {
      const fixedRoleKey=node==='design'?'planning_writer':'chief_editor';
      const roleKey=node==='design'?'screenwriter':'chief_editor';
      // Default preference is independent of the recorded speed ranking.
      const preferred = openingRanking(node).toSorted((a, b) =>
        Number(b.profileKey === 'deepseek-v4-pro') - Number(a.profileKey === 'deepseek-v4-pro'));
      for (const row of preferred) {
        const legacy=snapshot.members.find(m=>m.fixedRoleKey===fixedRoleKey && m.modelProfileKey===row.profileKey && m.enabled);
        const slot=candidates.find(m=>m.roleKey===fixedRoleKey && m.modelProfileKey===row.profileKey);
        const memberKey=legacy?.memberKey ?? slot?.memberKey;
        if (!memberKey) continue;
        const model=modelBindingForProfile(row.profileKey);
        if (model.plan==='image' || !this.credentialReady({model})) continue;
        const position=result.filter(m=>m.roleKey===roleKey).length;
        if (node==='design' && position>=3) break;
        result.push({memberKey,displayName:memberNameWithModel(publicMemberIdentity(memberKey)!.displayName,model.modelId),roleKey,
          enabledByDefault:true,defaultForRole:position===0,fallbackPriority:position+1,
          model:{provider:model.provider as 'volcengine-ark-coding-plan'|'volcengine-ark-agent-plan',modelId:model.modelId,plan:model.plan},promptInstruction:''});
      }
    }
    return result;
  }

  public members(roleKey?: V7FixedRoleKey): V7EffectiveMember[] {
    return this.snapshot().members.filter((member) => member.enabled
      && allowedModelProfilesForRole(member.fixedRoleKey).includes(member.modelProfileKey)
      && (roleKey === undefined || member.fixedRoleKey === roleKey))
      .toSorted((left, right) => left.fallbackPriority - right.fallbackPriority);
  }

  /** Every configured seat has a concrete binding; admission remains specific to the task. */
  public connectedMembers(): V7EffectiveMember[] {
    const snapshot=this.snapshot();
    const opening=new Set(this.openingRoster().map(m=>m.memberKey));
    return [...snapshot.members.map(member=>({...member,enabled:member.enabled&&allowedModelProfilesForRole(member.fixedRoleKey).includes(member.modelProfileKey)})),...this.repository.candidateSlots().flatMap(slot=>{
      if(slot.modelProfileKey===null)return [];
      const identity=publicMemberIdentity(slot.memberKey)!;
      const admitted=opening.has(slot.memberKey)||(slot.roleKey==='chief_editor'&&settingReviewRanking().some(r=>r.profileKey===slot.modelProfileKey))||(slot.roleKey==='planning_writer'&&SETTING_DESIGN_PRIORITY.includes(slot.modelProfileKey));
      return [{memberKey:slot.memberKey,displayName:memberNameWithModel(identity.displayName,slot.modelProfileKey),fixedRoleKey:identity.roleKey,
        modelProfileKey:slot.modelProfileKey,model:modelBindingForProfile(slot.modelProfileKey),enabled:admitted,
        enabledByDefault:admitted,defaultForRole:false,fallbackPriority:100,temperatureAdjustment:0,
        promptInstruction:'',governanceRevision:snapshot.revision}];
    })];
  }

  public settingRoster(): import('@wenmi/v7-backend').V7SettingMemberDefinition[] {
    const roster=settingRosterFromGlobal(this.snapshot().members);
    const ranked=settingReviewRanking();
    const eligible=this.connectedMembers().filter(m=>this.credentialReady(m));
    for(const member of eligible){
      const reviewRank=ranked.findIndex(r=>r.profileKey===member.modelProfileKey);
      const designRank=SETTING_DESIGN_PRIORITY.indexOf(member.modelProfileKey);
      const roleKey=member.fixedRoleKey==='chief_editor'&&reviewRank>=0?'chief_editor'
        :member.fixedRoleKey==='planning_writer'&&designRank>=0?'screenwriter':null;
      if(roleKey===null||member.model.plan==='image')continue;
      // Existing administrator off switches remain effective; candidate bindings are node-scoped.
      if(publicMemberIdentity(member.memberKey)?.legacy&&!member.enabled)continue;
      const value: import('@wenmi/v7-backend').V7SettingMemberDefinition={memberKey:member.memberKey,displayName:member.displayName,roleKey,
        publicResponsibility:roleKey==='chief_editor'?'核对明确设定冲突并给出简短修订。':'依据作者资料设计高密度设定。',
        enabledByDefault:true,fallbackPriority:(roleKey==='chief_editor'?reviewRank:designRank)+1,model:member.model};
      const old=roster.findIndex(m=>m.memberKey===member.memberKey);
      if(old>=0)roster[old]=value;else roster.push(value);
    }
    return roster.map(m=>({...m,fallbackPriority:m.roleKey==='screenwriter'
      ? (SETTING_DESIGN_PRIORITY.indexOf(m.model.modelId)<0?100:SETTING_DESIGN_PRIORITY.indexOf(m.model.modelId)+1)
      :m.roleKey==='chief_editor'?(ranked.findIndex(r=>r.profileKey===m.model.modelId)<0?100:ranked.findIndex(r=>r.profileKey===m.model.modelId)+1):m.fallbackPriority}));
  }

  public fallback(roleKey: V7FixedRoleKey, selectedMemberKey?: string, excludeModelProfileKey?: string): V7EffectiveMember[] {
    const candidates = this.members(roleKey).filter((member) => member.modelProfileKey !== excludeModelProfileKey);
    const selected = selectedMemberKey === undefined ? undefined : candidates.find((member) => member.memberKey === selectedMemberKey);
    if (selectedMemberKey !== undefined && selected === undefined) throw new DomainError(errorCodes.validation, '选择的成员不在当前岗位或正在请假。');
    const defaultMember = candidates.find((member) => member.defaultForRole) ?? candidates[0];
    if (defaultMember === undefined) throw new DomainError('V7_AGENT_GOVERNANCE_CONFLICT', '当前岗位没有可接单成员。', {}, true, 409);
    const seen = new Set<string>();
    return [selected, defaultMember, ...candidates].filter((member): member is V7EffectiveMember => member !== undefined).filter((member) => {
      if (seen.has(member.modelProfileKey)) return false;
      seen.add(member.modelProfileKey);
      return this.credentialReady(member);
    });
  }

  public reviewersFor(writer: V7EffectiveMember): V7EffectiveMember[] {
    return independentReviewers(writer, this.members('independent_reviewer')) as V7EffectiveMember[];
  }

  public taskSnapshot(member: V7EffectiveMember, taskKind: V7AgentTaskKind): V7AgentTaskSnapshot {
    const state = this.snapshot();
    const policy = state.taskPolicies.find((candidate) => candidate.taskKind === taskKind);
    if (policy === undefined) throw new Error(`任务温度策略不存在：${taskKind}`);
    const temperature = Math.round(Math.min(policy.maximumTemperature,
      Math.max(policy.minimumTemperature, policy.defaultTemperature + member.temperatureAdjustment)) * 100) / 100;
    return {
      memberKey: member.memberKey,
      displayName: member.displayName,
      fixedRoleKey: member.fixedRoleKey,
      modelProfileKey: member.modelProfileKey,
      model: { ...member.model },
      taskKind,
      temperature,
      governanceRevision: state.revision,
      createdAt: this.clock.now().toISOString()
    };
  }

  public adminView(): object {
    const snapshot = this.snapshot();
    const openingMembers=this.openingRoster();
    const settingMembers=this.settingRoster().filter(m=>m.roleKey!=='deputy_editor'&&m.fallbackPriority<100);
    const candidates = this.repository.candidateSlots().map(slot => {
      const identity = publicMemberIdentity(slot.memberKey)!;
      const model = slot.modelProfileKey === null ? null : modelBindingForProfile(slot.modelProfileKey);
      return {
        memberKey: slot.memberKey, displayName: memberNameWithModel(identity.displayName,slot.modelProfileKey), roleKey: identity.roleKey,
        modelProfileKey: slot.modelProfileKey, modelName: slot.modelProfileKey === null ? '未绑定模型' : V7_MODEL_PROFILE_LABELS[slot.modelProfileKey],
        provider: model?.provider ?? null, plan: model?.plan ?? null,
        enabled: false, defaultForRole: false, fallbackPriority: 100, temperatureAdjustment: 0,
        credentialReady: model !== null && this.credentialReady({ model }),
        configurationOnly: true,
        openingNode: openingMembers.find(member=>member.memberKey===slot.memberKey)?.roleKey ?? null,
        settingNode: settingMembers.find(member=>member.memberKey===slot.memberKey)?.roleKey ?? null,
        admission: { status: 'pending', reason: openingMembers.some(member=>member.memberKey===slot.memberKey)
          ? '已通过开书节点测试并按速度接单；其他节点仍待验证。解绑模型可停止本节点接单。' : settingMembers.some(member=>member.memberKey===slot.memberKey)
          ? '已接入设定节点；审查按合格成绩排序，设计按作者指定优先级。解绑模型可停止接单。' : slot.modelProfileKey === null
          ? '预留成员，可随时绑定同类型模型。' : '模型已绑定；待全书、卷等具体节点验证后接单，当前不会自动参与作者任务。' },
        status: slot.modelProfileKey === null ? 'unbound' : settingMembers.some(member=>member.memberKey===slot.memberKey)||openingMembers.some(member=>member.memberKey===slot.memberKey)?'on_duty':'candidate'
      };
    });
    return {
      revision: snapshot.revision,
      openingEvaluation: OPENING_EVALUATION_REPORT,
      settingEvaluation: SETTING_EVALUATION_REPORT,
      settingSelection: this.settingRoster().filter(m=>m.roleKey!=='deputy_editor'&&m.fallbackPriority<100).map(m=>({memberKey:m.memberKey,roleKey:m.roleKey,modelId:m.model.modelId,order:m.fallbackPriority})),
      openingSelection: openingMembers.map(member=>({memberKey:member.memberKey,roleKey:member.roleKey,modelId:member.model.modelId,order:member.fallbackPriority})),
      summary: {
        roleCount: V7_ROLE_CONTRACTS.length,
        memberCount: MEMBER_SLOTS.length,
        onDutyCount: snapshot.members.filter((member) => this.onDuty(member)).length + candidates.filter(member => member.status === 'on_duty' && member.credentialReady).length,
        leaveCount: snapshot.members.filter((member) => !this.onDuty(member)).length,
        candidateCount: candidates.filter(member => member.status === 'candidate').length,
        unboundCount: candidates.filter(member => member.modelProfileKey === null).length
      },
      credentials: this.credentials,
      modelProfiles: Object.entries(V7_MODEL_PROFILE_LABELS).map(([profileKey, publicName]) => ({ profileKey, publicName })),
      roles: V7_ROLE_CONTRACTS.map((role) => ({
        ...role,
        allowedModelProfileKeys: allowedModelProfilesForRole(role.roleKey),
        modelCandidates: candidateModelProfilesForRole(role.roleKey).map((profileKey) => ({
          profileKey, publicName: V7_MODEL_PROFILE_LABELS[profileKey],
          ...modelAdmissionForRole(role.roleKey, profileKey)
        })),
        members: [...snapshot.members.filter((member) => member.fixedRoleKey === role.roleKey)
          .toSorted((left, right) => left.fallbackPriority - right.fallbackPriority)
          .map((member) => ({
            memberKey: member.memberKey,
            displayName: member.displayName,
            modelProfileKey: member.modelProfileKey,
            modelName: V7_MODEL_PROFILE_LABELS[member.modelProfileKey] ?? member.modelProfileKey,
            provider: member.model.provider,
            plan: member.model.plan,
            enabled: member.enabled,
            defaultForRole: member.defaultForRole,
            fallbackPriority: member.fallbackPriority,
            temperatureAdjustment: member.temperatureAdjustment,
            credentialReady: this.credentialReady(member),
            settingNode: settingMembers.find(candidate=>candidate.memberKey===member.memberKey)?.roleKey ?? null,
            admission: modelAdmissionForRole(role.roleKey, member.modelProfileKey),
            status: this.onDuty(member) ? 'on_duty' : 'on_leave'
          })), ...candidates.filter(member => member.roleKey === role.roleKey)]
      })),
      taskPolicies: snapshot.taskPolicies
    };
  }

  public updateMember(actorId: string, memberKey: string, body: Record<string, unknown>): object {
    const slot = publicMemberIdentity(memberKey);
    if (slot && !slot.legacy) {
      if (Object.keys(body).some(key => !['expectedRevision','modelProfileKey','reason'].includes(key))) {
        throw new DomainError(errorCodes.validation, '新成员须先完成业务节点验证，目前仅开放模型绑定和解绑。');
      }
      const expectedRevision = requiredInteger(body.expectedRevision, '配置版本无效');
      const modelProfileKey = body.modelProfileKey === null ? null : optionalText(body.modelProfileKey,100);
      if (modelProfileKey === undefined) throw new DomainError(errorCodes.validation, '请选择要绑定的模型。');
      try {
        this.repository.updateCandidateSlot({ memberKey, modelProfileKey, expectedRevision, actorId,
          eventId: this.ids.next(), reason: optionalText(body.reason,1000) ?? '管理员调整候选成员模型', now: this.clock.now().toISOString() });
        return this.adminView();
      } catch (error) { throw governanceError(error); }
    }
    const snapshot = this.snapshot();
    const target = snapshot.members.find((member) => member.memberKey === memberKey);
    if (target === undefined) throw new DomainError(errorCodes.validation, '成员不存在。');
    const expectedRevision = requiredInteger(body.expectedRevision, '配置版本无效');
    const modelProfileKey = optionalText(body.modelProfileKey, 100);
    if (modelProfileKey !== undefined && !candidateModelProfilesForRole(target.fixedRoleKey).includes(modelProfileKey)) {
      throw new DomainError(errorCodes.validation, '这个模型类型不适合当前固定岗位。');
    }
    const temperatureAdjustment = optionalNumber(body.temperatureAdjustment, -.2, .2);
    const fallbackPriority = optionalInteger(body.fallbackPriority, 1, 100);
    if (body.promptInstruction !== undefined) {
      throw new DomainError(
        errorCodes.validation,
        '成员不再保存永久补充提示，请在提示词与上下文中心调整岗位、工位或题材人设版本。'
      );
    }
    const enabled = optionalBoolean(body.enabled);
    const defaultForRole = optionalBoolean(body.defaultForRole);
    const nextProfile = modelProfileKey ?? target.modelProfileKey;
    const nextEnabled = defaultForRole === true || (enabled ?? target.enabled);
    const admission = modelAdmissionForRole(target.fixedRoleKey, nextProfile);
    // A passed opening node may resume an existing binding without granting a
    // global default or changing the model. Other node rosters retain their gates.
    const verifiedOpeningResume = enabled === true && modelProfileKey === undefined
      && defaultForRole !== true && target.fixedRoleKey === 'planning_writer'
      && openingRanking('design').some(row => row.profileKey === nextProfile);
    if (nextEnabled && (modelProfileKey !== undefined || enabled === true || defaultForRole === true)
      && admission.status !== 'compatible' && !verifiedOpeningResume) {
      throw new DomainError(errorCodes.validation, admission.reason + ' 请先停岗，再保存候选模型，验证后方可启用。');
    }
    // A mutable model binding must not silently remove the last independent
    // handoff/review option or leave a configured default absent from runtime.
    const roleMembers = snapshot.members.filter((member) => member.fixedRoleKey === target.fixedRoleKey);
    const executableProfiles = (members: typeof roleMembers) => new Set(members.filter((member) =>
      member.enabled && allowedModelProfilesForRole(member.fixedRoleKey).includes(member.modelProfileKey))
      .map((member) => member.modelProfileKey));
    const projected = roleMembers.map((member) => member.memberKey === memberKey
      ? { ...member, enabled: nextEnabled, modelProfileKey: nextProfile } : member);
    const minimum = Math.min(2, executableProfiles(roleMembers).size);
    if (executableProfiles(projected).size < minimum) {
      throw new DomainError(errorCodes.validation, '此次调整会使当前岗位失去必要的异模型交接；请先为另一位固定成员配置可用模型。');
    }
    const reason = optionalText(body.reason, 1000) ?? '管理员调整V7成员';
    try {
      const patch: Parameters<V7AgentGovernanceRepository['updateMember']>[0] = {
        memberKey, expectedRevision, actorId, eventId: this.ids.next(), reason, now: this.clock.now().toISOString()
      };
      if (modelProfileKey !== undefined) patch.modelProfileKey = modelProfileKey;
      if (temperatureAdjustment !== undefined) patch.temperatureAdjustment = temperatureAdjustment;
      if (fallbackPriority !== undefined) patch.fallbackPriority = fallbackPriority;
      if (enabled !== undefined) patch.enabled = enabled;
      if (defaultForRole !== undefined) patch.defaultForRole = defaultForRole;
      const result = this.repository.updateMember(patch);
      return this.adminViewFrom(result);
    } catch (error) {
      throw governanceError(error);
    }
  }

  public updateTaskPolicy(actorId: string, taskKind: V7AgentTaskKind, body: Record<string, unknown>): object {
    const expectedRevision = requiredInteger(body.expectedRevision, '配置版本无效');
    const defaultTemperature = requiredNumber(body.defaultTemperature, 0, 1, '任务温度无效');
    const reason = optionalText(body.reason, 1000) ?? '管理员调整V7任务温度';
    try {
      const result = this.repository.updateTaskPolicy({ taskKind, expectedRevision, defaultTemperature, actorId,
        eventId: this.ids.next(), reason, now: this.clock.now().toISOString() });
      return this.adminViewFrom(result);
    } catch (error) {
      throw governanceError(error);
    }
  }

  private adminViewFrom(_snapshot: V7AgentGovernanceSnapshot): object {
    return this.adminView();
  }

  private credentialReady(member: Pick<V7EffectiveMember, 'model'>): boolean {
    if (member.model.plan === 'coding') return this.credentials.codingPlan;
    if (member.model.plan === 'image') return this.credentials.image;
    return this.credentials.agentPlan;
  }

  private onDuty(member: V7EffectiveMember): boolean {
    return member.enabled && this.credentialReady(member)
      && allowedModelProfilesForRole(member.fixedRoleKey).includes(member.modelProfileKey);
  }
}

function governanceError(error: unknown): DomainError {
  if (error instanceof DomainError) return error;
  const message = error instanceof Error ? error.message : '成员配置保存失败';
  const conflict = message.includes('刚刚') || message.includes('接班') || message.includes('至少保留');
  return new DomainError(conflict ? 'V7_AGENT_GOVERNANCE_CONFLICT' : errorCodes.validation, message, {}, conflict, conflict ? 409 : 400);
}

function requiredInteger(value: unknown, message: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1) throw new DomainError(errorCodes.validation, message);
  return value;
}
function optionalInteger(value: unknown, min: number, max: number): number | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max) throw new DomainError(errorCodes.validation, '顺序无效。');
  return value;
}
function requiredNumber(value: unknown, min: number, max: number, message: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) throw new DomainError(errorCodes.validation, message);
  return value;
}
function optionalNumber(value: unknown, min: number, max: number): number | undefined {
  if (value === undefined) return undefined;
  return requiredNumber(value, min, max, '成员温度微调无效。');
}
function optionalBoolean(value: unknown): boolean | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'boolean') throw new DomainError(errorCodes.validation, '成员状态无效。');
  return value;
}
function optionalText(value: unknown, max: number, allowEmpty = false): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'string') throw new DomainError(errorCodes.validation, '文字内容无效。');
  const result = value.trim();
  if ((!allowEmpty && result.length === 0) || Array.from(result).length > max) throw new DomainError(errorCodes.validation, '文字内容长度无效。');
  return result;
}
import { memberNameWithModel } from '@wenmi/agent-catalog';
