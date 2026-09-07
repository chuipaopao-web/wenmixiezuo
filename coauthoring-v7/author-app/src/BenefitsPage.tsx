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
    <section className="benefits-promotion" aria-label="推广福利">
      <div><h3>推广福利</h3><span>尚未开放</span></div>
      <p>邀请记录、钻石奖励与提现服务尚未上线。</p>
      <h4 className="benefits-reward-title">拟定奖励方案 · 尚未生效</h4>
      <p className="benefits-note">以下为待审核方案，仅作说明，不代表已获得或可领取的奖励。</p>
      <table className="benefits-rewards"><caption>购买金额与两级拟定奖励（单位：钻石）</caption><thead><tr><th scope="col">购买算力包</th><th scope="col">徒弟奖励</th><th scope="col">徒孙奖励</th><th scope="col">两级合计</th></tr></thead><tbody>
        <tr><th scope="row">白银 · 198元</th><td>30</td><td>30</td><td>60</td></tr>
        <tr><th scope="row">黄金 · 398元</th><td>60</td><td>60</td><td>120</td></tr>
        <tr><th scope="row">钻石 · 980元</th><td>150</td><td>150</td><td>300</td></tr>
      </tbody></table>
      <p className="benefits-note">徒弟指直接推荐的人，徒孙指徒弟推荐的人。例如您推荐甲、甲推荐乙；按此方案，乙购买398元算力包时，甲和您各获得60钻石，合计120钻石。</p>
      <p className="benefits-note">兑换比例拟定为1钻石＝1元；资格、结算、退款及提现规则尚待确认，目前不能兑换或提现。</p>
    </section>
  </section>;
}
