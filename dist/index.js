// The server reporter: errors and business events to basket-telemetry's local
// ingest, batched. It never throws into the caller, nothing on a response path
// waits on it, and without a token it does nothing at all.
import { currentEvent, eventOf } from './log.js';
import { describeError, scrubStack } from './scrub.js';
export { scrubMessage, scrubStack } from './scrub.js';
export const DEFAULT_INGEST_URL = 'http://127.0.0.1:3011/ingest/server';
const BATCH_MS = 1_000;
const TIMEOUT_MS = 1_500;
/** A down ingest drops what is past this instead of growing memory. */
const MAX_QUEUED = 200;
// The ingest refuses a whole batch over these (256 KB, 100 errors, 500 events).
const MAX_BATCH_BYTES = 200 * 1024;
const MAX_BATCH_ERRORS = 100;
const NOOP = {
    reportServerError: () => { },
    trackServerEvent: () => { },
    flush: async () => { },
};
export function createReporter(options) {
    if (!options.token)
        return NOOP;
    const url = options.ingestUrl || DEFAULT_INGEST_URL;
    const headers = {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${options.token}`,
        'User-Agent': `basket-tv-telemetry (${options.app})`,
    };
    const source = options.source ?? 'server';
    let queue = [];
    let timer = null;
    const inFlight = new Set();
    async function post(body) {
        const abort = new AbortController();
        const timeout = setTimeout(() => abort.abort(), TIMEOUT_MS);
        try {
            const res = await fetch(url, { method: 'POST', headers, body, signal: abort.signal });
            await res.body?.cancel();
        }
        catch {
            // the ingest is down or slow: the batch is lost, the app is not
        }
        finally {
            clearTimeout(timeout);
        }
    }
    function send() {
        if (timer)
            clearTimeout(timer);
        timer = null;
        if (queue.length === 0)
            return Promise.resolve();
        const items = queue;
        queue = [];
        const sending = Promise.all(batches(items).map(post)).then(() => { });
        inFlight.add(sending);
        void sending.finally(() => inFlight.delete(sending));
        return sending;
    }
    function enqueue(item) {
        try {
            if (queue.length >= MAX_QUEUED)
                return;
            const built = item();
            queue.push({ item: built, bytes: Buffer.byteLength(JSON.stringify(built)) });
            if (!timer) {
                timer = setTimeout(() => void send(), BATCH_MS);
                timer.unref();
            }
        }
        catch {
            // nothing here reaches the caller
        }
    }
    return {
        reportServerError(err, context = {}) {
            enqueue(() => {
                const event = eventOf(err) ?? currentEvent();
                const { userId, ...rest } = context;
                const { type, message } = describeError(err);
                return {
                    errors: {
                        ts: Date.now(),
                        source,
                        type,
                        message,
                        stack: err instanceof Error ? scrubStack(err) : null,
                        userId: (userId ?? event?.user_id ?? null)?.slice(0, 200) ?? null,
                        context: {
                            method: event?.method,
                            route: event?.route,
                            status: event?.status,
                            request_id: event?.request_id,
                            release: options.release,
                            ...Object.fromEntries(Object.entries(rest).filter(([, value]) => value !== undefined)),
                        },
                    },
                };
            });
        },
        trackServerEvent(name, userId, props = {}) {
            // The ingest refuses a whole batch, errors included, over one empty name.
            if (!name)
                return;
            enqueue(() => ({ events: { name: name.slice(0, 200), ts: Date.now(), userId: userId?.slice(0, 200) ?? null, props } }));
        },
        async flush() {
            await Promise.all([...inFlight, send()]);
        },
    };
}
/** Split the queue so no batch goes over the ingest's limits. */
function batches(queued) {
    const out = [];
    let events = [];
    let errors = [];
    let bytes = 0;
    const close = () => {
        if (events.length + errors.length > 0)
            out.push(JSON.stringify({ v: 1, events, errors }));
        events = [];
        errors = [];
        bytes = 0;
    };
    for (const { item, bytes: size } of queued) {
        if (bytes + size > MAX_BATCH_BYTES || ('errors' in item && errors.length >= MAX_BATCH_ERRORS))
            close();
        if ('errors' in item)
            errors.push(item.errors);
        else
            events.push(item.events);
        bytes += size;
    }
    close();
    return out;
}
const installed = new WeakSet();
/**
 * On SIGINT or SIGTERM, flush, then exit with the code the signal would have
 * given (130, 143); a second signal exits at once. When the app listens to the
 * signal too, it only flushes: exiting would cut the app's own shutdown short.
 * Without a token there is nothing to flush, so nothing is installed.
 */
export function installShutdownFlush(reporter) {
    if (reporter === NOOP || installed.has(reporter))
        return;
    installed.add(reporter);
    let stopping = false;
    const onSignal = (signal) => {
        const code = signal === 'SIGINT' ? 130 : 143;
        if (process.listenerCount(signal) > 1) {
            void reporter.flush();
            return;
        }
        if (stopping)
            process.exit(code);
        stopping = true;
        void reporter.flush().finally(() => process.exit(code));
    };
    process.on('SIGINT', onSignal);
    process.on('SIGTERM', onSignal);
}
