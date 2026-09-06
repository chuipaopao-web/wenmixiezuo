import type { V7PromptAssetSummary, V7PromptManifestDetail } from './platform-api';

const STAGES = [
  ['首次设计', '设计成员', '作者最初想法、平台、分类目录和本次选中的少量方法参考。没有上一份方案。'],
  ['作者调整', '设计成员修改 → 异模型主编审查', '原始想法、作者当前编辑的资料、调整意见、已处理的决定及当前审查。新意见优先于被明确修改的旧要求。'],
  ['换成员重做', '选中的设计成员 → 异模型主编审查', '从原始想法建立新任务，不传入上一份方案和未提交的调整意见。旧任务归档留存。'],
  ['独立审查', '异模型主编', '原始想法、最新候选及作者调整要求；不读取设计成员的思考过程。']
];
const OPENING_KEYS = ['workstation.opening', 'role.planning_writer', 'role.chief_editor', 'skill.intent-translation', 'skill.genre-fusion', 'skill.evidence-review'];

export function OpeningContextGuide({ assets, onEdit, onTraces, sample = null, sampleLoading = false, onSample }: {
  assets: V7PromptAssetSummary[]; onEdit: (key: string) => void; onTraces: () => void;
  sample?: V7PromptManifestDetail | null; sampleLoading?: boolean; onSample?: () => void;
}) {
  return <section className="opening-context-guide" aria-label="开书流程与资料">
    <h2>开书基础通用配置</h2>
    <p>管理所有用户共用的岗位要求、资料选择原则和创作审查流程。真实用户的资料只作为只读样例，不在这里逐人配置或修改。</p>
    <p>使用同一套版本配置：保存草稿 → 检查编译结果 → 发布。实际执行与技术重试保留原快照，历史记录不能改写。</p>
    <div className="opening-context-assets">{OPENING_KEYS.map(key => {
      const asset = assets.find(item => item.assetKey === key);
      const current = asset?.published;
      return <button key={key} type="button" disabled={!asset} onClick={() => onEdit(key)}><strong>{current?.title ?? key}</strong><small>{current ? '已发布 · 第' + current.version + '版' : '尚无已发布版本'}</small></button>;
    })}</div>
    <p>岗位与工位要求、软参考范围、创作及审查流程可在上方配置修改。作者原话和当前候选来自任务；分类目录、输出结构和预算校验仍由程序维护，不能通过改提示词绕过。实际选入的参考及完整输入在调用记录中查看。</p>
    <h3>各环节如何使用这些配置</h3>
    <div className="opening-context-stages">{STAGES.map(([title, member, sources]) => <article key={title}><h3>{title}</h3><strong>{member}</strong><p>{sources}</p></article>)}</div>
    <section className="opening-context-example" aria-label="真实上下文样例">
      <h3>抽取一条真实记录作样例</h3><p>可以抽到管理员或其他用户的开书调用，仅用于检查通用配置带入的资料是否准确、哪些部分占用过多；不会修改这位用户的任务。样例使用当时冻结的配置，不能代表刚修改的新规则。</p>
      <button type="button" className="primary" disabled={sampleLoading || !onSample} onClick={onSample}>{sampleLoading ? '读取样例中…' : sample ? '换一条样例' : '抽取开书样例'}</button>
      {sample && <><p>{sample.manifest.taskKind === 'opening_review' ? '主编审查' : sample.manifest.operationMode === 'revise' ? '作者调整' : '开书设计'} · {new Date(sample.manifest.createdAt).toLocaleString('zh-CN')} · {sample.promptAssets.workstationPrompt?.title} 第 {sample.promptAssets.workstationPrompt?.version} 版</p><OpeningContextSnapshot detail={sample}/></>}
    </section>
    <button type="button" className="secondary" onClick={onTraces}>高级排障：查询历史调用</button>
  </section>;
}

