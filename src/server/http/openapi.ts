import { z } from 'zod';
import type { RouteDef } from './router';

/** Builds an OpenAPI 3.1 document from the route table, so the docs cannot drift from the code. */
export function buildOpenApi(routes: RouteDef[], prefix: string): Record<string, unknown> {
  const toSchema = (schema: z.ZodType) => z.toJSONSchema(schema, { io: 'input', unrepresentable: 'any', target: 'draft-2020-12' });
  const paths: Record<string, Record<string, unknown>> = {};

  for (const r of routes) {
    const path = prefix + r.path.replace(/:([A-Za-z]+)/g, '{$1}');
    const parameters: unknown[] = [...r.path.matchAll(/:([A-Za-z]+)/g)].map(([, name]) => ({
      name,
      in: 'path',
      required: true,
      schema: /id$/i.test(name!) ? { type: 'string', format: 'uuid' } : { type: 'string' },
    }));
    if (r.query) {
      const q = toSchema(r.query) as { properties?: Record<string, unknown>; required?: string[] };
      for (const [name, schema] of Object.entries(q.properties ?? {})) {
        parameters.push({ name, in: 'query', required: q.required?.includes(name) ?? false, schema });
      }
    }
    const who =
      r.auth === 'public' ? 'Anyone.' : r.auth === 'session' ? `Signed-in ${r.roles ? r.roles.join(', ') : 'user (any role)'}.` : r.auth === 'machine' ? 'A device (a kiosk bin or a flood sensor); every record carries an HMAC-SHA256 signature made with that device’s own key.' : 'Machine caller with a bearer token.';
    (paths[path] ??= {})[r.method.toLowerCase()] = {
      tags: [r.tag],
      summary: r.summary,
      description: who,
      operationId: `${r.method.toLowerCase()}${r.path.replace(/[^A-Za-z0-9]+(.)?/g, (_, c: string | undefined) => (c ? c.toUpperCase() : ''))}`,
      parameters,
      ...(r.body ? { requestBody: { required: true, content: { 'application/json': { schema: toSchema(r.body) } } } } : {}),
      security: r.auth === 'public' || r.auth === 'machine' ? [] : r.auth === 'session' ? [{ session: [] }] : [{ token: [] }],
      responses: {
        200: { description: 'Success. The result is in `data`.', content: { 'application/json': { schema: { type: 'object', properties: { data: {} } } } } },
        ...(r.body || r.query ? { 400: { $ref: '#/components/responses/Error' } } : {}),
        ...(r.auth !== 'public' ? { 401: { $ref: '#/components/responses/Error' }, 403: { $ref: '#/components/responses/Error' } } : {}),
        ...(r.method !== 'GET' ? { 422: { $ref: '#/components/responses/Error' }, 429: { $ref: '#/components/responses/Error' } } : {}),
      },
    };
  }

  return {
    openapi: '3.1.0',
    info: {
      title: 'SimeTown API',
      version: '1.0.0',
      description:
        'One API for the resident, shop, sponsor and SDP views. Amounts of money are whole sen; 1 SimeTown Point = 1 sen. ' +
        'State-changing requests must carry an Origin header equal to the app origin. Lists use `cursor` and `limit`. ' +
        'Photos are sent as multipart field `photo`: JPEG or PNG only (the type is read from the file itself), at most 10 MB; a form is read up to 10.25 MB. Anything else gets 400, a larger photo 413 `PHOTO_TOO_LARGE`.',
    },
    paths,
    components: {
      securitySchemes: {
        session: { type: 'apiKey', in: 'cookie', name: 'kita_session', description: 'HttpOnly session cookie set by sign-in (named __Host-kita_session over HTTPS).' },
        token: { type: 'http', scheme: 'bearer', description: 'CRON_SECRET or SENSOR_INGEST_TOKEN from the environment.' },
      },
      responses: {
        Error: {
          description: 'The request was refused. `error.code` is stable; `error.message` is safe to show to a person.',
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  error: {
                    type: 'object',
                    required: ['code', 'message'],
                    properties: { code: { type: 'string' }, message: { type: 'string' }, details: {}, requestId: { type: 'string' } },
                  },
                },
              },
            },
          },
        },
      },
    },
  };
}
