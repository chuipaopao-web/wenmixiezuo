import type { RebuildUnit } from '../../backend/admin/rebuild-control-types.js';

export function detailText(unit: RebuildUnit, label: string): string | undefined {
  return unit.details.find((item) => item.label === label)?.text;
}

export function WorkflowGuide({ units, onSelect, mode = 'main' }: { units: RebuildUnit[]; onSelect: (id: string) => void; mode?: 'main' | 'exceptions' }): React.JSX.Element {
  const nodes = units.filter((unit) => /^\d+$/.test(detailText(unit, '设计·流程序号') ?? ''))
    .sort((a, b) => Number(detailText(a, '设计·流程序号')) - Number(detailText(b, '设计·流程序号')));
  if (mode === 'exceptions') {
    const rules = units.find(unit => unit.id === 'RB-17')?.details.filter(d => d.label.startsWith('设计·异常：')) ?? [];
    return <section className="workflow-guide" aria-label="异常处理规则"><header><h3>异常处理 · 条件成立才进入</h3><p>补查完成返回原任务；无法解决的关键冲突停在原任务，不重新开整条流程。这里展示目标规则，实际执行状态见功能详情。</p></header>
      {!rules.length ? <p role="status">当前文档尚未登记异常规则。</p> : <ol className="workflow-guide-nodes">{rules.map(rule => <li key={rule.label}><h4>{rule.label.replace('设计·异常：','')}</h4><p>{rule.text}</p></li>)}</ol>}
      <button className="rebuild-button" onClick={() => onSelect('RB-17')}>查看资料供给规则详情 →</button></section>;
  }
  return <section className="workflow-guide" aria-label="全链路AI介入导图">
    <header><h3>主流程 · 固定职责</h3><p>开书到正文事实更新是创作主线；人物、命名和管理页面是配套入口，不要求按顺序打开。补查与冲突请切换“异常处理”。这是目标流程，实际改造进度在“全部功能”查看。</p></header>
    <p className="workflow-guide-rule">正常路径：全书、每卷、每链由资料编辑整理一次；其余节点由系统提供指定资料。章纲与正文继承当前链资料包，不另加资料整理调用。</p>
    {!nodes.length ? <p role="status">当前路线文档尚未登记导图节点，请查看下方开发路线；不会推测AI介入状态。</p> : <ol className="workflow-guide-nodes">{nodes.map((unit) => <li key={unit.id}>
      <button type="button" onClick={() => onSelect(unit.id)}><small>{detailText(unit, '设计·流程序号')} · {unit.id}</small><strong>{unit.name}</strong><span>查看功能与设计 →</span></button>
      <p className="workflow-guide-decision">资料编辑 · {detailText(unit, '设计·资料编辑介入') ?? '未登记，不推断'}</p>
      <dl>{['系统直供', '执行成员', '复查成员'].map((label) => <div key={label}><dt>{label}</dt><dd>{detailText(unit, `设计·${label}`) ?? '尚未登记'}</dd></div>)}</dl>
    </li>)}</ol>}
  </section>;
}
