import { writeFileSync } from 'node:fs';
import { API_PREFIX, routes } from '../src/server/http/api';
import { buildOpenApi } from '../src/server/http/openapi';

/** Writes docs/openapi.json and docs/API.md from the route table. Run after changing any route. */
writeFileSync('docs/openapi.json', `${JSON.stringify(buildOpenApi(routes, API_PREFIX), null, 2)}\n`);

const lines = [
  '# KITA+ API reference',
  '',
  'Generated from the route table by `npm run docs:api`. Do not edit by hand.',
  `The machine-readable version is [openapi.json](openapi.json), also served at \`${API_PREFIX}/openapi.json\`.`,
  '',
  '- Base path: `' + API_PREFIX + '`',
  '- Success: `{ "data": … }`. Failure: `{ "error": { "code", "message", "details?", "requestId" } }`.',
  '- Money is in whole sen. 1 KITA Point = 1 sen.',
  '- Sign-in sets an HttpOnly session cookie. Every POST, PATCH and DELETE must send an `Origin` header equal to the app origin.',
  '- Lists that can grow take `?cursor=&limit=` and return `{ items, nextCursor }`.',
  '',
];
for (const tag of [...new Set(routes.map((r) => r.tag))]) {
  lines.push(`## ${tag}`, '', '| Method | Path | Who | What it does |', '| --- | --- | --- | --- |');
  for (const r of routes.filter((x) => x.tag === tag)) {
    const who = r.auth === 'public' ? 'Public' : r.auth === 'session' ? (r.roles?.join(', ') ?? 'Any signed-in user') : `Bearer token (${r.auth})`;
    lines.push(`| ${r.method} | \`${r.path}\` | ${who} | ${r.summary} |`);
  }
  lines.push('');
}
writeFileSync('docs/API.md', lines.join('\n'));
console.log(`Documented ${routes.length} endpoints.`);
