import { createContext, useContext, type ReactNode } from 'react';

/** AI 介入被会员门禁拦截的原因。 */
export type MembershipBlockReason = 'required' | 'quota';

/** 弹窗文案：与服务端会员门禁的提示保持一致。 */
export const MEMBERSHIP_BLOCK_COPY: Record<MembershipBlockReason, { title: string; body: string }> = {
  required: {
    title: '需要开通会员',
    body: '召集AI团队需使用算力，请联系管理员微信595341366。'
  },
  quota: {
    title: '算力值已用完',
    body: '召集AI团队需使用算力，会员算力值已用完，请联系管理员微信595341366续费。'
  }
};

interface MembershipGateValue {
  /** 管理员或持有生效会员且算力未耗尽时，允许调用 AI 团队。 */
  canUseAi: boolean;
  /** AI 介入前置检查：放行返回 true；未开通会员则弹窗提示并返回 false（不启动成员、不发资料包、不介入）。 */
  guardAi(): boolean;
}

const MembershipGateContext = createContext<MembershipGateValue>({
  canUseAi: true,
  guardAi: () => true
});

export function MembershipGateProvider({ value, children }: { value: MembershipGateValue; children: ReactNode }): React.JSX.Element {
  return <MembershipGateContext.Provider value={value}>{children}</MembershipGateContext.Provider>;
}

export function useMembershipGate(): MembershipGateValue {
  return useContext(MembershipGateContext);
}

/**
 * 兜底桥：客户端任意请求收到服务端会员门禁 403 时，即使前端没有做前置检查，
 * 也会通知 App 弹窗提示（例如会员在会话中途到期、算力耗尽）。
 */
let blockedListener: ((reason: MembershipBlockReason) => void) | null = null;

export function setMembershipBlockedListener(listener: ((reason: MembershipBlockReason) => void) | null): void {
  blockedListener = listener;
}

export function raiseMembershipBlocked(reason: MembershipBlockReason): void {
  blockedListener?.(reason);
}

export function membershipBlockReasonFromCode(code: string | undefined): MembershipBlockReason | null {
  if (code === 'MEMBERSHIP_REQUIRED') return 'required';
  if (code === 'MEMBERSHIP_QUOTA_EXHAUSTED') return 'quota';
  return null;
}
