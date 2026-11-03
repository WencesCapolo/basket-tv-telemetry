import type { MiddlewareHandler } from 'hono';
import { routePath } from 'hono/route';
import { finish, markError, requestId, startEvent, withEvent, type WideEvent } from './log.js';

declare module 'hono' {
  interface ContextVariableMap {
    wide: WideEvent;
  }
}

/** Only the API is logged: not the health check, static assets or the SPA fallback. */
export const apiOnly = (path: string): boolean => path === '/api/health' || !path.startsWith('/api/');

/**
 * One wide event per request. Register it before every other middleware and
 * route: `app.use('*', wideEvent())`. Handlers add fields through `c.get('wide')`
 * or `addFields`.
 */
export function wideEvent(skip: (path: string) => boolean = apiOnly): MiddlewareHandler {
  return async (c, next) => {
    const t0 = performance.now();
    const id = requestId(c.req.header('x-request-id'));
    const event = startEvent('request', { request_id: id, method: c.req.method });
    c.set('wide', event);
    let status = 500;
    try {
      await withEvent(event, next);
      // A thrown Error never gets here: app.onError turned it into c.res and left it in c.error.
      status = c.res.status;
      if (c.error && status >= 500) markError(c.error, event);
      c.header('X-Request-Id', id);
    } catch (err) {
      markError(err, event);
      throw err;
    } finally {
      // After next(), the pattern of the route that answered.
      event.route = routePath(c);
      if (!skip(c.req.path)) finish(event, t0, status);
    }
  };
}
