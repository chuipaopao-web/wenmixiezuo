import { useState } from 'react';
import { authorErrorFromUnknown } from '../../lib/api/author-error';
import { XIcon } from '@phosphor-icons/react';
import {
  exportBookPackage,
  importBookCopy,
  type OperationsStatusData
} from '../../lib/api/client';
import { DEFAULT_WORKSPACE_PREFERENCES, type WorkspacePreferences } from '../../app/workspace-preferences';
import { formatBytes } from '../shared/task-presentation';

export function SettingsDialog({ preferences, bookId, operations, onBooksChanged, onChange, onClose }: {
  preferences: WorkspacePreferences;
  bookId: string | null;
  operations: OperationsStatusData | null;
  onBooksChanged: () => void;
  onChange: (preferences: WorkspacePreferences) => void;
  onClose: () => void;
}): React.JSX.Element {
  const [portableBusy, setPortableBusy] = useState(false);
  const [portableStatus, setPortableStatus] = useState<string | null>(null);
  const [importName, setImportName] = useState('');
  const themes = [
    { value: 'sage', label: '青黛', description: '月白底、黛绿主色的默认新中式工作台' },
    { value: 'paper', label: '宣纸', description: '暖纸底色，适合长时间阅读正文' },
    { value: 'mist', label: '天青', description: '雨后青天色，清透安静' },
    { value: 'night', label: '夜黛', description: '低亮度墨绿的夜间工作台' }
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
          <legend>本机运维与可移植</legend>
          {operations === null ? <div className="binding-skeleton" aria-label="正在加载本机诊断"><span /><span /></div> : <div className="operations-summary">
            <div><span>Schema</span><strong>{operations.schemaVersion}</strong></div><div><span>剩余磁盘</span><strong>{formatBytes(operations.disk.freeBytes)}</strong></div><div><span>排队/工作</span><strong>{operations.queue.queued}/{operations.queue.working}</strong></div><div><span>受阻</span><strong>{operations.queue.blocked}</strong></div>
          </div>}
          <p className="capability-note">内容只保存在这台电脑上，不发送使用记录。导出文件不包含模型密钥和临时索引；复制导入会另建一本书，不覆盖已有书籍。</p>
          {portableStatus !== null && <p className="binding-status" role="status">{portableStatus}</p>}
          <div className="portable-actions"><button type="button" className="secondary-button" disabled={portableBusy || bookId === null} onClick={() => {
            if (bookId === null) return;
            setPortableBusy(true); setPortableStatus(null);
            void exportBookPackage(bookId).then((result) => setPortableStatus(`已导出 ${result.packageName}，保存于 ${result.packagePath}。清单哈希 ${result.manifestHash.slice(0, 12)}。`)).catch((reason: unknown) => setPortableStatus(authorErrorFromUnknown(reason, '导出失败'))).finally(() => setPortableBusy(false));
          }}>导出当前书</button><label><span>从 data/imports 复制导入</span><input value={importName} onChange={(event) => setImportName(event.target.value)} placeholder="文件名.wenmi-book" /></label><button type="button" className="primary-button" disabled={portableBusy || !importName.endsWith('.wenmi-book')} onClick={() => {
            setPortableBusy(true); setPortableStatus(null);
            void importBookCopy(importName).then((result) => { setPortableStatus(`已复制导入《${result.title}》。`); setImportName(''); onBooksChanged(); }).catch((reason: unknown) => setPortableStatus(authorErrorFromUnknown(reason, '导入失败'))).finally(() => setPortableBusy(false));
          }}>安全导入副本</button></div>
        </fieldset>
        <footer><button className="secondary-button" type="button" onClick={() => onChange(DEFAULT_WORKSPACE_PREFERENCES)}>恢复默认</button><button className="primary-button" type="button" onClick={onClose}>完成</button></footer>
      </section>
    </div>
  );
}
