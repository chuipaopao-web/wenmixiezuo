/**
 * 清理模型输出中只对内部实现有意义的字段和旧称，避免把机器载荷直接展示给作者。
 * 这里只整理呈现文本，不承担上下文选择、会话记忆或业务对象路由。
 */
export function sanitizeAuthorFacingText(value: string): string {
  let text = value.replace(/\r\n?/gu, '\n');
  text = text.replace(
    /故事圣经\s*(?:sourceId|source_id)\s*[:：]\s*[A-Za-z0-9_-]+\s*的?\s*premise\s*(?:原文)?/giu,
    '现有设定大纲中的核心前提'
  );
  text = text.replace(/故事圣经\s*(?:中的?|里(?:的)?)?\s*premise/giu, '设定大纲中的核心前提');
  text = text.replace(/\bstory_bible\b/giu, '设定大纲');
  text = text.replace(/故事圣经/gu, '设定大纲');
  text = text.replace(/圣经(?=中|里|版本|核心前提|premise)/giu, '设定大纲');
  text = text.replace(/\bpremise\b/giu, '核心前提');
  text = text.replace(/\bconfirmed_decisions\s*(?:为|是|=)?\s*(?:空|\[\s*\])/giu, '目前还没有正式确认的讨论结论');
  text = text.replace(/\bconfirmed_decisions\b/giu, '已确认的讨论结论');
  text = text.replace(/\b(?:sourceId|source_id)\s*[:：=]\s*[A-Za-z0-9_-]+/giu, '来源记录');
  text = text.replace(/\bcontextPackHash\s*[:：=]\s*[A-Za-z0-9_-]+/giu, '资料包校验记录');
  text = text.replace(/\bmustFollow\b/gu, '必须遵守');
  text = text.replace(/\bfullBookOutline\b/gu, '全书梗概');
  text = text.replace(/\bstageOne\b/gu, '第一阶段');
  text = text.replace(/\bopeningReference\b/gu, '开书参考');
  text = text.replace(/正史冲突必须解决/gu, '规划差异需要先确认');
  text = text.replace(/当前正史版本无法并存/gu, '当前规划表述不能同时成立');
  text = text.replace(/更新设定大纲中的核心前提为统一正史版本/gu, '按老板确认的版本更新设定大纲中的核心前提');
  text = text.replace(
    /目前还没有正式确认的讨论结论，说明此前无正式确认决定落库。?/gu,
    '此前没有可直接沿用的正式决定。'
  );
  return text.trim();
}