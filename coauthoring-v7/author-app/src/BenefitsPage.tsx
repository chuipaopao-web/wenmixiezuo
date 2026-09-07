import { GiftIcon, ArrowRightIcon } from '@phosphor-icons/react';
import { useAuthorAccount } from './AuthorAccountBoundary';
import './benefits-page.css';

export function BenefitsPage({ onOpenAccount }: { onOpenAccount: () => void }): React.JSX.Element {
  const session = useAuthorAccount();
  const record = session.membership?.membership;
  const ready = session.membershipState === 'ready';
  const active = record?.status === 'active' && !record.expired;
  const identity = session.account.role === 'admin' ? '管理员' : active && ['gold', 'diamond'].includes(record.plan) ? '推广员' : '作者';
  return <section className="benefits-page benefits-center" aria-labelledby="benefits-title">
    <header className="benefits-heading"><div><p className="eyebrow">创作权益</p><h2 id="benefits-title">福利中心</h2><p>查看您的算力权益与推广活动。</p></div><GiftIcon aria-hidden="true" /></header>
    {session.membershipState === 'loading' && <p role="status">正在读取您的权益…</p>}
    {session.membershipState === 'error' && <div className="benefits-notice" role="alert"><p>暂时没有读到权益信息，请重新读取。</p><button type="button" onClick={() => void session.refreshMembership()}>重新读取</button></div>}
    {ready && <>
      <section className="benefits-current" aria-label="当前权益"><div><span>当前身份 · {identity}</span><h3>{session.account.role === 'admin' ? '管理员账号' : active ? record.planLabel : '暂无生效算力包'}</h3><p>{session.account.role === 'admin' ? '管理员算力不限' : active ? `剩余 ${record.computeRemaining.toLocaleString('zh-CN')} 算力` : '您可以在个人中心查看或办理算力包。'}</p></div><button type="button" onClick={onOpenAccount}>查看我的权益 <ArrowRightIcon aria-hidden="true" /></button></section>
      <section aria-label="算力包选择"><h3>创作算力包</h3><div className="benefits-plans">{session.membership?.plans?.map(plan => <article key={plan.plan}><h4>{plan.label}</h4><strong>{plan.price}</strong><p>{plan.computeQuota.toLocaleString('zh-CN')} 算力 · {plan.months}个月</p>{['gold', 'diamond'].includes(plan.plan) && <small>包含推广员身份标识</small>}</article>)}</div>{!session.membership?.plans?.length && <p>套餐信息暂未返回，可到个人中心查看。</p>}<p className="benefits-note">算力为整个有效期的总额度。目前由管理员办理，已购买的权益以个人中心记录为准。</p></section>
    </>}
    <section className="benefits-promotion" aria-label="推广福利"><div><h3>推广福利</h3><span>尚未开放</span></div><p>邀请记录、钻石奖励与提现服务正在筹备，开放后将在这里公布活动规则。</p><p className="benefits-note">推广员身份标识不代表奖励或提现已开通，目前无需进行推广操作。</p></section>
  </section>;
}
