import { it } from 'vitest';
it('preserves the original opening engine scenarios', async () => {
  await import('./existing-opening-engine-scenarios.js');
});
