import {describe,expect,it} from 'vitest';
import {authorIdeaContextSources} from '../../apps/api/src/application/planning/author-idea-context-sources.js';
import {AUTHOR_IDEA_POLICY_EXECUTION,AUTHOR_IDEA_POLICY_PLANNING} from '../../apps/api/src/domain/author-idea-policy.js';

describe('作者原话四级上下文',()=>{
  it('必须和强烈偏好保证装入，灵感和问题保持软来源且问题不能自动落成正式内容',()=>{
    const ideas=[
      {id:'must-1',intentStrength:'must',originalText:'结局不能牺牲普通人',scopeNotes:null},
      {id:'preference-1',intentStrength:'preference',originalText:'更希望用关系冲突推进',scopeNotes:null},
      {id:'inspiration-1',intentStrength:'inspiration',originalText:'也许可以出现一封旧信',scopeNotes:null},
      {id:'question-1',intentStrength:'question',originalText:'旧友为什么隐瞒身份？',scopeNotes:null}
    ];
    const result=authorIdeaContextSources(ideas,{
      sourceTypePrefix:'owner:test',sourceId:'task-1',layer:'planning'
    });
    expect(result.hardSources.map(source=>source.sourceType)).toEqual(['owner:test:must','owner:test:preference']);
    expect(result.hardSources.map(source=>source.constraintStrength)).toEqual(['current_task','soft_reference']);
    expect(result.optionalSources.map(source=>source.sourceType)).toEqual(['owner:test:inspiration','owner:test:question']);
    expect(result.optionalSources.map(source=>source.constraintStrength)).toEqual(['soft_reference','open_space']);
    expect(result.optionalSources.find(source=>source.sourceType.endsWith(':question'))?.reason)
      .toMatch(/不能自动写入规划或正文/);
    expect(JSON.parse(result.optionalSources[0]!.content)).toEqual([ideas[2]]);
  });

  it('统一提示明确区分强偏好、灵感和问题，执行层也不会把问题当命令',()=>{
    expect(AUTHOR_IDEA_POLICY_PLANNING).toMatch(/preference 是强烈偏好/);
    expect(AUTHOR_IDEA_POLICY_PLANNING).toMatch(/inspiration 只作启发/);
    expect(AUTHOR_IDEA_POLICY_PLANNING).toMatch(/question.*不得自动写入正式方案/);
    expect(AUTHOR_IDEA_POLICY_EXECUTION).toMatch(/question.*不得自动变成章纲或正文/);
  });
});