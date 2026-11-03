import { describe, expect, it, vi } from 'vitest';
import { emitThrottled, markError, startEvent } from '../src/log.js';
import { captureLines } from './lines.js';

const lines = captureLines();

describe('markError', () => {
  it('never throws on an error whose getters throw, so the wrappers rethrow the original', () => {
    const hostile = new Error('x');
    for (const key of ['message', 'name']) {
      Object.defineProperty(hostile, key, { get: () => { throw new Error('getter'); } });
    }
    const event = startEvent('request');
    expect(() => markError(hostile, event)).not.toThrow();
    expect(event.error).toEqual({ type: 'Error', message: '' });
  });
});

describe('emitThrottled', () => {
  it('emits once per window, with repeats only when lines were skipped', () => {
    vi.useFakeTimers();
    const event = { ...startEvent('job', { route: 'sync' }), level: 'error' as const };
    emitThrottled('sync:down', event, 1_000);
    emitThrottled('sync:down', event, 1_000);
    emitThrottled('sync:down', event, 1_000);
    vi.advanceTimersByTime(1_000);
    emitThrottled('sync:down', event, 1_000);
    vi.advanceTimersByTime(1_000);
    emitThrottled('sync:down', event, 1_000);
    vi.useRealTimers();
    expect(lines.map((l) => l.repeats)).toEqual([undefined, 2, undefined]);
  });
});
