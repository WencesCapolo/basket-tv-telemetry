import { type ErrorDescription } from './scrub.js';
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
    error?: ErrorDescription;
    sample_rate?: number;
    repeats?: number;
    [key: string]: Scalar | Fields | ErrorDescription | undefined;
}
/** Write the event as one line on stdout. Undefined and null keys drop out; over 8 KB only the core fields stay. Never throws. */
export declare function emit(event: WideEvent): void;
/** The incoming X-Request-Id when it is safe to reuse, else a new one. */
export declare const requestId: (incoming?: string | null) => string;
/** A new event. The `undefined` keys only fix the order of the line; `emit` drops the ones never set. */
export declare const startEvent: (kind: WideEvent["kind"], fields?: Partial<WideEvent>) => WideEvent;
/** Run `fn` with `event` as the current event, so `addFields` works anywhere below it. */
export declare const withEvent: <T>(event: WideEvent, fn: () => T) => T;
export declare const currentEvent: () => WideEvent | undefined;
/** Add fields to the current event (a no-op outside one). */
export declare function addFields(fields: Partial<WideEvent>): void;
export declare const currentRequestId: () => string | undefined;
/** Mark the event as failed with the error's type, scrubbed message and cause (no stack), and tag the error with the event. */
export declare function markError(err: unknown, event?: WideEvent | undefined): void;
/** The event `markError` tagged the error with: Next's `onRequestError` runs outside it. */
export declare const eventOf: (err: unknown) => WideEvent | undefined;
export declare const requestIdOf: (err: unknown) => string | undefined;
/** Set duration, status and outcome, then emit. 5xx is an error, 4xx a rejection, unless the handler said otherwise. */
export declare function finish(event: WideEvent, startedAt: number, status?: number): void;
/** A job run or a worker message: `await runLogged(startEvent('job', { route: 'sync_contacts' }), () => sync())`. */
export declare function runLogged<T>(event: WideEvent, fn: () => Promise<T>): Promise<T>;
/**
 * A failure that repeats (a retry loop): emit it once, then at most once per `everyMs`
 * with `repeats` = lines skipped, when any were.
 */
export declare function emitThrottled(key: string, event: WideEvent, everyMs?: number): void;
export {};
