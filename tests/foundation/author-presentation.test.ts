import { describe, expect, it } from 'vitest';
import {
  authorFactRelationLabel,
  authorFieldLabel,
  authorFormatScalar,
  authorRelationshipLabel,
  containsAuthorTechnicalLeak,
  collectSettingTemplateHints,
  projectionForAuthor,
  structuredReplyFromMixedText,
  toAuthorDisplayValue,
  toAuthorFacingText
} from '../../apps/web/src/app/author-presentation';

describe('作者展示层', () => {
  it('所有界面状态先经过大白话门禁，技术执行细节不能穿透', () => {
    const visible = toAuthorFacingText(
      'Worker 正在读取 ContextPack，checkpoint=prepare_context，taskId=550e8400-e29b-41d4-a716-446655440000。',
      'progress'
    );
    expect(visible).not.toMatch(/Worker|ContextPack|checkpoint|taskId|550e8400/u);
    expect(containsAuthorTechnicalLeak(visible)).toBe(false);
    expect(visible).toContain('正在');

    const error = toAuthorFacingText('SQL failure at C:\\private\\secret.sqlite', 'error');
    expect(error).not.toMatch(/SQL|secret\.sqlite|C:\\/u);
    expect(containsAuthorTechnicalLeak(error)).toBe(false);
  });

  it('小说梗概、正文和作者原话只清协议，不做机械词语替换', () => {
    const prose = '他把密语叫作JSON，越过城墙边界后才发现这是敌人的暗号。';
    expect(toAuthorFacingText(prose, 'story')).toBe(prose);
    expect(toAuthorDisplayValue({ manuscript: prose, fullBookOutline: prose })).toEqual({ manuscript: prose, fullBookOutline: prose });
    expect(authorFormatScalar(prose)).toBe(prose);
  });

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

  it('只在作者展示副本中把抽象说法改成具体的人和事', () => {
    const source = '救援已经从危机事件转化为有边界的长期支持。王怡仍保留自己的边界。';
    expect(toAuthorFacingText(source)).toBe('救援结束后，王怡继续帮助夏炎，但不会替她做决定。王怡仍然自己做决定。');
    expect(source).toContain('边界');
    expect(toAuthorFacingText('两人先说清赔偿边界，再建立可撤回的记录制度。'))
      .toBe('两人先说清赔偿到什么程度；记录可以撤销，再慢慢建立信任。');
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

    expect(value).toEqual({ chapterNumber: 12, status: 'not_extracted', source: 'chapter_outline' });
    expect(authorFormatScalar(value.status)).toBe('暂无可展示内容');
    expect(authorFormatScalar(value.source)).toBe('章纲');
    expect(authorFieldLabel('chapterNumber')).toBe('章节');
  });

  it('把正史事实关系键转换为作者可读名称，不暴露内部英文键', () => {
    expect(authorFactRelationLabel('identity.origin')).toBe('身份来历');
    expect(authorFactRelationLabel('location.appears_in_chapter')).toBe('正文场景');
    expect(authorFactRelationLabel('resource.appears_in_chapter')).toBe('正文出现');
    expect(authorFactRelationLabel('relationship.temporary_alliance')).toBe('人物关系');
    expect(authorFactRelationLabel('protagonist_state.game.withdrawable_revenue')).toBe('可提现收益');
    expect(authorFactRelationLabel('game.revenue_model')).toBe('收益规则');
    expect(authorFactRelationLabel('movement_pattern.recent_route')).toBe('近期行动路线');
    expect(authorRelationshipLabel('relationship.temporary_alliance')).toBe('临时同盟');
    expect(authorFieldLabel('emotionalArc')).toBe('情绪变化');
    expect(authorFieldLabel('endingSituation')).toBe('章末局势');
    expect(authorFactRelationLabel('unknown.machine_key')).toBe('补充事实');
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
    expect(result?.visibleContent).toContain('为什么这样安排：');
    expect(result?.visibleContent).toContain('要留意：');
    expect(result?.visibleContent).toContain('接下来：');
    expect(result?.visibleContent).not.toMatch(/关键依据|风险与未知|下一步：/u);
    expect(result?.visibleContent).not.toContain('规划落库');
    expect(result?.visibleContent).not.toContain('rules');
    expect(result?.fullContent).toContain('证据来自现有正式内容');
  });

  it('AI成员回复也使用作者能直接看懂的说法', () => {
    const contract = JSON.stringify({
      version: 1, format: 'json_object', fields: {
        answer: '王怡要保留自己的边界，夏炎需要一套可撤回的记录制度。',
        keyPoints: [], alternatives: [], risks: [], questions: [], nextStep: '两人先把赔偿边界说清楚。'
      }
    });
    const result = structuredReplyFromMixedText(contract);
    expect(result?.visibleContent).toContain('王怡仍然自己做决定');
    expect(result?.visibleContent).toContain('记录可以撤销');
    expect(result?.visibleContent).toContain('赔偿到什么程度');
    expect(result?.visibleContent).not.toContain('边界');
  });
});
