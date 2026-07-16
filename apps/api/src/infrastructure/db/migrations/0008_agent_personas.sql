UPDATE role_templates
SET display_name = CASE role_key
  WHEN 'chief_editor' THEN '主编'
  WHEN 'plot_architect' THEN '剧情'
  WHEN 'continuity' THEN '设定'
  WHEN 'writer' THEN '主笔'
  WHEN 'reviewer' THEN '审校'
  WHEN 'reader_experience' THEN '读者'
  WHEN 'style_editor' THEN '文风'
  WHEN 'researcher' THEN '考据'
  WHEN 'copyright' THEN '版权'
  ELSE display_name
END
WHERE version = 1
  AND role_key IN (
    'chief_editor', 'plot_architect', 'continuity', 'writer', 'reviewer',
    'reader_experience', 'style_editor', 'researcher', 'copyright'
  );

UPDATE agent_instances
SET display_name = CASE role_template_id
  WHEN 'role-chief-editor' THEN '貂蝉'
  WHEN 'role-plot-architect' THEN '婉儿'
  WHEN 'role-continuity' THEN '文姬'
  WHEN 'role-writer' THEN '秋香'
  WHEN 'role-reviewer' THEN '妲己'
  WHEN 'role-reader-experience' THEN '昭君'
  WHEN 'role-style-editor' THEN '清照'
  WHEN 'role-researcher' THEN '道韫'
  WHEN 'role-copyright' THEN '弄玉'
  ELSE display_name
END
WHERE role_template_version = 1
  AND role_template_id IN (
    'role-chief-editor', 'role-plot-architect', 'role-continuity', 'role-writer', 'role-reviewer',
    'role-reader-experience', 'role-style-editor', 'role-researcher', 'role-copyright'
  );
