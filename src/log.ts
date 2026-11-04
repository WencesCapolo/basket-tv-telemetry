// Wide events: one JSON line per unit of work (a request, an action, a job, a
// worker message), built while it runs and written once at the end. The line
// format is a contract the logs collector parses; fixtures/line-cases.json pins it.
// node:async_hooks is also in the edge runtime; node:crypto is not, and a stray
// import of this module from edge code must still load (globalThis.crypto instead).
import { AsyncLocalStorage } from 'node:async_hooks';
import { describeError } from './scrub.js';

type Scalar = string | number | boolean | null;
/** One domain thing the unit touched: ids, counts, enums, booleans. Never emails, names, free text or amounts. */
export type Fields = Record<string, Scalar | undefined>;

export interface WideEvent {
  ts: string;
  level: 'info' | 'error';
  kind: 'request' | 'action' | 'job' | 'message' | 'start';
  request_id?: string;
  method?: string;
  route?: string;
  status?: number;
  duration_ms?: number;
  outcome?: 'ok' | 'rejected' | 'error';
  reason?: string;
  user_id?: string;
  role?: string;
  error?: { type: string; message: string };
  sample_rate?: number;
  repeats?: number;
  [key: string]: Scalar | Fields | undefined;
}

const MAX_BYTES = 8 * 1024;
const CORE = ['ts', 'level', 'kind', 'request_id', 'method', 'route', 'status', 'duration_ms',
  'outcome', 'reason', 'user_id', 'role', 'error', 'sample_rate', 'repeats'] as const;
const REQUEST_ID = /^[A-Za-z0-9-]{8,128}$/;
// Symbol.for, so a bundler that loads this module twice still finds the tag.
const EVENT_OF_ERROR = Symbol.for('basket-tv-telemetry.event');
const als = new AsyncLocalStorage<WideEvent>();

/** Write the event as one line on stdout. Undefined and null keys drop out; over 8 KB only the core fields stay. Never throws. */
export function emit(event: WideEvent): void {
  try {
    const set = Object.fromEntries(Object.entries(event).filter(([, value]) => value !== undefined && value !== null));
    let line = JSON.stringify(set);
    if (Buffer.byteLength(line) > MAX_BYTES) {
      line = JSON.stringify({ ...Object.fromEntries(CORE.map((k) => [k, set[k]])), truncated: true });
    }
    process.stdout.write(line + '\n');
  } catch {
    // a log line must never break the request
  }
}

/** The incoming X-Request-Id when it is safe to reuse, else a new one. */
export const requestId = (incoming?: string | null): string =>
  incoming && REQUEST_ID.test(incoming) ? incoming : globalThis.crypto.randomUUID();

/** A new event. The `undefined` keys only fix the order of the line; `emit` drops the ones never set. */
export const startEvent = (kind: WideEvent['kind'], fields: Partial<WideEvent> = {}): WideEvent => ({
  ts: new Date().toISOString(), level: 'info', kind, request_id: globalThis.crypto.randomUUID(),
  method: undefined, route: undefined, status: undefined, duration_ms: undefined, outcome: undefined,
  ...fields,
});

/** Run `fn` with `event` as the current event, so `addFields` works anywhere below it. */
export const withEvent = <T>(event: WideEvent, fn: () => T): T => als.run(event, fn);

export const currentEvent = (): WideEvent | undefined => als.getStore();

/** Add fields to the current event (a no-op outside one). */
export function addFields(fields: Partial<WideEvent>): void {
  const event = als.getStore();
  if (event) Object.assign(event, fields);
}

export const currentRequestId = (): string | undefined => als.getStore()?.request_id;

/** Mark the event as failed with the error's type and scrubbed message (no stack), and tag the error with the event. */
export function markError(err: unknown, event = als.getStore()): void {
  if (!event) return;
  event.level = 'error';
  event.outcome = 'error';
  event.error = describeError(err);
  if (typeof err === 'object' && err !== null && !Object.isFrozen(err)) {
    Object.defineProperty(err, EVENT_OF_ERROR, { value: event, configurable: true });
  }
}

/** The event `markError` tagged the error with: Next's `onRequestError` runs outside it. */
export const eventOf = (err: unknown): WideEvent | undefined =>
  typeof err === 'object' && err !== null ? (err as { [EVENT_OF_ERROR]?: WideEvent })[EVENT_OF_ERROR] : undefined;

export const requestIdOf = (err: unknown): string | undefined => eventOf(err)?.request_id;

/** Set duration, status and outcome, then emit. 5xx is an error, 4xx a rejection, unless the handler said otherwise. */
export function finish(event: WideEvent, startedAt: number, status?: number): void {
  event.duration_ms = Math.round(performance.now() - startedAt);
  if (status !== undefined) event.status = status;
  if (status !== undefined && status >= 500) Object.assign(event, { level: 'error', outcome: 'error' });
  event.outcome ??= status !== undefined && status >= 400 ? 'rejected' : 'ok';
  emit(event);
}

/** A job run or a worker message: `await runLogged(startEvent('job', { route: 'sync_contacts' }), () => sync())`. */
export async function runLogged<T>(event: WideEvent, fn: () => Promise<T>): Promise<T> {
  const t0 = performance.now();
  try {
    return await withEvent(event, fn);
  } catch (err) {
    markError(err, event);
    throw err;
  } finally {
    finish(event, t0);
  }
}

const MAX_THROTTLED_KEYS = 1_000;
const seen = new Map<string, { at: number; repeats: number }>();
/**
 * A failure that repeats (a retry loop): emit it once, then at most once per `everyMs`
 * with `repeats` = lines skipped, when any were.
 */
export function emitThrottled(key: string, event: WideEvent, everyMs = 5 * 60_000): void {
  const now = Date.now();
  const last = seen.get(key);
  if (last && now - last.at < everyMs) {
    last.repeats += 1;
    return;
  }
  seen.delete(key);
  // Expired keys with no skipped lines have nothing left to report; past the cap the oldest go.
  for (const [k, entry] of seen) {
    if (seen.size < MAX_THROTTLED_KEYS && (entry.repeats > 0 || now - entry.at < everyMs)) continue;
    seen.delete(k);
  }
  seen.set(key, { at: now, repeats: 0 });
  emit(last && last.repeats > 0 ? { ...event, repeats: last.repeats } : event);
}
