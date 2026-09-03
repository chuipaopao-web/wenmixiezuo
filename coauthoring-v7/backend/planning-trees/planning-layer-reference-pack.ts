import {
  buildLayerAssetMenu,
  layerAssetEntries,
  planningLayerForTreeKind,
  renderLayerAssetMenuText,
  v7AssetMenuEnabled,
  type LayerAssetEntry
} from '../planning-methods/layer-asset-menu.js';
import type { GenreFamily } from '../plot-patterns/plot-pattern-library.js';
import type { PlanningTreeKind } from './planning-tree-contracts.js';

/**
 * 第86批：规划层资产参考包——由名册生成器确定性装配（菜单文本 + 可引用资产名册），
 * 替代旧的"资料策划语义检索候选卡"。资产只是候选参考，成员可组合、忽略或完全原创；
 * 引用校验（第82批归一逻辑）按名册判定：key 存在、本层已标注、限量、有说明。
 * 原 plotRecipes/plotPatterns 两个死槽随之通电：卷/链层配方提名卡、链层模式名册
 * 都在菜单与名册内，走同一套 libraryRefs 校验。
 */
export interface V7PlanningLayerReferencePack {
  schema: 'v7-planning-layer-reference-pack-v2';
  treeKind: PlanningTreeKind;
  policy: {
    candidateOnly: true;
    libraryUseLimit: number;
    originalStrategyRequired: true;
    instruction: string;
  };
  /** 注入任务输入的菜单文本（提名卡组 + 名册，确定性渲染）。 */
  menuText: string;
  /** 本层可引用资产名册（校验用，不注入提示词）。 */
  allowedAssets: readonly LayerAssetEntry[];
}

export function buildPlanningLayerReferencePack(
  treeKind: PlanningTreeKind,
  genreFamilies: readonly GenreFamily[] = []
): V7PlanningLayerReferencePack {
  const layer = planningLayerForTreeKind(treeKind);
  const libraryUseLimit = treeKind === 'book' ? 3 : treeKind === 'volume' ? 4 : 5;
  // 灰度开关关闭时不注入菜单文本、名册置空：第82批归一逻辑会静默丢弃全部
  // libraryRefs，行为等同"本轮无后台资产"，供对照组使用。
  const enabled = v7AssetMenuEnabled();
  const menu = enabled ? buildLayerAssetMenu(layer, genreFamilies) : null;
  return {
    schema: 'v7-planning-layer-reference-pack-v2',
    treeKind,
    policy: {
      candidateOnly: true,
      libraryUseLimit,
      originalStrategyRequired: true,
      instruction: '这些只是系统按当前层生成的候选资产菜单。成员可以组合、忽略或完全原创，但必须说明本书当前层的具体取舍。'
    },
    menuText: menu === null
      ? '（本轮不注入后台资产菜单；请完全依靠本书人物与处境原创设计。）'
      : renderLayerAssetMenuText(menu),
    allowedAssets: menu === null ? [] : layerAssetEntries(layer, genreFamilies)
  };
}
