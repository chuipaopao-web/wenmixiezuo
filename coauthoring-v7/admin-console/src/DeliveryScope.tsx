import type { RebuildUnit } from '../../backend/admin/rebuild-control-types.js';
import { detailText } from './WorkflowGuide';

export function DeliveryScope({ unit }: { unit: RebuildUnit }) {
  return <section className="rebuild-detail-section" aria-label="当前交付与收尾">
    <h4>当前交付与收尾</h4>
    <p><strong>当前线上：</strong>{detailText(unit, '收尾·线上现状') ?? '尚未登记，不能根据重构进度推断线上可用性。'}</p>
    <p><strong>还需完成：</strong>{detailText(unit, '收尾·剩余工作') ?? '尚未核对；未自动认定完成。'}</p>
    <details><summary>查看执行归属与旧代码退出条件</summary>
      <p><strong>当前执行：</strong>{detailText(unit, '收尾·执行归属') ?? '尚未核对。'}</p>
      <p><strong>旧代码退出：</strong>{detailText(unit, '收尾·旧实现退出') ?? '尚未核对，不据此删除。'}</p>
    </details>
  </section>;
}
