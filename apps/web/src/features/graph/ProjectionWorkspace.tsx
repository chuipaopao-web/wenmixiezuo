import { useState } from 'react';
import { TreeStructureIcon } from '@phosphor-icons/react';
import type { GraphWorkspaceData } from '../../lib/api/client';
import { KnowledgeGraph } from '../library/LibraryWorkspace';
import { EmptyReference, isRecord } from '../shared/StructuredContent';

type GraphTab = 'relations' | 'emotion' | 'hook' | 'information_gap';

export function ProjectionWorkspace({ data }: { data: unknown }): React.JSX.Element {
  const [tab, setTab] = useState<GraphTab>('relations');
  const graph = isGraphWorkspaceData(data) ? data : { relations: [], projections: [] };
  const tabs: Array<[GraphTab, string]> = [['relations', '人物关系'], ['emotion', '情绪'], ['hook', '钩子与伏笔'], ['information_gap', '信息差']];
  const records = graph.projections.filter((record) => record.projection_type === tab);
  return <section className="reference-view projection-workspace"><header><h2>剧情关系</h2><p>这里集中查看人物关系、情绪、钩子、伏笔和谁知道什么。</p></header>
    <nav className="secondary-tabs" aria-label="图谱分类">{tabs.map(([key, label]) => <button type="button" className={tab === key ? 'active' : ''} key={key} onClick={() => setTab(key)}>{label}</button>)}</nav>
    {tab === 'relations' ? <KnowledgeGraph records={graph.relations} /> : <ProjectionTracks records={records} />}
  </section>;
}

function ProjectionTracks({ records }: { records: Array<Record<string, unknown>> }): React.JSX.Element {
  if (records.length === 0) return <EmptyReference icon={<TreeStructureIcon />} title="当前没有可展示内容" description="只有资料中明确记录的内容才会显示；系统不会为了填满图谱而猜测。" />;
  const ordered = [...records].sort((left, right) => {
    const leftChapter = Number(left.chapter_number ?? left.chapterNumber ?? 0);
    const rightChapter = Number(right.chapter_number ?? right.chapterNumber ?? 0);
    if (leftChapter !== rightChapter) return leftChapter - rightChapter;
    return String(left.track) === 'planned' ? -1 : 1;
  });
  return <div className="projection-summary-list" role="list">
    {ordered.map((record, index) => <NarrativeProjectionCard key={String(record.projection_id ?? index)} record={record} />)}
  </div>;
}

function NarrativeProjectionCard({ record }: { record: Record<string, unknown> }): React.JSX.Element {
  const content = projectionContent(record);
  const type = String(record.projection_type ?? '');
  const scopeLabel = readableProjectionText(content.scopeLabel) ?? chapterProjectionLabel(record);
  const track = String(record.track) === 'actual' ? '已发生' : '规划';
  return <article className={`projection-summary-card ${type}`} role="listitem">
    <header><strong>{scopeLabel}</strong><span>{track}</span></header>
    {type === 'emotion' && <EmotionProjection content={content} />}
    {type === 'mainline' && <MainlineProjection content={content} />}
    {type === 'subplot' && <p>{readableProjectionText(content.summary) ?? '暂无简要说明'}</p>}
    {type === 'hook' && <HookProjection content={content} />}
    {type === 'information_gap' && <InformationGapProjection content={content} />}
  </article>;
}

function EmotionProjection({ content }: { content: Record<string, unknown> }): React.JSX.Element {
  const flow = projectionTextList(content.emotionFlow);
  const baseline = readableProjectionText(content.baseline);
  return <div className="emotion-projection">
    {flow.length > 0 && <p className="emotion-flow">{flow.join(' → ')}</p>}
    {baseline !== null && <span className="projection-tone">{baseline}</span>}
    {readableProjectionText(content.summary) !== null && <p>{readableProjectionText(content.summary)}</p>}
  </div>;
}

function MainlineProjection({ content }: { content: Record<string, unknown> }): React.JSX.Element {
  const summary = readableProjectionText(content.summary) ?? '暂无简要说明';
  const result = readableProjectionText(content.result);
  return <div><p>{summary}</p>{result !== null && !summary.includes(result) && <p className="projection-result">结果：{result}</p>}</div>;
}

function HookProjection({ content }: { content: Record<string, unknown> }): React.JSX.Element {
  const items = Array.isArray(content.items) ? content.items.filter(isRecord) : [];
  return <ul className="projection-item-list">{items.map((item, index) => {
    const kind = readableProjectionText(item.kind) ?? '钩子';
    const status = readableProjectionText(item.status) ?? '已记录';
    const summary = readableProjectionText(item.summary) ?? '暂无简要说明';
    return <li key={`${kind}-${status}-${index}`}><span>{kind} · {status}</span><p>{summary}</p></li>;
  })}</ul>;
}

function InformationGapProjection({ content }: { content: Record<string, unknown> }): React.JSX.Element {
  const items = Array.isArray(content.items) ? content.items.filter(isRecord) : [];
  return <ul className="projection-item-list information-gap-list">{items.map((item, index) => {
    const knowers = projectionTextList(item.knowers);
    const unaware = projectionTextList(item.unaware);
    return <li key={`${readableProjectionText(item.summary) ?? '信息差'}-${index}`}>
      <p>{readableProjectionText(item.summary) ?? '暂无简要说明'}</p>
      <small>知道：{knowers.join('、')}　不知道：{unaware.join('、')}　读者：{readableProjectionText(item.readerState) ?? '未说明'}</small>
    </li>;
  })}</ul>;
}

function projectionContent(record: Record<string, unknown>): Record<string, unknown> {
  const raw = record.content ?? record.content_json;
  if (isRecord(raw)) return raw;
  if (typeof raw !== 'string') return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    return isRecord(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function projectionTextList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    const text = readableProjectionText(item);
    return text === null ? [] : [text];
  }).slice(0, 20);
}

function readableProjectionText(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const text = value.replace(/\s+/gu, ' ').trim();
  return text.length > 0 ? text : null;
}

function chapterProjectionLabel(record: Record<string, unknown>): string {
  const chapter = Number(record.chapter_number ?? record.chapterNumber);
  return Number.isInteger(chapter) && chapter > 0 ? `第${chapter}章` : '故事阶段';
}

function isGraphWorkspaceData(value: unknown): value is GraphWorkspaceData {
  return isRecord(value) && Array.isArray(value.relations) && Array.isArray(value.projections);
}

