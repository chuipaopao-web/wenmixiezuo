const resumableStatuses = new Set([
  'queued',
  'working',
  'waiting_confirmation',
  'failed',
  'blocked',
  'interrupted'
]);

const statusRank = new Map([
  ['blocked', 0],
  ['failed', 0],
  ['interrupted', 0],
  ['queued', 1],
  ['working', 2],
  ['waiting_confirmation', 3]
]);

const phaseRank = new Map([
  ['pending', 0],
  ['preflight', 1],
  ['context', 2],
  ['draft', 3],
  ['hard_check', 4],
  ['review', 5],
  ['revise', 6],
  ['waiting_confirmation', 7],
  ['settlement', 8],
  ['completed', 9]
]);

export function selectResumableChapterTask(tasks, chapterId) {
  return tasks
    .map((task, index) => ({ task, index }))
    .filter(({ task }) => task.chapterId === chapterId && task.taskType === 'chapter_creation')
    .filter(({ task }) => resumableStatuses.has(task.status))
    .sort((left, right) => {
      const statusDifference = (statusRank.get(right.task.status) ?? -1) - (statusRank.get(left.task.status) ?? -1);
      if (statusDifference !== 0) return statusDifference;
      const phaseDifference = (phaseRank.get(right.task.currentPhase) ?? -1) - (phaseRank.get(left.task.currentPhase) ?? -1);
      if (phaseDifference !== 0) return phaseDifference;
      const attemptDifference = Number(right.task.attemptCount ?? 0) - Number(left.task.attemptCount ?? 0);
      return attemptDifference !== 0 ? attemptDifference : right.index - left.index;
    })[0]?.task ?? null;
}
