import { describe, expect, it } from "vitest";
import { editorialDepartmentSchema } from "@wenmi-rebuild/contracts";
import { createEditorialDepartment } from "@wenmi-rebuild/backend";

describe("editorial department projection", () => {
  it("returns the full legacy-compatible public roster without exposing model configuration", () => {
    const view = editorialDepartmentSchema.parse(createEditorialDepartment());

    expect(view.summary).toEqual({
      memberCount: 23,
      readyCount: 0,
      workingCount: 0,
      leaveCount: 23,
      completedCount: 0
    });
    expect(view.departments.map((department) => department.departmentKey)).toEqual([
      "chief_editor",
      "deputy_editor",
      "planning_writer",
      "lead_writer",
      "independent_reviewer",
      "continuity_editor",
      "visual_renderer"
    ]);
    expect(view.departments.map((department) => department.members.length)).toEqual([3, 3, 4, 6, 3, 3, 1]);
    expect(view.departments.flatMap((department) => department.members.map((member) => [member.memberKey, member.displayName]))).toContainEqual([
      "visual-seedream",
      "绘真"
    ]);
    expect(view.departments.every((department) => department.members.every((member) => member.presence === "leave"))).toBe(true);

    const publicText = JSON.stringify(view);
    expect(publicText).not.toMatch(/provider|modelId|volcengine|ark|coding\s*plan|agent\s*plan|promptInstruction|temperature|api[_-]?key/iu);
    expect(publicText).toContain("新后端生成接单还在接入中");
  });
});
