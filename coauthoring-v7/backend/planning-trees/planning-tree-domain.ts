import {
  V7_PLANNING_TREE_SCHEMA,
  expectedChildKinds,
  expectedRootKind,
  type AuthorPlanningTreeNode,
  type AuthorPlanningTreeView,
  type PlanningNodeActual,
  type PlanningTreeDocument,
  type PlanningTreeNode,
  type PlanningTreeOperation
} from './planning-tree-contracts.js';

const keyPattern = /^[A-Za-z0-9][A-Za-z0-9:_-]{0,127}$/u;

export function validatePlanningTree(document: PlanningTreeDocument): string[] {
  const errors: string[] = [];
  if (document.schema !== V7_PLANNING_TREE_SCHEMA) errors.push('规划树版本不受支持');
  if (!keyPattern.test(document.scopeId)) errors.push('规划树范围标识无效');
  if (!hasText(document.title, 1, 120)) errors.push('规划树标题需要1至120字');
  if (document.root.kind !== expectedRootKind(document.treeKind)) errors.push('规划树根节点类型不正确');
  if (document.root.sequence !== 1) errors.push('规划树根节点顺序必须为1');

  const keys = new Set<string>();
  visit(document.root, undefined, (node, parent) => {
    if (!keyPattern.test(node.key)) errors.push(`节点标识无效：${node.key}`);
    if (keys.has(node.key)) errors.push(`节点标识重复：${node.key}`);
    keys.add(node.key);
    validateNodeContents(node, errors, parent === undefined);
    if (parent === undefined) return;
    if (!expectedChildKinds(document.treeKind).includes(node.kind)) {
      errors.push(`${document.treeKind}树不能包含${node.kind}节点`);
    }
    if (node.children.length > 0) errors.push(`节点${node.key}不能继续嵌套子节点`);
  });
  document.root.children.forEach((child, index) => {
    if (child.sequence !== index + 1) errors.push(`节点${child.key}顺序不连续`);
  });
  if (document.root.children.length === 0) errors.push('规划树至少需要一个下层节点');
  if (document.treeKind === 'book') {
    const endingCount = document.root.children.filter((node) => node.kind === 'ending').length;
    if (endingCount > 1) errors.push('全书树最多只能有一个结局节点');
  }
  return errors;
}

export function assertValidPlanningTree(document: PlanningTreeDocument): void {
  const errors = validatePlanningTree(document);
  if (errors.length > 0) throw new Error(errors.join('；'));
}

export function applyPlanningTreeOperations(
  source: PlanningTreeDocument,
  operations: readonly PlanningTreeOperation[]
): PlanningTreeDocument {
  const next = structuredClone(source);
  for (const operation of operations) {
    if (operation.kind === 'update_node') {
      const node = requireNode(next.root, operation.nodeKey);
      Object.assign(node, structuredClone(operation.changes));
      continue;
    }
    if (operation.kind === 'add_child') {
      const parent = requireNode(next.root, operation.parentKey);
      if (operation.position < 0 || operation.position > parent.children.length) throw new Error('新增位置无效');
      parent.children.splice(operation.position, 0, structuredClone(operation.node));
      normalizeSequences(parent);
      continue;
    }
    if (operation.kind === 'remove_node') {
      if (operation.nodeKey === next.root.key) throw new Error('不能删除规划树根节点');
      const parent = findParent(next.root, operation.nodeKey);
      if (parent === null) throw new Error(`规划节点不存在：${operation.nodeKey}`);
      parent.children = parent.children.filter((node) => node.key !== operation.nodeKey);
      normalizeSequences(parent);
      continue;
    }
    const parent = requireNode(next.root, operation.parentKey);
    if (operation.orderedNodeKeys.length !== parent.children.length) throw new Error('重排节点数量不一致');
    const currentKeys = new Set(parent.children.map((node) => node.key));
    if (new Set(operation.orderedNodeKeys).size !== currentKeys.size || operation.orderedNodeKeys.some((key) => !currentKeys.has(key))) {
      throw new Error('重排只能包含当前直接子节点');
    }
    const byKey = new Map(parent.children.map((node) => [node.key, node]));
    parent.children = operation.orderedNodeKeys.map((key) => {
      const child = byKey.get(key);
      if (child === undefined) throw new Error(`重排节点不存在：${key}`);
      return child;
    });
    normalizeSequences(parent);
  }
  assertValidPlanningTree(next);
  return next;
}

export function buildAuthorPlanningTreeView(input: {
  document: PlanningTreeDocument;
  revision: number;
  status: 'candidate' | 'confirmed';
  actuals: readonly PlanningNodeActual[];
}): AuthorPlanningTreeView {
  const actualByNode = new Map(input.actuals.map((item) => [item.nodeKey, item]));
  return {
    treeKind: input.document.treeKind,
    scopeId: input.document.scopeId,
    revision: input.revision,
    status: input.status,
    title: input.document.title,
    root: projectNode(input.document.root, actualByNode)
  };
}

