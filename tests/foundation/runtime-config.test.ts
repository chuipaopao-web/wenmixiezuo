import { describe, expect, it } from 'vitest';
import { loadRuntimeConfig } from '../../apps/api/src/infrastructure/runtime-config.js';

describe('本机监听门禁', () => {
  it('拒绝监听非回环地址', () => {
    expect(() => loadRuntimeConfig({
      WENMI_PROJECT_ROOT: process.cwd(),
      WENMI_API_HOST: '0.0.0.0'
    })).toThrow('只允许监听127.0.0.1');
  });

  it('默认端口和目录符合DEC-002', () => {
    const config = loadRuntimeConfig({ WENMI_PROJECT_ROOT: process.cwd() });
    expect(config.apiHost).toBe('127.0.0.1');
    expect(config.apiPort).toBe(43111);
    expect(config.webOrigin).toBe('http://127.0.0.1:43110');
    expect(config.promptViewPassword).toBeNull();
    expect(config.dataDir.endsWith('wenmixiezuo\\data') || config.dataDir.endsWith('wenmixiezuo/data')).toBe(true);
  });

  it('只从环境变量读取完整提示词查看密码', () => {
    const config = loadRuntimeConfig({
      WENMI_PROJECT_ROOT: process.cwd(),
      WENMI_PROMPT_VIEW_PASSWORD: '  local-owner-password  '
    });
    expect(config.promptViewPassword).toBe('local-owner-password');
  });
});
