/** `export const POST = withRequestLog('/api/envios/[id]', async (req, { params }) => …)` */
export declare function withRequestLog<R extends Request, C = {
    params: Promise<Record<string, string>>;
}>(route: string, handler: (req: R, ctx: C) => Response | Promise<Response>): (req: R, ctx: C) => Promise<Response>;
/**
 * `export const createEnvio = withActionLog('createEnvio', async (input: Input) => …)` in a 'use server' file.
 * A `{ ok: false }` result is logged as `rejected`.
 */
export declare function withActionLog<A extends unknown[], T>(name: string, action: (...args: A) => Promise<T>): (...args: A) => Promise<T>;
