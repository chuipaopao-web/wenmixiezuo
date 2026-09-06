/** Public identity only. Never infer model, ability or permissions from a name
 * or portrait. One square per member in the immutable 6 x 4 sprite. */
export const V7_MEMBER_IDENTITIES = [
  ['chief-deepseek-v4-pro', '貂蝉'], ['chief-glm-5-3', '顾婉仪'], ['chief-kimi-k3', '沈知微'],
  ['deputy-glm-5-3', '西施'], ['deputy-deepseek-v4-pro', '妙玉'], ['deputy-kimi-k3', '谢听澜'],
  ['planner-deepseek-v4-pro', '红玉'], ['planner-glm-5-3', '幼薇'], ['planner-kimi-k3', '苏映棠'],
  ['planner-doubao-turbo', '陆青禾'], ['writer-deepseek-v4-pro', '卓文君'], ['writer-kimi-k3', '清照'],
  ['writer-deepseek-v4-flash', '谢道韫'], ['writer-glm-5-3', '林黛玉'], ['writer-kimi-2-7', '柳如是'],
  ['writer-doubao', '叶纨纨'], ['review-kimi-k3', '周清妍'], ['review-glm-5-3', '顾清辞'],
  ['review-deepseek-v4-pro', '陆婉宁'], ['continuity-deepseek-v4-pro', '裴文心'],
  ['continuity-glm-5-3', '宋知遥'], ['continuity-kimi-k3', '沈墨瑶'], ['visual-seedream', '绘真']
] as const;

export const V7_MEMBER_AVATAR_SPRITE = '/avatars/editorial-women-v130.png';
export const V7_MEMBER_AVATAR_SIZE = '600% 400%';

export function publicMemberIdentity(memberKey: string): { displayName: string; avatarPosition: string } | undefined {
  const index = V7_MEMBER_IDENTITIES.findIndex(([key]) => key === memberKey);
  if (index < 0) return undefined;
  return { displayName: V7_MEMBER_IDENTITIES[index]![1], avatarPosition: `${(index % 6) * 20}% ${Math.floor(index / 6) * 100 / 3}%` };
}
