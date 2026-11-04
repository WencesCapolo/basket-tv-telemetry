import { describe, expect, it, vi } from 'vitest';
import { emitThrottled, markError, requestId, startEvent } from '../src/log.js';
import { captureLines } from './lines.js';

const lines = captureLines();

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe('requestId', () => {
  it('makes a new UUID unless the incoming id is safe to reuse', () => {
    expect(requestId()).toMatch(UUID);
    expect(requestId('bad id!')).toMatch(UUID);
    expect(requestId('incoming-1234')).toBe('incoming-1234');
    expect(startEvent('job').request_id).toMatch(UUID);
  });
});

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