export function containsNode(root: PlanningTreeNode, nodeKey: string): boolean {
  let found = false;
  visit(root, undefined, (node) => { if (node.key === nodeKey) found = true; });
  return found;
}

function projectNode(node: PlanningTreeNode, actualByNode: ReadonlyMap<string, PlanningNodeActual>): AuthorPlanningTreeNode {
  const actual = actualByNode.get(node.key);
  return {
    ...structuredClone(node),
    actual: actual === undefined ? null : {
      state: actual.state,
      summary: actual.summary,
      emotionResult: actual.emotionResult,
      experienceResult: actual.experienceResult,
      outcome: actual.outcome,
      recordedAt: actual.recordedAt
    },
    children: node.children.map((child) => projectNode(child, actualByNode))
  };
}

function validateNodeContents(node: PlanningTreeNode, errors: string[], isRoot: boolean): void {
  if (!hasText(node.title, 1, 120)) errors.push(`节点${node.key}标题需要1至120字`);
  if (!hasText(node.story.summary, 1, 2_000)) errors.push(`节点${node.key}缺少剧情概要`);
  if (!hasText(node.story.protagonistChange, 1, 1_000)) errors.push(`节点${node.key}缺少主角变化`);
  if (!hasText(node.story.outcome, 1, 1_000)) errors.push(`节点${node.key}缺少阶段结果`);
  if (!hasText(node.story.nextStep, 1, 1_000)) errors.push(`节点${node.key}缺少下一步衔接`);
  for (const [field, value] of Object.entries(node.emotion)) {
    if (!hasText(value, 1, 1_000)) errors.push(`节点${node.key}缺少情绪体验${field}`);
  }
  if (!hasText(node.emotion.intensity, 1, 1_000)) errors.push(`节点${node.key}缺少情绪强度`);
  for (const [field, value] of Object.entries(node.experience)) {
    if (!hasText(value, 1, 1_000)) errors.push(`节点${node.key}缺少阅读体验${field}`);
  }
  if (!hasText(node.causality.trigger, 1, 1_000)) errors.push(`节点${node.key}缺少触发原因`);
  if (!hasText(node.causality.coreConflict, 1, 1_000)) errors.push(`节点${node.key}缺少核心冲突`);
  if (!hasText(node.causality.turningPoint, 1, 1_000)) errors.push(`节点${node.key}缺少局面转折`);
  for (const value of [
    ...node.story.majorEvents,
    ...node.causality.causes,
    ...node.causality.consequences,
    ...node.threads.foreshadowing,
    ...node.threads.openQuestions
  ]) {
    if (!hasText(value, 1, 1_000)) errors.push(`节点${node.key}包含空白或过长条目`);
  }
  if (node.budget.wordTarget !== null && (!Number.isInteger(node.budget.wordTarget) || node.budget.wordTarget < 1)) {
    errors.push(`节点${node.key}字数目标无效`);
  }
  if (node.budget.chapterRange !== null) {
    const [start, end] = node.budget.chapterRange;
    if (!Number.isInteger(start) || !Number.isInteger(end) || start < 1 || end < start) errors.push(`节点${node.key}章节范围无效`);
  }
  if (!isRoot && node.kind === 'volume') {
    if (node.linkedTree?.treeKind !== 'volume' || !keyPattern.test(node.linkedTree.scopeId)) errors.push(`卷节点${node.key}缺少对应单卷树`);
  } else if (!isRoot && node.kind === 'chain') {
    if (node.linkedTree?.treeKind !== 'chain' || !keyPattern.test(node.linkedTree.scopeId)) errors.push(`链节点${node.key}缺少对应单元链树`);
  } else if (node.linkedTree !== null) {
    errors.push(`节点${node.key}不能引用下层树`);
  }
}

function normalizeSequences(parent: PlanningTreeNode): void {
  parent.children.forEach((child, index) => { child.sequence = index + 1; });
}

function requireNode(root: PlanningTreeNode, key: string): PlanningTreeNode {
  let match: PlanningTreeNode | null = null;
  visit(root, undefined, (node) => { if (node.key === key) match = node; });
  if (match === null) throw new Error(`规划节点不存在：${key}`);
  return match;
}

function findParent(root: PlanningTreeNode, nodeKey: string): PlanningTreeNode | null {
  let result: PlanningTreeNode | null = null;
  visit(root, undefined, (node, parent) => { if (node.key === nodeKey) result = parent ?? null; });
  return result;
}

function visit(
  node: PlanningTreeNode,
  parent: PlanningTreeNode | undefined,
  callback: (node: PlanningTreeNode, parent: PlanningTreeNode | undefined) => void
): void {
  callback(node, parent);
  for (const child of node.children) visit(child, node, callback);
}

function hasText(value: unknown, min: number, max: number): boolean {
  if (typeof value !== 'string') return false;
  const length = Array.from(value.trim()).length;
  return length >= min && length <= max;
}
