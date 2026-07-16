export type ArtifactType = 'creative_plan' | 'story_bible' | 'master_outline' | 'volume_outline' | 'chapter_outline' | 'writing_contract';

const requiredKeys: Record<ArtifactType, string[]> = {
  creative_plan: ['premise', 'audience', 'tone', 'constraints'],
  story_bible: ['title', 'positioning', 'worldRules', 'characters', 'mainPlot'],
  master_outline: ['premise', 'acts', 'endingDirection'],
  volume_outline: ['volumeNumber', 'goal', 'arcs', 'endingState'],
  chapter_outline: ['chapterNumber', 'goal', 'beats', 'hook'],
  writing_contract: ['chapterId', 'pov', 'tense', 'targetWords', 'hardConstraints']
};

export function validateArtifactContent(type: ArtifactType, content: Record<string, unknown>): void {
  const missing = requiredKeys[type].filter((key) => !(key in content));
  if (missing.length > 0) throw new Error(`${type}缺少必填字段：${missing.join(', ')}`);
  if (type === 'writing_contract') {
    const targetWords = content.targetWords;
    if (!Number.isInteger(targetWords) || Number(targetWords) < 500) throw new Error('写作契约targetWords必须是不小于500的整数');
  }
}
