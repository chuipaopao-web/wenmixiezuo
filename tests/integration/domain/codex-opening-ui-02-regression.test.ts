import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import '../../../.local/dispatch-evidence/opening-ui-02-20260918/codex-offline-check.js';

const evidence = JSON.parse(readFileSync(new URL('../../../.local/dispatch-evidence/opening-ui-02-20260918/codex-offline-check.json', import.meta.url), 'utf8'));
describe('Codex OPENING-UI-02 independent regressions', () => {
  it('accepts a 10,000-character opening rather than forcing a long novel minimum', () => {
    expect(evidence.parse_3000000).toBe('accepted');
    expect(evidence.parse_10000).toBe('accepted');
  });
  it.each(['short_story', 'memoir', 'script'])('blocks unsupported %s from starting the long-novel time machine', (workType) => {
    expect(evidence[workType + '_time_machine_start'].accepted).toBe(false);
  });
});
