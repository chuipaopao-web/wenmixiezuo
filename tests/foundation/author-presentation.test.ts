import { describe, expect, it } from 'vitest';
import {
  authorFieldLabel,
  authorFormatScalar,
  projectionForAuthor,
  structuredReplyFromMixedText,
  toAuthorDisplayValue
} from '../../apps/web/src/app/author-presentation';

describe('作者展示层', () => {
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
