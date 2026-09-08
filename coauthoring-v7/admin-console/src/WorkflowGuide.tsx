import type { RebuildUnit } from '../../backend/admin/rebuild-control-types.js';

export function detailText(unit: RebuildUnit, label: string): string | undefined {
  return unit.details.find((item) => item.label === label)?.text;
}

export function WorkflowGuide({ units, onSelect }: { units: RebuildUnit[]; onSelect: (id: string) => void }): React.JSX.Element {
  const nodes = units.filter((unit) => /^\d+$/.test(detailText(unit, '设计·流程序号') ?? ''))
    .sort((a, b) => Number(detailText(a, '设计·流程序号')) - Number(detailText(b, '设计·流程序号')));
  return <section className="workflow-guide" aria-label="全链路AI介入导图">
    <header><h3>全链路 · 谁在什么时候介入</h3><p>设计导览，不是实时任务。节点按主流程排列；修改、补查和复核回到当前节点，人物、命名和封面按需进入。实际实现与发布状态请看功能详情。</p></header>
    <p className="workflow-guide-rule">系统能直接读取的资料直接提供；复杂相关性才交资料编辑。已确认方案与待验证建议分别展示，不把设计说明当成已上线能力。</p>
    {!nodes.length ? <p role="status">当前路线文档尚未登记导图节点，请查看下方开发路线；不会推测AI介入状态。</p> : <ol className="workflow-guide-nodes">{nodes.map((unit) => <li key={unit.id}>
      <button type="button" onClick={() => onSelect(unit.id)}><small>{detailText(unit, '设计·流程序号')} · {unit.id}</small><strong>{unit.name}</strong><span>查看功能与设计 →</span></button>
      <dl>{['系统直供', '资料编辑介入', '执行与复查'].map((label) => <div key={label}><dt>{label}</dt><dd>{detailText(unit, `设计·${label}`) ?? '尚未登记'}</dd></div>)}</dl>
    </li>)}</ol>}
  </section>;
}
