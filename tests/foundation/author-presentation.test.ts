import { describe, expect, it } from 'vitest';
import {
  authorFieldLabel,
  authorFormatScalar,
  collectSettingTemplateHints,
  projectionForAuthor,
  structuredReplyFromMixedText,
  toAuthorDisplayValue
} from '../../apps/web/src/app/author-presentation';

describe('作者展示层', () => {
  it('只展示语义设定提示，并在清理句末标点后去重', () => {
    const hints = collectSettingTemplateHints([{
      active_content: {
        positioning: {
          premise: { value: '游戏体育。' },
          genre: { value: '游戏体育' },
          classification: { value: '男频' }
        },
        tags: [
          { name: '游戏体育。', category: 'dynamic', sourceStatus: 'explicit' },
          { name: '历史脑洞', category: 'dynamic', sourceStatus: 'explicit' },
          { name: '必须遵守：不降智', category: 'dynamic', sourceStatus: 'explicit' }
        ]
      }
    }]);

    expect(hints).toEqual(['游戏体育', '历史脑洞']);
    expect(hints).not.toContain('dynamic');
    expect(hints).not.toContain('explicit');
  });

  it('解析嵌套JSON并隐藏内部标识、哈希和原始来源ID', () => {
    const value = toAuthorDisplayValue({
      projection_id: 'projection-secret', owner_id: 'owner-secret', book_id: 'book-secret',
      content_json: JSON.stringify({ title: '把塔停下来', goal: '阻止灰塔撞上居民区', status: 'active' }),
      source_ids_json: JSON.stringify(['source-secret']), rebuilt_at: '2026-07-25T01:00:00Z'
    });

    expect(value).toEqual({
      content: { title: '把塔停下来', goal: '阻止灰塔撞上居民区', status: 'active' },
      sourceRecorded: true
    });
    expect(JSON.stringify(value)).not.toContain('secret');
  });

  it('恢复双重转义JSON；无法解析的机器载荷不直接裸露', () => {
    expect(toAuthorDisplayValue('{\\"title\\":\\"停下灰塔\\",\\"goal\\":\\"保护居民\\"}')).toEqual({
      title: '停下灰塔', goal: '保护居民'
    });
    expect(String(toAuthorDisplayValue('{\\"title\\":broken}'))).toContain('格式异常');
    expect(String(toAuthorDisplayValue('{\\"title\\":broken}'))).not.toContain('title');
  });

  it('保留规划正文并移除尾部机器协议，同时把历史枚举和值转换为中文', () => {
    const mixed = '建议先完成灰塔审计，再进入迁移。\n章节跨度估算 {"minimum":10,"recommended":10,"maximum":12,"units":[{"unit":"审计推进","suggestedChapters":3}]}';
    expect(toAuthorDisplayValue(mixed)).toBe('建议先完成灰塔审计，再进入迁移。');
    expect(authorFormatScalar('selected_manuscript')).toBe('正式正文');
    expect(authorFormatScalar('dynamic')).toBe('按本书动态整理');
    expect(authorFormatScalar('posterior_neck_pain_and_visual_flash')).toBe('后颈疼痛并伴有视觉闪光');
    expect(authorFormatScalar('severe_pain_with_mobility_loss')).toBe('剧烈疼痛并伴有活动受限');
  });

  it('移除剧情总纲和卷纲的内部落库合同', () => {
    expect(toAuthorDisplayValue('这是给作者看的剧情总纲结论。\n剧情总纲落库 {"premise":"内部结构"}'))
      .toBe('这是给作者看的剧情总纲结论。');
    expect(toAuthorDisplayValue('这是给作者看的卷纲结论。\n卷纲落库 {"title":"内部结构"}'))
      .toBe('这是给作者看的卷纲结论。');
  });

  it('把图谱原始记录转换为章节结果，不显示投影协议字段', () => {
    const value = projectionForAuthor({
      projection_id: 'p-1', projection_type: 'emotion', track: 'actual', chapter_number: 12,
      canon_revision: 8, content_json: '{"status":"not_extracted","source":"chapter_outline"}'
    });

    expect(value).toEqual({ chapterNumber: 12, status: 'not_extracted', source: 'chapter_outline', canonRevision: 8 });
    expect(authorFormatScalar(value.status)).toBe('暂无可展示内容');
    expect(authorFormatScalar(value.source)).toBe('章纲');
    expect(authorFieldLabel('chapterNumber')).toBe('章节');
  });

  it('从历史混杂回复中恢复自然主编结论，不展示JSON合同与落库数据', () => {
    const contract = JSON.stringify({
      version: 1, format: 'json_object', fields: {
        answer: '第一阶段先解决灰塔迁移。', keyPoints: ['先核对账簿'], alternatives: [],
        risks: ['水源不足'], questions: [], nextStep: '锁定方向后细化下一章', details: '证据来自现有正史。'
      }, rules: ['内部规则']
    });
    const result = structuredReplyFromMixedText(`【婉儿】原始意见\n${contract}\n规划落库 {"chapters":[1,2,3]}`);

    expect(result?.visibleContent).toContain('第一阶段先解决灰塔迁移');
    expect(result?.visibleContent).not.toContain('规划落库');
    expect(result?.visibleContent).not.toContain('rules');
    expect(result?.fullContent).toContain('证据来自现有正史');
  });
});
