// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { afterEach, expect, test, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { BenefitsPage } from './BenefitsPage';
import { AuthorAccountSessionProvider, type AuthorAccountSession } from './AuthorAccountBoundary';
afterEach(cleanup);
const session: AuthorAccountSession = {
  account: {userId:'u',email:'u@example.test',displayName:'作者',role:'user',status:'active'},
  membershipState:'ready', membershipError:null,signingOut:false,sessionNotice:null,
  refreshMembership:vi.fn(async()=>{}),signOut:vi.fn(async()=>{}),requireSignIn:vi.fn(),
  membership:{isAdmin:false,membership:{plan:'diamond',planLabel:'钻石算力包',planPrice:'980元',status:'active',computeQuota:200000000,computeConsumed:100,computeRemaining:199999900,periodStart:'2026-09-07',periodEnd:'2027-09-07',expired:false},plans:[{plan:'diamond',label:'钻石算力包',price:'980元',amountCny:980,computeQuota:200000000,months:12}]}
};
function show(value=session,onOpenAccount=vi.fn()) {render(<AuthorAccountSessionProvider session={value}><BenefitsPage onOpenAccount={onOpenAccount}/></AuthorAccountSessionProvider>);return onOpenAccount;}
test('权益来自账号接口，套餐价格与实际余额展示，个人中心可达',()=>{
 const open=show();expect(screen.getByText('当前身份 · 推广员')).toBeVisible();expect(screen.getByText('剩余 199,999,900 算力')).toBeVisible();expect(screen.getByText('980元')).toBeVisible();
 fireEvent.click(screen.getByRole('button',{name:'查看我的权益'}));expect(open).toHaveBeenCalledOnce();expect(screen.getByText('尚未开放')).toBeVisible();expect(screen.queryByRole('button',{name:/提现|领取/})).toBeNull();
});
test('未读取完成或失败时不冒充权益已生效，可以重试',()=>{
 show({...session,membershipState:'error'});expect(screen.queryByText('当前身份 · 推广员')).toBeNull();fireEvent.click(screen.getByRole('button',{name:'重新读取'}));expect(session.refreshMembership).toHaveBeenCalledOnce();
});
test('过期钻石账号不显示有效推广员权益',()=>{
 show({...session,membership:{...session.membership!,membership:{...session.membership!.membership!,expired:true}}});expect(screen.getByText('当前身份 · 作者')).toBeVisible();expect(screen.getByText('暂无生效算力包')).toBeVisible();
});
