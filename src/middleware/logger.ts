/**
 * Request/response logging middleware.
 */

import type { Context, Next } from 'hono';

export async function logger(c: Context, next: Next) {
  const start = performance.now();
  const method = c.req.method;
  const path = c.req.path;

  console.log(`→ ${method} ${path}`);

  await next();

  const duration = (performance.now() - start).toFixed(1);
  const status = c.res.status;
  console.log(`← ${method} ${path} ${status} (${duration}ms)`);
}
