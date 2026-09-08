import { useState } from 'react';
import type { RebuildUnit } from '../../backend/admin/rebuild-control-types.js';

export const AI_NODE_PREFIX = '实际AI节点·';
export function readAiNodes(units: RebuildUnit[]) {
  return units.flatMap(unit => unit.details.filter(d => d.label.startsWith(AI_NODE_PREFIX)).map(d => {
    const [name, role, kind, trigger, source] = d.text.split('｜');
    return { id: d.label.slice(AI_NODE_PREFIX.length), unit, name, role, kind, trigger, source };
  }));
}

export function AiWorkNodes({ units, onSelect }: { units: RebuildUnit[]; onSelect: (id: string) => void }): React.JSX.Element {
  const [query, setQuery] = useState('');
  const [kind, setKind] = useState('全部');
  const nodes = readAiNodes(units);
  const matching = nodes.filter(n => (kind === '全部' || n.kind === kind)
    && `${n.id} ${n.name} ${n.role} ${n.trigger} ${n.unit.name}`.toLowerCase().includes(query.trim().toLowerCase()));
  const groups = units.filter(u => matching.some(n => n.unit.id === u.id));
  return <section className="ai-work-nodes" aria-label="实际AI工作节点">
    <header><h3>AI 工作节点 · 当前代码清单</h3>
      <p>每一行是一种会启动成员工作的步骤。修复、重试、换员也单独列出；同一步可按条目、分页或候选重复执行。节点数量不是一次任务的调用次数，也不是已通过模型测试的数量。</p>
      <p><strong>{nodes.length} 种工作步骤</strong> · 当前显示 {matching.length} 项。登记范围：产品 API、Worker、开书执行器及模型网关；独立命令行测评脚本不属于产品工作流。目标设计请查看“主流程”。</p>
    </header>
    <div className="ai-work-filters"><label>搜索工作节点<input value={query} onChange={e => setQuery(e.target.value)} placeholder="例如：设定、主编、重试、资料" /></label>
      <label>工作类型<select value={kind} onChange={e => setKind(e.target.value)}>{['全部', ...new Set(nodes.map(n => n.kind))].map(k => <option key={k}>{k}</option>)}</select></label></div>
    <nav className="ai-work-jumps" aria-label="按功能定位AI节点">{groups.map(g => <a key={g.id} href={`#ai-${g.id}`}>{g.name} · {matching.filter(n => n.unit.id === g.id).length}</a>)}</nav>
    {!nodes.length ? <p role="status">当前路线尚未登记实际工作节点，不能据此判断软件没有AI调用。</p> : !matching.length ? <p role="status">没有匹配节点。<button onClick={() => { setQuery(''); setKind('全部'); }}>清除筛选</button></p> : groups.map(g => <section id={`ai-${g.id}`} className="ai-work-group" key={g.id} aria-label={`${g.name}的AI节点`}>
      <header><h4>{g.name}</h4><button className="rebuild-button" onClick={() => onSelect(g.id)}>功能详情 →</button></header>
      <ol>{matching.filter(n => n.unit.id === g.id).map(n => <li key={n.id}>
        <div className="ai-work-title"><span>{n.id}</span><strong>{n.name}</strong><em>{n.kind} · 调用模型</em></div>
        <p><b>执行：</b>{n.role}</p><p><b>何时启动：</b>{n.trigger}</p>
        <small>代码依据：{n.source}</small>
      </li>)}</ol>
    </section>)}
    <aside className="ai-work-system"><h4>这些操作不启动 AI</h4><p>登录、权限与版本校验、读取已存资料、数据库检索、字数预算计算、状态轮询、成功结果复用、保存和确认版本、额度记账、任务排队本身均由系统执行。排队后真正执行的模型步骤已列在上面。</p><p>结果未知时只核对或等待，不应当作“失败自动重试”。恢复入口可能直接复用已有结果；只有确实重新执行的分支才产生模型调用。</p></aside>
  </section>;
}
