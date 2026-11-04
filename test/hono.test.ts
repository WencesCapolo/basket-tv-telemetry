import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { describe, expect, it } from 'vitest';
import { wideEvent } from '../src/hono.js';
import { addFields } from '../src/log.js';
import { captureLines } from './lines.js';

const lines = captureLines();

function app() {
  const app = new Hono();
  app.use('*', wideEvent());
  app.onError((err, c) => (err instanceof HTTPException ? err.getResponse() : c.json({ error: 'internal' }, 500)));
  app.get('/api/health', (c) => c.text('ok'));
  app.get('/api/envios/:id', (c) => {
    c.get('wide').user_id = 'u1';
    addFields({ envio: { id: Number(c.req.param('id')) } });
    return c.json({ ok: true });
  });
  app.post('/api/envios', () => {
    throw new Error('insert failed for ana@example.com');
  });
  app.get('/api/private', () => {
    throw new HTTPException(401);
  });
  app.get('/assets/app.js', (c) => c.text('js'));
  return app;
}

describe('wideEvent', () => {
  it('writes one line with the route pattern, status and duration, and answers with the request id', async () => {
    const res = await app().request('/api/envios/42', { headers: { 'x-request-id': 'incoming-1234' } });
    expect(res.headers.get('x-request-id')).toBe('incoming-1234');
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({
      level: 'info', kind: 'request', request_id: 'incoming-1234', method: 'GET', route: '/api/envios/:id',
      status: 200, outcome: 'ok', user_id: 'u1', envio: { id: 42 },
    });
    expect(lines[0]!.duration_ms).toEqual(expect.any(Number));
  });

  it('logs a thrown error as a 500 with the scrubbed message', async () => {
    const res = await app().request('/api/envios', { method: 'POST' });
    expect(res.status).toBe(500);
    expect(lines).toMatchObject([{
      level: 'error', route: '/api/envios', status: 500, outcome: 'error',
      error: { type: 'Error', message: 'insert failed for …@…' },
    }]);
  });

  it('logs an HTTPException 4xx as rejected', async () => {
    await app().request('/api/private');
    expect(lines).toMatchObject([{ level: 'info', status: 401, outcome: 'rejected' }]);
  });

  it('skips the health check and everything outside /api by default', async () => {
    await app().request('/api/health');
    await app().request('/assets/app.js');
    expect(lines).toEqual([]);
  });
});
