-- design_review_id: DR-V7-PRODUCTION-WORKFLOW-RECOVERY-74
-- 设定批次需要区分“模型发送前的安全前置条件失败”、已发送后的技术失败
-- 和结果未知。只有明确安全的失败才能在条件恢复后续跑，不能再用错误文案猜测。

ALTER TABLE v7_setting_batches
  ADD COLUMN error_code TEXT;

ALTER TABLE v7_setting_batches
  ADD COLUMN failure_stage TEXT
    CHECK (failure_stage IS NULL OR failure_stage IN ('pre_dispatch','in_dispatch','post_dispatch'));

ALTER TABLE v7_setting_batches
  ADD COLUMN retry_safety TEXT
    CHECK (retry_safety IS NULL OR retry_safety IN (
      'safe_after_precondition','technical_retry','manual_redesign','result_unknown'
    ));

-- 历史批次无法仅凭旧文案安全区分“发送前失败”“结果未知”和“成功但未收口”。
-- 因此本迁移只增加结构，不批量改写作者历史；旧会员门禁任务只在作者主动
-- 点击继续时，由服务核对工单、模型调用和成员事件后逐批恢复。
