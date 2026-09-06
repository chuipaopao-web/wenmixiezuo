import { editorialDepartmentSchema, type EditorialDepartment } from "@wenmi-rebuild/contracts";
import type { AccountCoreService } from "../accounts/index.js";

type EditorialDepartmentRole =
  | "chief_editor"
  | "deputy_editor"
  | "planning_writer"
  | "lead_writer"
  | "independent_reviewer"
  | "continuity_editor"
  | "visual_renderer";

interface RoleContract {
  readonly roleKey: EditorialDepartmentRole;
  readonly departmentName: string;
  readonly publicName: string;
  readonly publicResponsibility: string;
  readonly capabilities: readonly string[];
}

interface EditorialMemberDefinition {
  readonly memberKey: string;
  readonly displayName: string;
  readonly roleKey: EditorialDepartmentRole;
}

const UNAVAILABLE_STATUS = "团队资料已同步，新后端生成接单还在接入中。";

const ROLE_CONTRACTS: readonly RoleContract[] = [
  role("chief_editor", "主编室", "主编", "主持任务、派单、设计全书粗路线、比较方案并作最终专业判断。", [
    "理解作者意图",
    "拆分任务",
    "比较方案",
    "发现冲突",
    "给出可执行结论"
  ]),
  role("deputy_editor", "副编室", "副编", "整理本次需要的资料，标注依据和不确定处，再交给创作成员。", [
    "语义筛选",
    "资料转译",
    "证据标注",
    "上下文压缩",
    "冲突预警"
  ]),
  role("planning_writer", "策划编剧组", "策划编剧", "设计开书、设定、全书路线、卷、链和章纲等未来方案。", [
    "创意方案",
    "结构规划",
    "人物设计",
    "商业节奏",
    "题材适配",
    "大白话表达"
  ]),
  role("lead_writer", "主笔组", "主笔", "依据确认章纲和正式资料创作正文，不擅自改变上游事实。", [
    "场景写作",
    "人物对白",
    "叙事节奏",
    "情绪兑现",
    "文风执行",
    "连续性遵守"
  ]),
  role("independent_reviewer", "独立审查组", "独立审查", "独立检查正文的事实、连续性、人物、节奏与阅读质量。", [
    "事实核对",
    "连续性审查",
    "人物审查",
    "文学质量审查",
    "商业阅读审查"
  ]),
  role("continuity_editor", "资料记录组", "记录编辑", "在正文落定后及时维护人物、事实、关系、故事线、伏笔和结算记录。", [
    "增量提取",
    "事实去重",
    "人物状态维护",
    "故事线维护",
    "伏笔维护",
    "开放问题维护"
  ]),
  role("visual_renderer", "封面制作组", "视觉编剧", "严格按视觉工单生成封面图并保存可下载成品。", [
    "图像生成",
    "尺寸适配",
    "风格执行",
    "文字区域保留"
  ])
] as const;

/*
 * Copied from the legacy V7 global roster public identities in
 * D:/wenmixiezuo/coauthoring-v7/backend/agent-governance/agent-governance-registry.ts.
 * Model providers, model ids, plan names, prompt instructions, credentials, and runtime
 * configuration are intentionally not copied into this rebuild author-facing projection.
 */
const MEMBERS: readonly EditorialMemberDefinition[] = [
  member("chief-deepseek-v4-pro", "貂蝉", "chief_editor"),
  member("chief-glm-5-3", "顾承砚", "chief_editor"),
  member("chief-kimi-k3", "沈知微", "chief_editor"),
  member("deputy-glm-5-3", "西施", "deputy_editor"),
  member("deputy-deepseek-v4-pro", "妙玉", "deputy_editor"),
  member("deputy-kimi-k3", "谢临川", "deputy_editor"),
  member("planner-deepseek-v4-pro", "红玉", "planning_writer"),
  member("planner-glm-5-3", "幼薇", "planning_writer"),
  member("planner-kimi-k3", "苏映棠", "planning_writer"),
  member("planner-doubao-turbo", "陆青禾", "planning_writer"),
  member("writer-deepseek-v4-pro", "司马相如", "lead_writer"),
  member("writer-kimi-k3", "清照", "lead_writer"),
  member("writer-deepseek-v4-flash", "谢道韫", "lead_writer"),
  member("writer-glm-5-3", "曹雪芹", "lead_writer"),
  member("writer-kimi-2-7", "柳永", "lead_writer"),
  member("writer-doubao", "蒲松龄", "lead_writer"),
  member("review-kimi-k3", "周行简", "independent_reviewer"),
  member("review-glm-5-3", "顾清辞", "independent_reviewer"),
  member("review-deepseek-v4-pro", "陆观澜", "independent_reviewer"),
  member("continuity-deepseek-v4-pro", "裴文心", "continuity_editor"),
  member("continuity-glm-5-3", "宋知遥", "continuity_editor"),
  member("continuity-kimi-k3", "沈墨", "continuity_editor"),
  member("visual-seedream", "绘真", "visual_renderer")
] as const;

export class EditorialDepartmentService {
  public constructor(private readonly accounts: AccountCoreService) {}

  public async getEditorialDepartment(sessionToken: string): Promise<EditorialDepartment> {
    await this.accounts.withAuthenticatedSessionTransaction(sessionToken, async () => undefined);
    return editorialDepartmentSchema.parse(createEditorialDepartment());
  }
}

export function createEditorialDepartmentService(accounts: AccountCoreService): EditorialDepartmentService {
  return new EditorialDepartmentService(accounts);
}

export function createEditorialDepartment(): EditorialDepartment {
  const departments = ROLE_CONTRACTS.map((contract) => ({
    departmentKey: contract.roleKey,
    name: contract.departmentName,
    members: MEMBERS.filter((candidate) => candidate.roleKey === contract.roleKey).map((candidate) => ({
      memberKey: candidate.memberKey,
      displayName: candidate.displayName,
      role: contract.publicName,
      responsibility: contract.publicResponsibility,
      capabilities: [...contract.capabilities],
      presence: "leave" as const,
      statusText: UNAVAILABLE_STATUS,
      currentWork: null,
      completedCount: 0
    }))
  }));
  const members = departments.flatMap((department) => department.members);
  return {
    summary: {
      memberCount: members.length,
      readyCount: 0,
      workingCount: 0,
      leaveCount: members.length,
      completedCount: 0
    },
    departments
  };
}

function role(
  roleKey: EditorialDepartmentRole,
  departmentName: string,
  publicName: string,
  publicResponsibility: string,
  capabilities: readonly string[]
): RoleContract {
  return { roleKey, departmentName, publicName, publicResponsibility, capabilities };
}

function member(memberKey: string, displayName: string, roleKey: EditorialDepartmentRole): EditorialMemberDefinition {
  return { memberKey, displayName, roleKey };
}
