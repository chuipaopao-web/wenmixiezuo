import { useEffect, useState } from 'react';
import { XIcon } from '@phosphor-icons/react';
import {
  activateModelBindings,
  exportBookPackage,
  importBookCopy,
  previewModelBindings,
  restoreModelBindingRevision,
  type CapabilityData,
  type ModelBindingsData,
  type OperationsStatusData,
  type TeamModelProfileData
} from '../../lib/api/client';
import { DEFAULT_WORKSPACE_PREFERENCES, type WorkspacePreferences } from '../../app/workspace-preferences';
import { formatBytes } from '../shared/task-presentation';
import { roleSummary } from '../team/TeamWorkspace';

export function SettingsDialog({ preferences, capabilities, bookId, bindings, operations, onBindingsChanged, onBooksChanged, onChange, onClose }: {
  preferences: WorkspacePreferences;
  capabilities: CapabilityData | null;
  bookId: string | null;
  bindings: ModelBindingsData | null;
  operations: OperationsStatusData | null;
  onBindingsChanged: () => void;
  onBooksChanged: () => void;
  onChange: (preferences: WorkspacePreferences) => void;
  onClose: () => void;
}): React.JSX.Element {
  const [bindingProfiles, setBindingProfiles] = useState<Record<string, TeamModelProfileData>>({});
  const [bindingBusy, setBindingBusy] = useState(false);
  const [bindingStatus, setBindingStatus] = useState<string | null>(null);
  const [portableStatus, setPortableStatus] = useState<string | null>(null);
  const [importName, setImportName] = useState('');
  useEffect(() => {
    if (bindings === null) return;
    setBindingProfiles(Object.fromEntries(bindings.active.map((binding) => [binding.roleKey, {
      provider: binding.provider, modelId: binding.modelId, plan: binding.plan
    }])));
  }, [bindings]);
  const themes = [
    { value: 'sage', label: 'iOS 浅色', description: '冷白、蓝灰和玻璃层次的默认工作台' },
    { value: 'paper', label: '阅读白', description: '温暖克制，适合长时间阅读正文' },
    { value: 'mist', label: '冰蓝', description: '清透安静，突出规划和资料层级' },
    { value: 'night', label: '深色', description: '低亮度玻璃材质的夜间工作台' }
  ] as const;
  const fonts = [
    { value: 'small', label: '小' },
    { value: 'standard', label: '标准' },
    { value: 'large', label: '大' },
    { value: 'xlarge', label: '特大' }
  ] as const;
  return (
    <div className="dialog-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section className="dialog settings-dialog" role="dialog" aria-modal="true" aria-labelledby="settings-title">
        <header><div><h2 id="settings-title">界面设置</h2><p>调整会立即生效，并只保存在这台电脑上。</p></div><button className="icon-button" type="button" aria-label="关闭界面设置" onClick={onClose}><XIcon /></button></header>
        <fieldset>
          <legend>工作台底色</legend>
          <div className="theme-options">
            {themes.map((theme) => (
              <label className="theme-option" key={theme.value}>
                <input type="radio" name="workspace-theme" value={theme.value} aria-label={theme.label} checked={preferences.theme === theme.value} onChange={() => onChange({ ...preferences, theme: theme.value })} />
                <span className={`theme-preview ${theme.value}`} aria-hidden="true" />
                <span><strong>{theme.label}</strong><small>{theme.description}</small></span>
              </label>
            ))}
          </div>
        </fieldset>
        <fieldset>
          <legend>字体大小</legend>
          <div className="font-options">
            {fonts.map((font) => (
              <label key={font.value} className={preferences.fontSize === font.value ? 'font-option active' : 'font-option'}>
                <input type="radio" name="workspace-font" value={font.value} aria-label={font.label} checked={preferences.fontSize === font.value} onChange={() => onChange({ ...preferences, fontSize: font.value })} />
                <span>{font.label}</span>
              </label>
            ))}
          </div>
        </fieldset>
        <fieldset>
          <legend>成员模型</legend>
          <div className="model-runtime-summary">
            <div className={capabilities?.modelRuntime.activeMode === 'subscription-plan' ? 'runtime-state active' : 'runtime-state'}>
              <span aria-hidden="true" />
              <strong>{capabilities?.modelRuntime.activeMode === 'subscription-plan' ? '订阅与套餐模型已启用' : '确定性测试模型'}</strong>
              <small>{capabilities?.modelRuntime.cashFallbackAllowed === false ? '禁止按量付费回退' : '运行状态待连接'}</small>
            </div>
            <div className="model-profile-list">
              {(capabilities?.modelRuntime.profiles ?? []).map((profile) => (
                <div className="model-profile" key={`${profile.provider}/${profile.modelId}`}>
                  <span><strong>{profile.modelId}</strong><small>{profile.provider}</small></span>
                  <span><small>{profile.roles.map(roleLabel).join('、')}</small><em>{profile.credentialConfigured ? planLabel(profile.plan) : '缺少凭证'}</em></span>
                </div>
              ))}
              {capabilities === null && <p>连接本地服务后显示创作团队的真实模型来源。</p>}
            </div>
            {capabilities !== null && <p className="capability-note">本地运行环境正常 · 本地资料库正常 · 全文查找{capabilities.sqlite.fts5 ? '可用' : '需要修复'} · 语义查找{capabilities.degradation.vectorSearchAvailable ? '可用' : '需要安装'}</p>}
          </div>
        </fieldset>
        <fieldset>
          <legend>书籍级模型绑定</legend>
          {bookId === null ? <p className="capability-note">选择一本书后可管理未来任务的模型绑定。</p> : bindings === null ? <div className="binding-skeleton" aria-label="正在加载模型绑定"><span /><span /><span /></div> : (
            <div className="binding-manager">
              <p>修改只对未来新任务生效，运行中的任务继续使用已冻结模型。两名编剧必须异模型，豆包不能进入剧情席；GLM担任副笔时事实席自动切换DeepSeek。</p>
              <div className="binding-role-list">{bindings.active.map((binding) => {
                const options = uniqueProfiles(capabilities, bindings);
                const selected = bindingProfiles[binding.roleKey] ?? { provider: binding.provider, modelId: binding.modelId, plan: binding.plan };
                return <label key={binding.roleKey}><span><strong>{binding.memberName}（{binding.shortTitle}）</strong><small>{roleSummary(binding.roleKey)}</small></span><select aria-label={`${binding.memberName}模型`} value={modelProfileValue(selected)} onChange={(event) => {
                  const next = options.find((option) => modelProfileValue(option) === event.target.value);
                  if (next !== undefined) setBindingProfiles((current) => ({ ...current, [binding.roleKey]: next }));
                }}>{options.map((option) => <option key={modelProfileValue(option)} value={modelProfileValue(option)}>{option.modelId}（{planLabel(option.plan)}）</option>)}</select></label>;
              })}</div>
              {bindingStatus !== null && <p className="binding-status" role="status">{bindingStatus}</p>}
              <div className="binding-actions"><button type="button" className="secondary-button" disabled={bindingBusy} onClick={() => {
                if (bookId === null) return;
                setBindingBusy(true); setBindingStatus(null);
                void previewModelBindings(bookId, bindingProfiles).then(() => setBindingStatus('预检通过：模型独立性、剧情席和零现金回退规则均满足。')).catch((reason: unknown) => setBindingStatus(reason instanceof Error ? reason.message : '预检失败')).finally(() => setBindingBusy(false));
              }}>预览校验</button><button type="button" className="primary-button" disabled={bindingBusy} onClick={() => {
                if (bookId === null) return;
                setBindingBusy(true); setBindingStatus(null);
                void previewModelBindings(bookId, bindingProfiles).then(() => activateModelBindings(bookId, bindingProfiles, '老板在设置页激活未来任务模型绑定')).then(() => {
                  setBindingStatus('已激活新修订，仅未来任务生效。'); onBindingsChanged();
                }).catch((reason: unknown) => setBindingStatus(reason instanceof Error ? reason.message : '激活失败')).finally(() => setBindingBusy(false));
              }}>激活未来任务</button></div>
              <details className="binding-history"><summary>绑定历史 {bindings.revisions.length}</summary>{bindings.revisions.map((revision) => <div key={revision.revisionId}><strong>修订 {revision.version}</strong><span>{revision.reason}</span><em>{revision.status === 'active' ? '当前活动' : '历史'}</em>{revision.status !== 'active' && <button type="button" className="text-button" disabled={bindingBusy} onClick={() => {
                if (bookId === null) return;
                setBindingBusy(true); setBindingStatus(null);
                void restoreModelBindingRevision(bookId, revision.revisionId).then(() => {
                  setBindingStatus(`已从修订 ${revision.version} 创建新的活动修订，仅未来任务生效。`); onBindingsChanged();
                }).catch((reason: unknown) => setBindingStatus(reason instanceof Error ? reason.message : '恢复失败')).finally(() => setBindingBusy(false));
              }}>恢复为新修订</button>}</div>)}</details>
            </div>
          )}
        </fieldset>
        <fieldset>
          <legend>本机运维与可移植</legend>
          {operations === null ? <div className="binding-skeleton" aria-label="正在加载本机诊断"><span /><span /></div> : <div className="operations-summary">
            <div><span>Schema</span><strong>{operations.schemaVersion}</strong></div><div><span>剩余磁盘</span><strong>{formatBytes(operations.disk.freeBytes)}</strong></div><div><span>排队/工作</span><strong>{operations.queue.queued}/{operations.queue.working}</strong></div><div><span>受阻</span><strong>{operations.queue.blocked}</strong></div>
          </div>}
          <p className="capability-note">内容只保存在这台电脑上，不发送使用记录。导出文件不包含模型密钥和临时索引；复制导入会另建一本书，不覆盖已有书籍。</p>
          {portableStatus !== null && <p className="binding-status" role="status">{portableStatus}</p>}
          <div className="portable-actions"><button type="button" className="secondary-button" disabled={bindingBusy || bookId === null} onClick={() => {
            if (bookId === null) return;
            setBindingBusy(true); setPortableStatus(null);
            void exportBookPackage(bookId).then((result) => setPortableStatus(`已导出 ${result.packageName}，保存于 ${result.packagePath}。清单哈希 ${result.manifestHash.slice(0, 12)}。`)).catch((reason: unknown) => setPortableStatus(reason instanceof Error ? reason.message : '导出失败')).finally(() => setBindingBusy(false));
          }}>导出当前书</button><label><span>从 data/imports 复制导入</span><input value={importName} onChange={(event) => setImportName(event.target.value)} placeholder="文件名.wenmi-book" /></label><button type="button" className="primary-button" disabled={bindingBusy || !importName.endsWith('.wenmi-book')} onClick={() => {
            setBindingBusy(true); setPortableStatus(null);
            void importBookCopy(importName).then((result) => { setPortableStatus(`已复制导入《${result.title}》。`); setImportName(''); onBooksChanged(); }).catch((reason: unknown) => setPortableStatus(reason instanceof Error ? reason.message : '导入失败')).finally(() => setBindingBusy(false));
          }}>安全导入副本</button></div>
        </fieldset>
        <footer><button className="secondary-button" type="button" onClick={() => onChange(DEFAULT_WORKSPACE_PREFERENCES)}>恢复默认</button><button className="primary-button" type="button" onClick={onClose}>完成</button></footer>
      </section>
    </div>
  );
}

