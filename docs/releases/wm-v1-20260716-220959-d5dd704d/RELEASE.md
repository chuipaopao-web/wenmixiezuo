# 首版发布清单

- `release_id`：`wm-v1-20260716-220959-d5dd704d`
- 产品显示名称：文脉写作
- 开工日期：2026-07-16
- 唯一开发者：当前Codex
- 复核方式：同一Codex在任务实现后以独立命令和保存证据复核
- Git范围：仅本地 `main` 分支；未配置远程
- 数据目录：`D:\wenmixiezuo\data`（不进入Git）
- Web/API：`127.0.0.1:43110` / `127.0.0.1:43111`
- 现金费用保护线：未获单次明确授权前为0
- 模型策略：默认确定性假模型；真实API Key只允许从环境变量读取
- 第二物理备份：未配置，不声明防本机硬盘损坏

## 阶段状态

| 阶段 | 状态 | 验收包 |
|---:|---|---|
| 开工基线 | 已通过 | `stages/00-baseline.md` |
| 1 | 已通过 | `stages/01-foundation.md` |
| 2 | 进行中 | `stages/02-data-safety.md` |
| 3 | 待开始 | `stages/03-runtime.md` |
| 4 | 待开始 | `stages/04-domain.md` |
| 5 | 待开始 | `stages/05-memory-canon.md` |
| 6 | 待开始 | `stages/06-creation.md` |
| 7 | 待开始 | `stages/07-experience.md` |
| 8 | 待开始 | `stages/08-release.md` |

阶段状态只有在对应验收证据与当前提交一致后才更新。整个首版是否达到完成标准只以 `docs/ACCEPTANCE.md` 和最终签署为准。
