export { scrubMessage, scrubStack } from './scrub.js';
export declare const DEFAULT_INGEST_URL = "http://127.0.0.1:3011/ingest/server";
type Scalar = string | number | boolean | null;
/** Ids, counts and enums only: never emails, names, free text or amounts. */
export type EventProps = Record<string, Scalar>;
/** Keys in snake_case, except `userId`. Small and non-personal: the route pattern, never the URL. */
export interface ErrorContext {
    userId?: string | null;
    method?: string;
    route?: string;
    status?: number;
    request_id?: string;
    [key: string]: Scalar | undefined;
}
export interface ReporterOptions {
    /** The app's registry key. The ingest knows the app by its token; this only names the sender. */
    app: string;
    /** Defaults to the ingest on the same host. */
    ingestUrl?: string;
    /** Without one the reporter is a no-op (dev, tests, CI). */
    token?: string;
    /** The git SHA, when the process knows it; sent in each error's context. */
    release?: string;
    /** `worker` for processes that serve no requests. */
    source?: 'server' | 'worker';
}
export interface Reporter {
    /** Fills `request_id`, `method`, `route`, `status` and `userId` from the wide event when the context leaves them out. */
    reportServerError(err: unknown, context?: ErrorContext): void;
    trackServerEvent(name: string, userId: string | null, props?: EventProps): void;
    /** Waits for the POST in flight and sends what is queued. Never rejects; at most ~1.5 s. */
    flush(): Promise<void>;
}
export declare function createReporter(options: ReporterOptions): Reporter;
/**
 * On SIGINT or SIGTERM, flush, then exit with the code the signal would have
 * given (130, 143); a second signal exits at once. When the app listens to the
 * signal too, it only flushes: exiting would cut the app's own shutdown short.
 * Without a token there is nothing to flush, so nothing is installed.
 */
export declare function installShutdownFlush(reporter: Pick<Reporter, 'flush'>): void;
