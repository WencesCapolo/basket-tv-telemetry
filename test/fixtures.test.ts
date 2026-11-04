import { describe, expect, it, vi } from 'vitest';
import lineCases from '../fixtures/line-cases.json' with { type: 'json' };
import scrubCases from '../fixtures/scrub-cases.json' with { type: 'json' };
import { scrubMessage } from '../src/index.js';
import { emit, type WideEvent } from '../src/log.js';

describe('scrub-cases.json', () => {
  it.each(scrubCases)('$name', ({ input, expected }) => {
    expect(scrubMessage(input)).toBe(expected);
  });
});

describe('line-cases.json', () => {
  it.each(lineCases)('$name', ({ event, expected }) => {
    const write = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    emit(event as WideEvent);
    expect(write.mock.calls).toEqual([[expected + '\n']]);
    write.mockRestore();
  });
});
