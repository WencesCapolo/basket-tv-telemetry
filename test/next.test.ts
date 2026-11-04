import { notFound, redirect } from 'next/navigation.js';
import { describe, expect, it } from 'vitest';
import { addFields, requestIdOf } from '../src/log.js';
import { withActionLog, withRequestLog } from '../src/next.js';
import { captureLines } from './lines.js';

const lines = captureLines();
const ctx = { params: Promise.resolve({ id: '42' }) };

describe('withRequestLog', () => {
  it('writes one line with the route, status and duration, and sets X-Request-Id', async () => {
    const POST = withRequestLog('/api/envios/[id]', async () => {
      addFields({ user_id: 'u1', envio: { id: 42 } });
      return Response.json({ ok: true }, { status: 201 });
    });
    const res = await POST(new Request('http://app.test/api/envios/42', { method: 'POST' }), ctx);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({
      level: 'info', kind: 'request', method: 'POST', route: '/api/envios/[id]', status: 201, outcome: 'ok', user_id: 'u1',
    });
    expect(lines[0]!.duration_ms).toEqual(expect.any(Number));
    expect(res.headers.get('x-request-id')).toBe(lines[0]!.request_id);
  });

  it('logs a thrown error as a 500, tags it with the request id and rethrows it', async () => {
    const err = new Error('boom');
    const GET = withRequestLog('/api/envios/[id]', async () => {
      throw err;
    });
    await expect(GET(new Request('http://app.test/api/envios/42'), ctx)).rejects.toBe(err);
    expect(lines).toMatchObject([{ level: 'error', status: 500, outcome: 'error', error: { type: 'Error', message: 'boom' } }]);
    expect(requestIdOf(err)).toBe(lines[0]!.request_id);
  });

  it('lets redirect() and notFound() through as ok, without a status', async () => {
    const toLogin = withRequestLog('/api/a', () => redirect('/login'));
    const missing = withRequestLog('/api/b', () => notFound());
    await expect(toLogin(new Request('http://app.test/api/a'), ctx)).rejects.toMatchObject({ digest: expect.stringContaining('NEXT_REDIRECT') });
    await expect(missing(new Request('http://app.test/api/b'), ctx)).rejects.toBeDefined();
    expect(lines).toHaveLength(2);
    for (const line of lines) {
      expect(line).toMatchObject({ level: 'info', outcome: 'ok' });
      expect(line).not.toHaveProperty('status');
      expect(line).not.toHaveProperty('error');
    }
  });
});

describe('withActionLog', () => {
  it('logs an { ok: false } result as rejected, keeping the reason the action set', async () => {
    const createEnvio = withActionLog('createEnvio', async (id: number) => {
      addFields({ reason: 'envio_locked', envio: { id } });
      return { ok: false as const };
    });
    await expect(createEnvio(7)).resolves.toEqual({ ok: false });
    expect(lines).toMatchObject([{ kind: 'action', route: 'createEnvio', outcome: 'rejected', reason: 'envio_locked', envio: { id: 7 } }]);
    expect(lines[0]).not.toHaveProperty('status');
  });

  it('logs a thrown error and rethrows it, and lets redirect() through', async () => {
    const failing = withActionLog('failing', async () => {
      throw new TypeError('bad');
    });
    const redirecting = withActionLog('redirecting', async () => redirect('/done'));
    await expect(failing()).rejects.toThrow('bad');
    await expect(redirecting()).rejects.toBeDefined();
    expect(lines).toMatchObject([
      { route: 'failing', level: 'error', outcome: 'error', error: { type: 'TypeError', message: 'bad' } },
      { route: 'redirecting', level: 'info', outcome: 'ok' },
    ]);
  });
});
