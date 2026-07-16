UPDATE role_templates
SET display_name = CASE role_key
  WHEN 'chief_editor' THEN '主编'
  WHEN 'plot_architect' THEN '编剧'
  WHEN 'continuity' THEN '设定师'
  WHEN 'writer' THEN '主笔'
  WHEN 'reviewer' THEN '审校'
  WHEN 'reader_experience' THEN '体验官'
  WHEN 'style_editor' THEN '文编'
  WHEN 'researcher' THEN '研究员'
  WHEN 'copyright' THEN '版权顾问'
  ELSE display_name
END
WHERE version = 1
  AND role_key IN (
    'chief_editor', 'plot_architect', 'continuity', 'writer', 'reviewer',
    'reader_experience', 'style_editor', 'researcher', 'copyright'
  );