function planLabel(plan: 'deterministic' | 'codex' | 'coding' | 'agent'): string {
  if (plan === 'codex') return 'Codex 登录态';
  if (plan === 'coding') return 'Coding Plan';
  if (plan === 'agent') return 'Agent Plan';
  return '本地测试';
}

function roleLabel(role: string): string {
  return ({
    chief_editor: '主编', deputy_editor: '副主编', lead_screenwriter: '编剧', second_screenwriter: '编剧',
    plot_architect: '编剧', setting: '设定师', continuity: '设定师', lead_writer: '主笔', backup_writer: '副主笔', writer: '主笔',
    fact_reviewer: '事实审校', literary_reviewer: '文学审校', experience_reviewer: '体验审校', reviewer: '审校',
    reader_experience: '体验官', style_editor: '文编', researcher: '研究员', copyright: '版权顾问'
  } as Record<string, string>)[role] ?? role;
}

function uniqueProfiles(capabilities: CapabilityData | null, bindings: ModelBindingsData): TeamModelProfileData[] {
  const candidates: TeamModelProfileData[] = [
    ...(capabilities?.modelRuntime.profiles ?? []).map((profile) => ({ provider: profile.provider, modelId: profile.modelId, plan: profile.plan })),
    ...bindings.active.map((binding) => ({ provider: binding.provider, modelId: binding.modelId, plan: binding.plan }))
  ];
  return candidates.filter((profile, index, all) => all.findIndex((item) => modelProfileValue(item) === modelProfileValue(profile)) === index);
}

function modelProfileValue(profile: TeamModelProfileData): string {
  return `${profile.provider}\n${profile.modelId}\n${profile.plan}`;
}
