# basket-tv-telemetry

Shared server telemetry for the Basket.tv apps: the error and event reporter for basket-telemetry's ingest, message scrubbing, and one JSON wide event per request for Hono and Next. TypeScript, ESM, Node runtime only (not Edge), no runtime dependencies.

```json
"basket-tv-telemetry": "git+https://github.com/WencesCapolo/basket-tv-telemetry#v0.1.0"
```

`dist/` is committed: installing from git builds nothing. `hono` (≥ 4.8) and `next` (≥ 15) are optional peers; install only the one your app uses.

## `basket-tv-telemetry`: the reporter

```ts
// src/lib/telemetry.ts (or the app's infrastructure adapter)
import { createReporter, installShutdownFlush } from 'basket-tv-telemetry';

export const telemetry = createReporter({
  app: 'my-app',
  ingestUrl: process.env.TELEMETRY_INGEST_URL, // defaults to http://127.0.0.1:3011/ingest/server
  token: process.env.TELEMETRY_TOKEN, // without it, everything is a no-op
});
installShutdownFlush(telemetry);

telemetry.reportServerError(err, { route: '/api/orders/:id', status: 500, userId });
telemetry.trackServerEvent('order_submitted', userId, { order_id: 42 });
```

- `reportServerError(err, context)`: context keys are snake_case except `userId`. Inside a wide event, `request_id`, `method`, `route`, `status` and `userId` are filled from it when the context leaves them out. A thrown non-Error is sent as `type: "NonError"` with its string form as the message and no stack.
- Batches for 1 s; keeps at most 200 items and drops the rest while the ingest is down; each POST gives up after 1.5 s; never throws into the caller.
- `flush()` waits for the POST in flight and sends what is queued.
- `scrubMessage` / `scrubStack`: the message without data (cut at `params:`; emails, quoted text, `{…}` objects, numbers, long digit runs and amounts masked; SQL placeholders `$1`…`$99` kept).

## `basket-tv-telemetry/log`: wide events

One JSON line per unit of work on stdout, in the format the logs collector parses. `startEvent`, `withEvent`, `addFields`, `markError`, `finish`, `emit`, `emitThrottled`, `requestId`, `currentRequestId`, `requestIdOf`, `runLogged`.

```ts
import { addFields, emit, runLogged, startEvent } from 'basket-tv-telemetry/log';

emit({ ts: new Date().toISOString(), level: 'info', kind: 'start', port: 3000 });
addFields({ order: { id: 42, has_file: true } }); // anywhere below a request: ids, counts, enums, booleans
await runLogged(startEvent('job', { route: 'sync_contacts' }), () => syncContacts());
```

## `basket-tv-telemetry/hono`

```ts
import { Hono } from 'hono';
import { routePath } from 'hono/route';
import { wideEvent } from 'basket-tv-telemetry/hono';
import { telemetry } from './lib/telemetry';

const app = new Hono();
app.use('*', wideEvent()); // first; logs /api/* except /api/health. wideEvent((path) => …) to choose.
app.onError((err, c) => {
  telemetry.reportServerError(err, { route: routePath(c), status: 500 });
  return c.json({ error: 'internal' }, 500);
});
app.get('/api/orders/:id', (c) => {
  c.get('wide').user_id = session.user.id;
  return c.json(order);
});
```

## `basket-tv-telemetry/next`

```ts
// src/app/api/orders/[id]/route.ts
import { withRequestLog } from 'basket-tv-telemetry/next';
import { addFields } from 'basket-tv-telemetry/log';

export const POST = withRequestLog('/api/orders/[id]', async (req: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
  addFields({ order: { id: Number((await params).id) } });
  return Response.json({ ok: true });
});
```

```ts
// src/app/orders/actions.ts
'use server';
import { withActionLog } from 'basket-tv-telemetry/next';

export const createOrder = withActionLog('createOrder', async (input: CreateOrderInput) => {
  // a { ok: false } result is logged as rejected; addFields({ reason }) says why
});
```

```ts
// src/instrumentation.ts
import { requestIdOf } from 'basket-tv-telemetry/log';
import { telemetry } from './lib/telemetry';

export function onRequestError(err: unknown, request: { method: string }, context: { routePath: string; routeType: string }) {
  telemetry.reportServerError(err, { method: request.method, route: context.routePath, route_type: context.routeType, request_id: requestIdOf(err) });
}
```

`redirect()`, `notFound()` and Next's other control-flow throws pass through the wrappers as `outcome: "ok"` without a status. Page renders get no line.

## Shutdown

`installShutdownFlush(reporter)` flushes on SIGINT / SIGTERM, then exits with the signal's code (130 / 143). If the app already handles those signals, call `await telemetry.flush()` in its handler instead.

- **pm2**: set `kill_timeout` to at least `3000` so pm2 does not SIGKILL the process mid-flush.
- **`next start`**: Next installs its own signal handler, so the flush is best effort unless the process runs with `NEXT_MANUAL_SIG_HANDLE=true`.

## Rules

- **`src/core/**` never imports this package.** The domain core returns outcomes and error codes; the adapters and handlers report errors and add fields.
- Fields and event props: ids, counts, enums and booleans. Never emails, names, free text or amounts.

## Other languages

A port (the Python reporter) must pass `fixtures/scrub-cases.json` (input → expected message) and `fixtures/line-cases.json` (event → expected line). The scrub rules use ASCII `\w` and `\d` and Unicode `\s`; in Python, spell `\w` and `\d` as `[A-Za-z0-9_]` and `[0-9]`. Lines are compact JSON with non-ASCII characters as they are (`ensure_ascii=False`).

## Upgrading

Bump the tag in each app's `package.json` and reinstall. Changes land here with `pnpm build` and the rebuilt `dist/` in the same commit; CI fails if they differ.
