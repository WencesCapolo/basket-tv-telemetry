import { afterEach, describe, expect, it, vi } from 'vitest';
import { createReporter, installShutdownFlush } from '../src/index.js';

const reporter = () => createReporter({ app: 'a', ingestUrl: 'http://127.0.0.1:1/ingest/server', token: 'secret-token-123456' });

afterEach(() => {
  process.removeAllListeners('SIGTERM');
  process.removeAllListeners('SIGINT');
  vi.restoreAllMocks();
});

describe('installShutdownFlush', () => {
  it('installs nothing without a token', () => {
    installShutdownFlush(createReporter({ app: 'a', token: undefined }));
    expect(process.listenerCount('SIGTERM') + process.listenerCount('SIGINT')).toBe(0);
  });

  it('flushes, then exits with the signal code when it is the only handler', async () => {
    const r = reporter();
    const flush = vi.spyOn(r, 'flush');
    const exit = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never);
    installShutdownFlush(r);
    process.emit('SIGTERM', 'SIGTERM');
    expect(flush).toHaveBeenCalledOnce();
    await vi.waitFor(() => expect(exit).toHaveBeenCalledWith(143));
  });

  it('only flushes when the app handles the signal too, so its own shutdown runs to the end', async () => {
    const r = reporter();
    const flush = vi.spyOn(r, 'flush');
    const exit = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never);
    const appShutdown = vi.fn();
    process.on('SIGTERM', appShutdown);
    installShutdownFlush(r);
    process.emit('SIGTERM', 'SIGTERM');
    await r.flush();
    expect(appShutdown).toHaveBeenCalledOnce();
    expect(flush).toHaveBeenCalled();
    expect(exit).not.toHaveBeenCalled();
  });
});
