import { afterEach, describe, expect, it } from 'vitest';
import { EventStore } from '../../../apps/api/src/application/events/event-store.js';
import { createServer } from '../../../apps/api/src/http/server.js';
import { FixedClock, SequenceIds, createTestContext, type TestContext } from '../../helpers/test-context.js';

let context: TestContext | undefined;
afterEach(() => { context?.close(); context = undefined; });

describe('SSE持久回放', () => {
  it('连接后先回放after之后的事件信封', async () => {
    context = createTestContext();
    const events = new EventStore(context.database, new SequenceIds(), new FixedClock());
    const event = events.append({ ownerId: context.config.ownerId }, 'worker.health.changed', { status: 'ready' });
    const app = await createServer(context.config, context.database, { trustedTest: true });
    const address = await app.listen({ host: '127.0.0.1', port: 0 });
    const controller = new AbortController();
    try {
      const response = await fetch(`${address}/api/v1/events?after=0`, { signal: controller.signal });
      expect(response.headers.get('content-type')).toContain('text/event-stream');
      const reader = response.body!.getReader();
      const chunk = await reader.read();
      const text = new TextDecoder().decode(chunk.value);
      expect(text).toContain(`id: ${event.eventSeq}`);
      expect(text).toContain('event: worker.health.changed');
      expect(text).toContain('"status":"ready"');
    } finally {
      controller.abort();
      await app.close();
    }
  });
});
