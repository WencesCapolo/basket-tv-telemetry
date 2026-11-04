// Next has no middleware that sees the final status, so the event is built in
// wrappers around route handlers and server actions. Page renders get no line;
// their errors still reach `onRequestError`. Node runtime only.
import { headers } from 'next/headers';
import { unstable_rethrow } from 'next/navigation';
import { finish, markError, requestId, startEvent, withEvent } from './log.js';
/** redirect(), notFound() and the like throw on purpose: they are not errors. */
function isNextControlFlow(err) {
    try {
        unstable_rethrow(err);
        return false;
    }
    catch {
        return true;
    }
}
/** `export const POST = withRequestLog('/api/envios/[id]', async (req, { params }) => …)` */
export function withRequestLog(route, handler) {
    return async (req, ctx) => {
        const t0 = performance.now();
        const id = requestId(req.headers.get('x-request-id'));
        const event = startEvent('request', { request_id: id, method: req.method, route });
        let status;
        try {
            const res = await withEvent(event, () => handler(req, ctx));
            status = res.status;
            try {
                res.headers.set('X-Request-Id', id);
            }
            catch {
                // immutable headers (Response.redirect, a proxied fetch)
            }
            return res;
        }
        catch (err) {
            if (!isNextControlFlow(err)) {
                status = 500;
                markError(err, event);
            }
            throw err;
        }
        finally {
            finish(event, t0, status);
        }
    };
}
async function incomingRequestId() {
    try {
        return (await headers()).get('x-request-id');
    }
    catch {
        return null; // called outside a request (a test, a script)
    }
}
/**
 * `export const createEnvio = withActionLog('createEnvio', async (input: Input) => …)` in a 'use server' file.
 * A `{ ok: false }` result is logged as `rejected`.
 */
export function withActionLog(name, action) {
    return async (...args) => {
        const t0 = performance.now();
        const event = startEvent('action', { request_id: requestId(await incomingRequestId()), route: name });
        try {
            const result = await withEvent(event, () => action(...args));
            const rejected = typeof result === 'object' && result !== null && result.ok === false;
            if (rejected)
                event.outcome ??= 'rejected';
            return result;
        }
        catch (err) {
            if (!isNextControlFlow(err))
                markError(err, event);
            throw err;
        }
        finally {
            finish(event, t0);
        }
    };
}
