import { adminRoutes } from '../modules/admin/routes';
import { banjirRoutes } from '../modules/banjir/routes';
import { campaignRoutes } from '../modules/campaigns/routes';
import { communityRoutes } from '../modules/community/routes';
import { gerakRoutes } from '../modules/gerak/routes';
import { identityRoutes } from '../modules/identity/routes';
import { jimatRoutes } from '../modules/jimat/routes';
import { kitarRoutes } from '../modules/kitar/routes';
import { merchantRoutes } from '../modules/merchant/routes';
import { reportRoutes } from '../modules/reports/routes';
import { walletRoutes } from '../modules/wallet/routes';
import { buildOpenApi } from './openapi';
import { createRouter, json, route, type RouteDef } from './router';

export const API_PREFIX = '/api/v1';

/** Every endpoint in KITA+, one feature after another. */
export const routes: RouteDef[] = [
  ...identityRoutes,
  ...walletRoutes,
  ...merchantRoutes,
  ...campaignRoutes,
  ...communityRoutes,
  ...reportRoutes,
  ...gerakRoutes,
  ...kitarRoutes,
  ...jimatRoutes,
  ...banjirRoutes,
  ...adminRoutes,
];

// The API describes itself, generated from the table above.
routes.push(
  route({
    method: 'GET', path: '/openapi.json', tag: 'System', summary: 'This API as an OpenAPI 3.1 document', auth: 'public',
    handler: async () => json(buildOpenApi(routes, API_PREFIX), { headers: { 'Cache-Control': 'public, max-age=300' } }),
  }),
);

export const api = createRouter(routes, { prefix: API_PREFIX });
