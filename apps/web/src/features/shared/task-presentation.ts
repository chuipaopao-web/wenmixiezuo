import type { TaskCenterBookData, TaskData } from '../../lib/api/client';

export function taskLabel(type: string): string {
  if (type === 'chapter_creation') return '章节创作';
  if (type === 'chapter_write') return '正文写作';
  if (type === 'discussion') return '团队讨论';
  if (type === 'conversation_reply') return '已停用历史任务';
  return type;
}

export function taskGoal(task: TaskData, chapter: string): string {
  if (task.taskType === 'conversation_reply') return '这是旧版本遗留的审计记录，不能重新执行，也不会影响当前对象工作流。';
  if (task.taskType === 'discussion') {
    const scopeText = typeof task.brief.scopeText === 'string' ? task.brief.scopeText : '当前创作问题';
    return `围绕“${scopeText}”收集相关岗位真实意见，由主编汇总后等待老板明确确认。`;
  }
  return `完成${chapter}的${taskLabel(task.taskType)}，经过三位不同模型点评后等待老板确认，接受后才成为正式正文。`;
}

export function statusLabel(status: string): string {
  const labels: Record<string, string> = { pending: '待执行', queued: '排队中', working: '工作中', waiting_confirmation: '待老板确认', paused: '已暂停', failed: '失败', succeeded: '已完成', cancelled: '已取消', blocked: '已阻断', interrupted: '已中断' };
  return labels[status] ?? '正在处理';
}

export function phaseLabel(phase: string): string {
  const labels: Record<string, string> = { reply: '组织回复', collecting: '收集成员意见', preflight: '开始前检查', context: '准备相关资料', draft: '生成完整初稿', hard_check: '检查不能违反的内容', review: '异模型多席点评', rewrite: '修改指定位置', owner_confirmation: '等待老板确认', facts: '整理确认后的事实', settlement: '保存正式正文', completed: '已完成' };
  return labels[phase] ?? '正在处理';
}

export function isActiveTask(status: string): boolean {
  return ['pending', 'queued', 'working', 'waiting_confirmation', 'paused', 'blocked', 'interrupted'].includes(status);
}

export function isStuckTask(status: string): boolean {
  return ['blocked', 'interrupted'].includes(status);
}

/** 卡住任务的大白话原因：列表行直接告诉作者"为什么停、怎么继续"，不再只写"已阻断"。 */
export function taskStuckReason(task: TaskData): string {
  const code = task.errorCode ?? '';
  if (code.includes('MEMBERSHIP')) return '会员算力不可用：续费或联系管理员后，点任务继续执行。';
  if (code.includes('BUDGET')) return '这本书的费用保护上限已到：调整预算后点任务继续。';
  if (code.includes('MODEL') || code.includes('PROVIDER') || code.includes('UPSTREAM')) return '模型服务暂时不可用：点任务可重试，多次失败请看详情里的真实原因。';
  if (code.includes('CONFIRM')) return '有重大事项等您确认：处理完"待确认"卡片后自动继续。';
  if (task.cancelRequested) return '正在按您的要求停止，稍等片刻。';
  return '中途停下了：点这条任务能看到原因，并可从断点继续，已写内容不会丢。';
}

export function taskChapterLabel(task: TaskData, workspace: TaskCenterBookData): string {
  const chapter = workspace.chapters.find((item) => item.chapterId === task.chapterId);
  const briefNumber = task.brief !== undefined && typeof task.brief.chapterNumber === 'number' ? task.brief.chapterNumber : null;
  const chapterNumber = chapter?.chapterNumber ?? briefNumber;
  return chapterNumber === null || chapterNumber === undefined ? '全书' : `第${chapterNumber}章`;
}

export function taskChapterFromBrief(task: TaskData): string {
  const number = typeof task.brief.chapterNumber === 'number' ? task.brief.chapterNumber : null;
  return number === null ? '全书任务' : `第 ${number} 章`;
}

export function taskCheckpointLabel(checkpoint: Record<string, unknown>): string {
  if (Object.keys(checkpoint).length === 0) return '尚未开始';
  const completedPhase = typeof checkpoint.completedPhase === 'string' ? phaseLabel(checkpoint.completedPhase) : null;
  return completedPhase === null ? '已保留当前进度' : `已进行到：${completedPhase}`;
}

export function formatTime(value: string): string {
  return new Intl.DateTimeFormat('zh-CN', { hour: '2-digit', minute: '2-digit' }).format(new Date(value));
}

export function formatNumber(value: number): string {
  return new Intl.NumberFormat('zh-CN').format(value);
}

export function formatBytes(value: number): string {
  if (!Number.isFinite(value) || value < 0) return '未知';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let amount = value;
  let index = 0;
  while (amount >= 1024 && index < units.length - 1) { amount /= 1024; index += 1; }
  return `${amount >= 10 || index === 0 ? amount.toFixed(0) : amount.toFixed(1)} ${units[index]}`;
}

export function budgetModeLabel(mode: string | undefined): string {
  const labels: Record<string, string> = { saving: '省钱', standard: '标准', fine: '精细' };
  return mode === undefined ? '未建立' : labels[mode] ?? mode;
}

export function confirmationLabel(targetType: string): string {
  if (targetType === 'fact') return '重要正式事实';
  if (targetType === 'manuscript') return '正式正文确认';
  return `重大确认：${targetType}`;
}

