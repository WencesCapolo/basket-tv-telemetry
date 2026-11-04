import { afterEach, beforeEach, vi } from 'vitest';

/** The JSON lines `emit` writes during a test, parsed. */
export function captureLines(): Record<string, unknown>[] {
  const lines: Record<string, unknown>[] = [];
  beforeEach(() => {
    lines.length = 0;
    vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
      for (const line of String(chunk).split('\n').filter(Boolean)) lines.push(JSON.parse(line));
      return true;
    });
  });
  afterEach(() => vi.restoreAllMocks());
  return lines;
}
