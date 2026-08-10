import type { ReactNode } from 'react';
import { workspaceFunctionLabel } from '@wenmi/contracts';
import {
  authorFieldLabel,
  authorFormatScalar,
  toAuthorDisplayValue
} from '../../app/author-presentation';

export function StructuredContent({ value, depth = 0 }: { value: unknown; depth?: number }): React.JSX.Element {
  const visibleValue = depth === 0 ? toAuthorDisplayValue(value) : value;
  if (Array.isArray(visibleValue)) {
    if (visibleValue.length === 0) return <span className="empty-value">暂无</span>;
    return <ul>{visibleValue.slice(0, 30).map((item, index) => <li key={index}>{isRecord(item) || Array.isArray(item) ? <StructuredContent value={item} depth={depth + 1} /> : authorFormatScalar(item)}</li>)}</ul>;
  }
  if (!isRecord(visibleValue)) return <span>{authorFormatScalar(visibleValue)}</span>;
  return <dl className={`structured-content depth-${Math.min(depth, 2)}`}>{Object.entries(visibleValue).slice(0, 40).map(([key, item]) => <div key={key}><dt>{authorFieldLabel(key)}</dt><dd>{isRecord(item) || Array.isArray(item) ? <StructuredContent value={item} depth={depth + 1} /> : authorFormatScalar(item)}</dd></div>)}</dl>;
}

export function EmptyReference({ icon, title, description }: { icon: ReactNode; title: string; description: string }): React.JSX.Element {
  return <div className="view-empty compact">{icon}<h3>{title}</h3>{description && <p>{description}</p>}</div>;
}

export function artifactTypeLabel(type: string): string {
  return ({ creative_plan: workspaceFunctionLabel('framework'), story_bible: workspaceFunctionLabel('basic'), master_outline: '剧情总纲', chapter_outline: '近期章纲', writing_contract: '本章写作要求' } as Record<string, string>)[type] ?? type;
}

export function authorityLabel(status: string): string {
  return ({ active: '当前正式内容', selected: '已确认', approved: '已确认', confirmed: '已确认', candidate: '待确认', proposed: '待确认', derived: '分析结果', archived: '已归档', superseded: '历史稿' } as Record<string, string>)[status] ?? status;
}

export function fieldLabel(key: string): string {
  return ({
    title: '书名', genre: '题材', sourceStatus: '内容来自哪里', summary: '内容摘要', candidates: '待确认内容',
    premise: '核心前提', audience: '目标读者', tone: '整体表达', constraints: '不能改变的要求', confirmedRecommendation: '确认方案', alternatives: '保留备选',
    positioning: '作品定位', worldView: '世界观', worldRules: '世界规则', powerSystem: '力量体系', resourceSystem: '资源体系', equipmentTiers: '装备等级', economicRules: '经济规则', attributeFields: '属性字段', settingCandidates: '成员整理的待确认内容', analysis: '整理结果', notice: '确认说明',
    openingReference: '开书基本资料', storyDirection: '故事方向', worldBackground: '世界观参考', openingBackground: '故事起始背景', stageOne: '第一阶段剧情', fullBookOutline: '全书简介', initialMap: '初始地图', mustFollow: '必须遵守',
    characters: '初始人物', initialOrganizations: '初始势力', mainPlot: '主线', planningHistory: '规划沿革', openQuestions: '开放问题', tags: '主要标签', theme: '主题',
    acts: '推进阶段', coreConflict: '核心冲突', protagonistArc: '主角成长线',
    majorStages: '全书推进阶段', storyPromises: '作品承诺', turningPoint: '关键转折',
    stageNumber: '阶段', chapterRange: '章节范围', mainline: '主线剧情', encounter: '遇到什么',
    resolution: '如何解决', result: '阶段结果', structure: '起承转合', setup: '起',
    development: '承', turn: '转', conclusion: '合', stageSummary: '阶段总结',
    pendingThreads: '待回收信息与伏笔', followUpDirection: '后续方向',
    turningPoints: '关键转折', payoff: '阶段兑现', climax: '阶段高潮',
    startingState: '阶段起始状态', endingDirection: '结局方向',
    goal: '目标', arcs: '故事弧', endingState: '阶段结束状态',
    chapterNumber: '章节', objective: '目标', beats: '场景节拍', hook: '章末钩子', status: '状态', track: '轨道',
    projection_type: '资料类型', chapter_number: '章节', content: '分析内容', sourceIds: '来源', rebuilt_at: '更新时间',
    canonical_name: '名称', entity_type: '类型', aliases: '别名', relation_key: '关系', value: '事实值', evidence: '证据', grade: '证据等级',
    namespace: '标签域', name: '名称', description: '说明', created_source: '创建者', assignment_count: '使用次数', diagnosis: '缺口说明', severity: '严重度',
    intentional_unknown: '刻意留白', narrative_goal: '叙事目标', from_name: '起点', toValue: '终点或值', section: '区域', data: '内容'
  } as Record<string, string>)[key] ?? key.replaceAll('_', ' ');
}

export function isTechnicalField(key: string): boolean {
  return ['owner_id', 'book_id', 'canon_revision', 'canonRevision', 'content_hash', 'model_snapshot_id', 'parameters_json', 'scope_json', 'impact_json', 'outlineSchema', 'storyDirectionAuthority'].includes(key);
}

export function formatValue(value: unknown): string {
  if (value === null || value === undefined || value === '') return '暂无';
  if (typeof value === 'boolean') return value ? '是' : '否';
  if (typeof value === 'number') return new Intl.NumberFormat('zh-CN').format(value);
  return String(value);
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function RecordCollection({ records, empty }: { records: Array<Record<string, unknown>>; empty: string }): React.JSX.Element {
  if (records.length === 0) return <p className="record-empty">{empty}</p>;
  return <div className="record-collection">{records.slice(0, 300).map((record, index) => <article key={String(record.id ?? record.projection_id ?? record.fact_id ?? record.tag_definition_id ?? record.knowledge_gap_id ?? index)}><StructuredContent value={record} /></article>)}</div>;
}

