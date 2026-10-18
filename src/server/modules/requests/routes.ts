import { route } from '../../http/router';
import * as requests from './service';

export const requestRoutes = [
  route({
    method: 'GET', path: '/requests', tag: 'Requests', summary: 'Everything my household is waiting on: reports, parcels and collections, with the next step', auth: 'session', roles: ['RESIDENT'],
    handler: (c) => requests.myRequests(c.db, c.actor, c.now),
  }),
];
