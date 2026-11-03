// Wide events: one JSON line per unit of work (a request, an action, a job, a
// worker message), built while it runs and written once at the end. The line
// format is a contract the logs collector parses; fixtures/line-cases.json pins it.
import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';
import { describeError } from './scrub.js';
const MAX_BYTES = 8 * 1024;
const CORE = ['ts', 'level', 'kind', 'request_id', 'method', 'route', 'status', 'duration_ms',
    'outcome', 'reason', 'user_id', 'role', 'error', 'sample_rate', 'repeats'];
const REQUEST_ID = /^[A-Za-z0-9-]{8,128}$/;
// Symbol.for, so a bundler that loads this module twice still finds the tag.
const EVENT_OF_ERROR = Symbol.for('basket-tv-telemetry.event');
const als = new AsyncLocalStorage();
/** Write the event as one line on stdout. Undefined and null keys drop out; over 8 KB only the core fields stay. Never throws. */
export function emit(event) {
    try {
        const set = Object.fromEntries(Object.entries(event).filter(([, value]) => value !== undefined && value !== null));
        let line = JSON.stringify(set);
        if (Buffer.byteLength(line) > MAX_BYTES) {
            line = JSON.stringify({ ...Object.fromEntries(CORE.map((k) => [k, set[k]])), truncated: true });
        }
        process.stdout.write(line + '\n');
    }
    catch {
        // a log line must never break the request
    }
}
/** The incoming X-Request-Id when it is safe to reuse, else a new one. */
export const requestId = (incoming) => incoming && REQUEST_ID.test(incoming) ? incoming : randomUUID();
/** A new event. The `undefined` keys only fix the order of the line; `emit` drops the ones never set. */
export const startEvent = (kind, fields = {}) => ({
    ts: new Date().toISOString(), level: 'info', kind, request_id: randomUUID(),
    method: undefined, route: undefined, status: undefined, duration_ms: undefined, outcome: undefined,
    ...fields,
});
/** Run `fn` with `event` as the current event, so `addFields` works anywhere below it. */
export const withEvent = (event, fn) => als.run(event, fn);
export const currentEvent = () => als.getStore();
/** Add fields to the current event (a no-op outside one). */
export function addFields(fields) {
    const event = als.getStore();
    if (event)
        Object.assign(event, fields);
}
export const currentRequestId = () => als.getStore()?.request_id;
/** Mark the event as failed with the error's type and scrubbed message (no stack), and tag the error with the event. */
export function markError(err, event = als.getStore()) {
    if (!event)
        return;
    event.level = 'error';
    event.outcome = 'error';
    event.error = describeError(err);
    if (typeof err === 'object' && err !== null && !Object.isFrozen(err)) {
        Object.defineProperty(err, EVENT_OF_ERROR, { value: event, configurable: true });
    }
}
/** The event `markError` tagged the error with: Next's `onRequestError` runs outside it. */
export const eventOf = (err) => typeof err === 'object' && err !== null ? err[EVENT_OF_ERROR] : undefined;
export const requestIdOf = (err) => eventOf(err)?.request_id;
/** Set duration, status and outcome, then emit. 5xx is an error, 4xx a rejection, unless the handler said otherwise. */
export function finish(event, startedAt, status) {
    event.duration_ms = Math.round(performance.now() - startedAt);
    if (status !== undefined)
        event.status = status;
    if (status !== undefined && status >= 500)
        Object.assign(event, { level: 'error', outcome: 'error' });
    event.outcome ??= status !== undefined && status >= 400 ? 'rejected' : 'ok';
    emit(event);
}
/** A job run or a worker message: `await runLogged(startEvent('job', { route: 'sync_contacts' }), () => sync())`. */
export async function runLogged(event, fn) {
    const t0 = performance.now();
    try {
        return await withEvent(event, fn);
    }
    catch (err) {
        markError(err, event);
        throw err;
    }
    finally {
        finish(event, t0);
    }
}
const seen = new Map();
/** A failure that repeats (a retry loop): emit it once, then at most once per `everyMs` with `repeats` = lines skipped. */
export function emitThrottled(key, event, everyMs = 5 * 60_000) {
    const last = seen.get(key);
    if (last && Date.now() - last.at < everyMs) {
        last.repeats += 1;
        return;
    }
    seen.set(key, { at: Date.now(), repeats: 0 });
    emit(last ? { ...event, repeats: last.repeats } : event);
}