/** Render only the stored visible request, never infer source text or model reasoning. */
export function OpeningContextSnapshot({ detail }: { detail: V7PromptManifestDetail }) {
  if (detail.manifest.workstationKey !== 'opening') return null;
  let payload: Record<string, any>;
  try {
    const compiled = JSON.parse(detail.manifest.compiledPrompt);
    payload = compiled?.contextPack?.content?.stageTaskPayload;
    if (!payload || typeof payload !== 'object') return <p>此历史记录没有可分段展示的开书资料，请查看下方最终下发内容。</p>;
  } catch { return <p>此历史记录无法分段解析，请查看下方最终下发内容。</p>; }
  const blocks = [
    ['作者原始想法', payload.authorSource],
    ['作者调整意见', payload.authorAdjustment ?? payload.currentCandidates?.openingPackage?.authorInstructions ?? []],
    ['当前候选及审查', payload.currentCandidates],
    ['实际方法参考', payload.internalReferences],
    ['分类目录', payload.openingTaxonomy],
    ['节点基础要求与输出合同', { taskContract: payload.taskContract, stageBoundary: payload.stageBoundary, finalInstructions: payload.finalInstructions, outputContract: payload.outputContract, outputJsonSchema: payload.outputJsonSchema }]
  ];
  const total = Array.from(detail.manifest.compiledPrompt).length;
  const measured = blocks.map(([label, content]) => ({label:String(label),characters:Array.from(JSON.stringify(content ?? null)).length})).sort((a,b)=>b.characters-a.characters);
  return <section className="prompt-trace-section opening-context-snapshot"><h3>本次开书输入（只读快照）</h3><p>共 {total} 字符，包含岗位、工位、流程和资料。此处展示真实下发记录；调整今后的规则请使用配置来源。</p>
    <div className="opening-context-sizes">{measured.map(item=><div key={item.label}><span>{item.label}</span><strong>{item.characters} 字符</strong><meter min={0} max={Math.max(total,1)} value={item.characters} aria-label={item.label+'字符占用'} /></div>)}</div>
    <p>可优先检查占用最大的部分是否含重复说明、无关参考或过多候选。字符占用只帮助定位，不自动判定资料错误；作者明确要求不能为压缩而丢失。</p>
    {blocks.map(([label, content]) => <details key={String(label)}><summary>{String(label)} · {Array.from(JSON.stringify(content ?? null)).length} 字符</summary><pre>{JSON.stringify(content ?? null, null, 2)}</pre></details>)}
  </section>;
}

const RULE_LABELS: Record<string, string> = {
  objective: '任务目标', responsibility: '职责', publicResponsibility: '岗位职责', publicName: '显示名称',
  requiredSources: '需要的资料来源', forbiddenSources: '排除的资料来源', successCriteria: '完成标准',
  requiredInputs: '需要的输入资料', forbiddenInputs: '排除的输入资料', qualityChecks: '质量检查', stageBoundary: '当前环节边界',
  allowedSources: '允许的资料来源', excludedSources: '排除的资料来源',
  creativityBoundary: '创作边界', boundary: '工作边界', procedure: '执行要求',
  allowedTools: '可用工具', stopConditions: '停止条件', outputRequirements: '交付要求',
  capabilities: '岗位能力', tools: '工具职责', outputContract: '交付约定', failureContract: '失败处理',
  mustPreserve: '必须保留', allowedChanges: '允许调整', forbiddenChanges: '禁止改动'
};

export function PromptRuleFields({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  let content: Record<string, unknown>;
  try { content = JSON.parse(value); if (!content || Array.isArray(content) || typeof content !== 'object') return null; }
  catch { return <p role="status">结构化内容尚未完整，补全后可以使用分项编辑。</p>; }
  return <div className="prompt-readable-fields">{Object.entries(content).filter(([key, entry]) => RULE_LABELS[key] && (typeof entry === 'string' || Array.isArray(entry) && entry.every(item => typeof item === 'string'))).map(([key, entry]) =>
    <label key={key}><span>{RULE_LABELS[key]}{Array.isArray(entry) ? '（每行一项）' : ''}</span><textarea rows={3} value={Array.isArray(entry) ? entry.join('\n') : String(entry)} onChange={event => onChange(JSON.stringify({ ...content, [key]: Array.isArray(entry) ? event.target.value.split('\n') : event.target.value }, null, 2))} /></label>
  )}</div>;
}
