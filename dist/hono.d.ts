import type { MiddlewareHandler } from 'hono';
import { type WideEvent } from './log.js';
declare module 'hono' {
    interface ContextVariableMap {
        wide: WideEvent;
    }
}
/** Only the API is logged: not the health check, static assets or the SPA fallback. */
export declare const defaultSkip: (path: string) => boolean;
/**
 * One wide event per request. Register it before every other middleware and
 * route: `app.use('*', wideEvent())`. Handlers add fields through `c.get('wide')`
 * or `addFields`.
 */
export declare function wideEvent(skip?: (path: string) => boolean): MiddlewareHandler;
