import type { PlanningTreeDocument, PlanningTreeNode } from './planning-tree-contracts.js';

/**
 * Builds the frozen parent contract handed to a child planning layer.
 *
 * The parent Agent already made the semantic decisions, so this transport
 * projection is allowed to preserve those decisions. It deliberately omits
 * the method library, raw deliberation and verbose sibling facets. The current
 * child receives its full hand-off responsibility while adjacent children keep
 * only enough position/outcome information to prevent repeated rhythms.
 */
export function projectPlanningTreeForChild(
  document: PlanningTreeDocument,
  focusChildScopeId?: string
): Record<string, unknown> {
  const projectNode = (node: PlanningTreeNode, detailed: boolean): Record<string, unknown> => {
    const children = node.children.map((child) => {
      const childScopeId = child.linkedTree?.scopeId;
      return projectNode(child, focusChildScopeId === undefined || childScopeId === focusChildScopeId);
    });
    if (!detailed) {
      return {
        key: node.key,
        kind: node.kind,
        sequence: node.sequence,
        title: node.title,
        story: {
          summary: node.story.summary,
          outcome: node.story.outcome,
          nextStep: node.story.nextStep
        },
        linkedTree: node.linkedTree,
        children: []
      };
    }
    return {
      key: node.key,
      kind: node.kind,
      sequence: node.sequence,
      title: node.title,
      story: {
        summary: node.story.summary,
        majorEvents: node.story.majorEvents,
        protagonistChange: node.story.protagonistChange,
        outcome: node.story.outcome,
        nextStep: node.story.nextStep
      },
      experience: {
        publicSummary: node.experience.publicSummary,
        payoffCadence: node.experience.payoffCadence,
        informationRhythm: node.experience.informationRhythm,
        contrastWithPrevious: node.experience.contrastWithPrevious
      },
      causality: {
        trigger: node.causality.trigger,
        coreConflict: node.causality.coreConflict,
        turningPoint: node.causality.turningPoint,
        consequences: node.causality.consequences
      },
      threads: {
        foreshadowing: node.threads.foreshadowing,
        openQuestions: node.threads.openQuestions
      },
      budget: node.budget,
      linkedTree: node.linkedTree,
      children
    };
  };
  return {
    schema: 'v7-planning-tree-context-projection-v2',
    treeKind: document.treeKind,
    scopeId: document.scopeId,
    title: document.title,
    // This is the parent Agent's structured decision record, not textbook
    // content. The child may reuse, combine, ignore or reinterpret it.
    designStrategy: document.designStrategy,
    root: projectNode(document.root, true)
  };
}
