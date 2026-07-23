UPDATE chapters
SET generation_status = 'completed'
WHERE settlement_status = 'settled'
  AND generation_status <> 'completed';
