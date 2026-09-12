-- R192速度与上下文红线：记录每次调用的提示词字符数（老板红线：设计成员单次上下文≤1.5万字）。
-- 可空列向后兼容；旧行保持NULL，仅在网关写入后才有值。
ALTER TABLE tm2_model_calls ADD COLUMN prompt_chars INTEGER;
