-- 记录模型调用失败时的真实错误（脱敏、截断），供任务详情与运维排查。
-- 背景：provider 4xx（如"提示词超长"返回 400）此前只落 error_class，
-- 真实消息在 server 错误映射中被吞成通用 INVALID_REQUEST_BODY，
-- 导致"讨论任务重试 17 次全失败但看不到原因"这类事故无法诊断。
ALTER TABLE model_calls ADD COLUMN error_detail TEXT;
