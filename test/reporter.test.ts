import { createServer, type IncomingHttpHeaders, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createReporter } from '../src/index.js';
import { markError, startEvent, withEvent } from '../src/log.js';

interface Batch {
  v: number;
  events: { name: string; userId: string | null }[];
  errors: { type: string; message: string; stack: string | null; userId: string | null; context: Record<string, unknown> }[];
}

let server: Server | undefined;
afterEach(() => new Promise<void>((done) => (server ? server.close(() => done()) : done())));

/** A fake ingest that answers the n-th POST after `delayMs(n)` ms (never, with Infinity). */
async function ingest(delayMs: (n: number) => number = () => 0) {
  const received: { headers: IncomingHttpHeaders; batch: Batch }[] = [];
  let answered = 0;
  server = createServer((req, res) => {
    res.on('finish', () => (answered += 1));
    let body = '';
    req.on('data', (chunk) => (body += chunk));
    req.on('end', () => {
      const delay = delayMs(received.length);
      received.push({ headers: req.headers, batch: JSON.parse(body) });
      if (delay !== Infinity) setTimeout(() => res.writeHead(204).end(), delay);
    });
  });
  await new Promise<void>((done) => server!.listen(0, '127.0.0.1', done));
  const url = `http://127.0.0.1:${(server!.address() as AddressInfo).port}/ingest/server`;
  return { url, received, answered: () => answered, errors: () => received.flatMap((r) => r.batch.errors) };
}

describe('createReporter', () => {
  it('sends the error scrubbed, with the context filled from the wide event', async () => {
    const { url, received } = await ingest();
    const reporter = createReporter({ app: 'facturacion', ingestUrl: url, token: 'secret-token-123456', release: 'abc123' });
    const event = startEvent('request', { request_id: 'req-12345678', method: 'POST', route: '/api/envios/:id', user_id: 'u1' });
    const err = new Error('Failed query: select 1 params: ana@example.com,15000');
    withEvent(event, () => markError(err));
    event.status = 500;

    reporter.reportServerError(err, { route_type: 'route' });
    reporter.trackServerEvent('invoice_submitted', 'u1', { envio_id: 42 });
    await reporter.flush();

    expect(received).toHaveLength(1);
    expect(received[0]!.headers.authorization).toBe('Bearer secret-token-123456');
    const { v, events, errors } = received[0]!.batch;
    expect(v).toBe(1);
    expect(events).toMatchObject([{ name: 'invoice_submitted', userId: 'u1', props: { envio_id: 42 } }]);
    expect(errors).toMatchObject([{
      source: 'server',
      type: 'Error',
      message: 'Failed query: select #',
      userId: 'u1',
      context: { method: 'POST', route: '/api/envios/:id', status: 500, request_id: 'req-12345678', release: 'abc123', route_type: 'route' },
    }]);
    expect(errors[0]!.stack).toMatch(/^Error: Failed query: select #\n\s+at /);
    expect(errors[0]!.stack).not.toContain('example.com');
  });

  it('appends the scrubbed cause to the message, never the SQL values or params', async () => {
    const { url, errors } = await ingest();
    const reporter = createReporter({ app: 'a', ingestUrl: url, token: 'secret-token-123456' });
    const cause = new Error('connect ECONNREFUSED 10.0.0.5:5432');
    reporter.reportServerError(new Error('Failed query: select "id" from "users" where "email" = $1\nparams: ana@example.com,15000', { cause }));
    await reporter.flush();
    const [sent] = errors();
    expect(sent!.message).toBe('Failed query: select "…" from "…" where "…" = $1\ncaused by Error: connect ECONNREFUSED #:#');
    expect(sent!.stack).toMatch(/^Error: Failed query: select "…" from "…" where "…" = \$1\n\s+at /);
    expect(JSON.stringify(sent)).not.toMatch(/example\.com|15000|users|params|10\.0\.0\.5/);
  });

  it('reports a non-Error throw as NonError with its scrubbed string and no stack', async () => {
    const { url, errors } = await ingest();
    const reporter = createReporter({ app: 'a', ingestUrl: url, token: 'secret-token-123456' });
    reporter.reportServerError('card 4111111111111111 declined', { userId: 'u2', status: 502 });
    await reporter.flush();
    expect(errors()).toMatchObject([{ type: 'NonError', message: 'card # declined', stack: null, userId: 'u2', context: { status: 502 } }]);
  });

  it('flush waits for the POST in flight and sends what is queued', async () => {
    const { url, received, answered, errors } = await ingest((n) => (n === 0 ? 400 : 20));
    const reporter = createReporter({ app: 'a', ingestUrl: url, token: 'secret-token-123456' });
    reporter.reportServerError(new Error('first'));
    const first = reporter.flush();
    reporter.reportServerError(new Error('second'));
    await reporter.flush();

    expect(received).toHaveLength(2);
    expect(answered()).toBe(2);
    expect(errors().map((e) => e.message)).toEqual(['first', 'second']);
    await first;
  });

  it('drops an event with an empty name instead of losing the whole batch', async () => {
    const { url, received } = await ingest();
    const reporter = createReporter({ app: 'a', ingestUrl: url, token: 'secret-token-123456' });
    reporter.trackServerEvent('', 'u1');
    reporter.trackServerEvent('kept', 'u'.repeat(300));
    reporter.reportServerError(new Error('boom'));
    await reporter.flush();
    expect(received[0]!.batch.events).toMatchObject([{ name: 'kept', userId: 'u'.repeat(200) }]);
    expect(received[0]!.batch.errors).toHaveLength(1);
  });

  it('keeps at most 200 items and splits batches at the ingest limit of 100 errors', async () => {
    const { url, received } = await ingest();
    const reporter = createReporter({ app: 'a', ingestUrl: url, token: 'secret-token-123456' });
    for (let i = 0; i < 250; i++) reporter.reportServerError(new Error(`boom ${i}`));
    reporter.trackServerEvent('dropped', null);
    await reporter.flush();
    expect(received.map((r) => r.batch.errors.length)).toEqual([100, 100]);
    expect(received.flatMap((r) => r.batch.events)).toEqual([]);
  });

  it('never throws and gives up on a POST after 1.5 s', async () => {
    const { url } = await ingest(() => Infinity);
    const reporter = createReporter({ app: 'a', ingestUrl: url, token: 'secret-token-123456' });
    const hostile = new Error('x');
    Object.defineProperty(hostile, 'message', { get: () => { throw new Error('getter'); } });
    expect(() => reporter.reportServerError(hostile)).not.toThrow();
    expect(() => reporter.reportServerError({ toString: () => { throw new Error('toString'); } })).not.toThrow();
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    expect(() => reporter.trackServerEvent('cyclic', null, cyclic as never)).not.toThrow();
    expect(() => reporter.trackServerEvent('bigint', null, { n: 1n } as never)).not.toThrow();

    const t0 = performance.now();
    await expect(reporter.flush()).resolves.toBeUndefined();
    expect(performance.now() - t0).toBeGreaterThanOrEqual(1_400);
    expect(performance.now() - t0).toBeLessThan(2_500);
  });

  it('is a no-op without a token', async () => {
    const fetch = vi.spyOn(globalThis, 'fetch');
    const reporter = createReporter({ app: 'a', ingestUrl: 'http://127.0.0.1:1/ingest/server', token: '' });
    reporter.reportServerError(new Error('x'));
    reporter.trackServerEvent('e', null);
    await reporter.flush();
    expect(fetch).not.toHaveBeenCalled();
    fetch.mockRestore();
  });
});
