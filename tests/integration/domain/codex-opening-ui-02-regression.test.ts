import { afterEach, describe, expect, it } from 'vitest';
import { parseOpeningPackage } from '../../../rebuild/packages/backend/src/legacy-opening/opening-agent/opening-output-validation.js';
import { V7_OPENING_TAXONOMY_REFERENCE } from '../../../apps/api/src/application/books/v7-opening-package-contract.js';
import { TimeMachineDesignService } from '../../../apps/api/src/application/books/time-machine-design-service.js';
import { TimeMachineModelGateway } from '../../../apps/api/src/infrastructure/models/time-machine-model-gateway.js';
import { createTestContext as createBaseContext, type TestContext } from '../../helpers/test-context.js';
import {
  NOVEL_PACKAGE,
  SHORT_PACKAGE,
  seedBookWithWorkType,
  timeMachineRunCount
} from '../../helpers/opening-work-type-fixtures.js';

// Codex OPENING-UI-02 独立反例的正式化（OPENING-NOVEL-CLOSE-01）：原四条反例断言改为
// 自包含的真实测试——不再读取 .local 诊断脚本/JSON（原证据文件留在原目录仅供追溯，不进Git）。
// 1) 300万字长篇解析接受（长篇旧合同不放宽）；2) 1万字短篇解析接受，不再被强制10万字下限；
// 3) 短篇/自传/剧本不能借服务层启动长篇时光机：写任务/排队/占预算之前拒绝，0任务0模型调用。
let context: TestContext | undefined;
afterEach(() => { context?.close(); context = undefined; });

describe('Codex OPENING-UI-02 independent regressions', () => {
  it('accepts a 10,000-character opening rather than forcing a long novel minimum', () => {
    expect(
      parseOpeningPackage(JSON.stringify(NOVEL_PACKAGE), V7_OPENING_TAXONOMY_REFERENCE).positioning.expectedTotalWords
    ).toBe(3_000_000);
    expect(
      parseOpeningPackage(JSON.stringify(SHORT_PACKAGE), V7_OPENING_TAXONOMY_REFERENCE, undefined, 'short_story')
        .positioning.expectedTotalWords
    ).toBe(10_000);
  });

  it.each(['short_story', 'memoir', 'script'] as const)('blocks unsupported %s from starting the long-novel time machine', (workType) => {
    context = createBaseContext(`wenmi-codex-regression-${workType}-`);
    const ownerId = context.config.ownerId;
    context.database.prepare('INSERT INTO owners VALUES(?,?,1,?,?)').run(ownerId, '反例验收', '2026-09-19', '2026-09-19');
    let modelCalls = 0;
    const gateway = new TimeMachineModelGateway(context.database, () => { modelCalls += 1; throw new Error('Model calls forbidden'); });
    const service = new TimeMachineDesignService(context.database, gateway, 64_000);
    const bookId = `codex-${workType}`;
    seedBookWithWorkType(context.database, ownerId, bookId, workType);
    expect(() => service.start({ ownerId, bookId }, 'recommend', '', `codex-start-${workType}`)).toThrow(/尚未开放/);
    expect(timeMachineRunCount(context.database, bookId)).toBe(0);
    expect(modelCalls).toBe(0);
  });
});
