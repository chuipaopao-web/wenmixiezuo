import { useState } from 'react';
import type { AuthAccountData, MembershipStatusData } from '../../lib/api/client';

/** 算力值按万/亿缩写展示，个位数直接显示。 */
export function formatComputeValue(value: number): string {
  if (value >= 100_000_000) return `${(value / 100_000_000).toFixed(value % 100_000_000 === 0 ? 0 : 1)}亿`;
  if (value >= 10_000) return `${(value / 10_000).toFixed(value % 10_000 === 0 ? 0 : 1)}万`;
  return String(value);
}

function formatDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日`;
}

const SUPPORT_WECHAT = '595341366';

/**
 * 个人中心：点右下角头像进入。
 * 展示会员等级、已消耗算力值（双倍口径）与客服微信；不出现 token 字眼。
 */
export function PersonalCenterDialog({
  account,
  membership,
  onClose,
  onSignOut
}: {
  account: AuthAccountData;
  membership: MembershipStatusData | null;
  onClose: () => void;
  onSignOut: () => void;
}): React.JSX.Element {
  const [copied, setCopied] = useState(false);
  const record = membership?.membership ?? null;
  const isAdmin = account.role === 'admin';
  const usable = record !== null && record.status === 'active' && !record.expired && record.computeRemaining > 0;
  const usedRatio = record === null || record.computeQuota === 0
    ? 0
    : Math.min(1, record.computeConsumed / record.computeQuota);

  const copyWechat = (): void => {
    void navigator.clipboard?.writeText(SUPPORT_WECHAT).then(() => {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1_500);
    }).catch(() => undefined);
  };

  return <div className="dialog-backdrop" onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <section className="dialog personal-center" role="dialog" aria-label="个人中心">
      <header className="personal-center-head">
        <i className="personal-center-avatar" aria-hidden="true">{account.displayName.slice(0, 1).toUpperCase()}</i>
        <div>
          <strong>{account.displayName}</strong>
          <span>{account.email}</span>
        </div>
        <button className="membership-close" type="button" aria-label="关闭个人中心" onClick={onClose}>×</button>
      </header>

      <section className="personal-center-card" aria-label="会员与算力值">
        {isAdmin ? <>
          <div className="personal-center-tier"><b>管理员</b><em>算力值不限</em></div>
        </> : record === null ? <>
          <div className="personal-center-tier"><b>未开通会员</b><em>联系客服微信开通</em></div>
        </> : <>
          <div className="personal-center-tier">
            <b>{record.planLabel}</b>
            <em>{record.planPrice}{record.expired ? ' · 已到期' : usable ? ` · ${formatDate(record.periodEnd)}到期` : ' · 算力值已用完'}</em>
          </div>
          <div className="personal-center-usage">
            <div className="personal-center-usage-numbers">
              <span>已消耗 <b>{formatComputeValue(record.computeConsumed)}</b> 算力值</span>
              <span>共 {formatComputeValue(record.computeQuota)}</span>
            </div>
            <div className="personal-center-track" aria-hidden="true"><i style={{ width: `${Math.round(usedRatio * 100)}%` }} /></div>
            <small>剩余 {formatComputeValue(record.computeRemaining)} 算力值</small>
          </div>
        </>}
      </section>

      <section className="personal-center-card personal-center-support" aria-label="客服">
        <span>客服微信</span>
        <b>{SUPPORT_WECHAT}</b>
        <button type="button" onClick={copyWechat}>{copied ? '已复制' : '复制'}</button>
      </section>

      <footer className="personal-center-actions">
        <button type="button" onClick={onSignOut}>退出登录</button>
        <button type="button" className="primary" onClick={onClose}>完成</button>
      </footer>
    </section>
  </div>;
}
