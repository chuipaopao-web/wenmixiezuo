import { canonicalMemberIdentityKey } from './author-projection';
import { publicMemberIdentity } from '../../backend/agent-governance/member-identities';

const MEMBER_DISPLAY_NAME: Record<string, string> = {
  'chief-deepseek-v4-pro': '貂蝉',
  'chief-glm-5-3': '顾承砚',
  'chief-kimi-k3': '沈知微',
  'deputy-glm-5-3': '西施',
  'deputy-deepseek-v4-flash': '妙玉',
  'deputy-kimi-k3': '谢临川',
  'planner-deepseek-v4-pro': '红玉',
  'planner-glm-5-3': '幼薇',
  'planner-kimi-k3': '苏映棠',
  'planner-deepseek-v4-flash': '文姬',
  'planner-kimi-2-7': '上官婉儿',
  'writer-kimi-k3': '清照',
  'writer-deepseek-v4-pro': '司马相如',
  'writer-deepseek-v4-flash': '谢道韫',
  'writer-glm-5-3': '曹雪芹',
  'writer-kimi-2-7': '柳永',
  'writer-doubao': '蒲松龄',
  'review-glm-5-3': '顾清辞',
  'review-deepseek-v4-pro': '陆观澜',
  'review-deepseek-v4-flash': '程砚秋',
  'review-kimi-k3': '周行简',
  'continuity-glm-5-3': '宋知遥',
  'continuity-deepseek-v4-flash': '裴文心',
  'continuity-kimi-2-7': '沈墨',
  'visual-seedream': '绘真',
  'screenwriter-deepseek-v4-pro': '红玉',
  'screenwriter-doubao-seed-2-1-turbo': '幼薇',
  'screenwriter-kimi-k3': '清照',
  'setting-chief-1': '貂蝉',
  'setting-deputy-1': '西施',
  'setting-writer-1': '红玉',
  'setting-writer-2': '幼薇',
  'setting-writer-3': '妙玉',
  'setting-writer-4': '苏映棠',
  'setting-writer-5': '上官婉儿',
  'visual-danqing': '丹青',
  'visual-huizhen': '绘真'
};

const MEMBER_AVATAR_PATH: Record<string, string> = {
  'visual-danqing': '/avatars/danqing-visual-editor.png',
  'visual-minimax-m3': '/avatars/danqing-visual-editor.png'
};

export function memberAvatarPosition(memberKey: string): string {
  return publicMemberIdentity(canonicalMemberIdentityKey(memberKey))?.avatarPosition ?? '100% 100%';
}

/** 兼容已保存的 V7 任务快照；编号名只保留在内部历史记录中。 */
export function memberDisplayName(memberKey: string, storedName: string): string {
  return publicMemberIdentity(canonicalMemberIdentityKey(memberKey))?.displayName
    ?? MEMBER_DISPLAY_NAME[canonicalMemberIdentityKey(memberKey)] ?? MEMBER_DISPLAY_NAME[memberKey] ?? storedName;
}

export function memberAvatarPath(memberKey: string): string | null {
  return MEMBER_AVATAR_PATH[canonicalMemberIdentityKey(memberKey)] ?? MEMBER_AVATAR_PATH[memberKey] ?? null;
}
