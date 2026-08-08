import { RecordCollection, isRecord } from '../shared/StructuredContent';

export function RightsWorkspace({ data }: { data: unknown }): React.JSX.Element {
  const records = Array.isArray(data) ? data.filter(isRecord) : [];
  return <section className="reference-view rights-workspace"><header><h2>版权与研究</h2><p>受版权保护的原文不会直接交给主笔仿写；联网和人工提供的资料会保留来源，确认前不会成为正式内容。</p></header><RecordCollection records={records} empty="当前没有版权或研究记录，也不会假装查到近期联网资料。" /></section>;
}

