import { api } from '@/server/http/api';

/**
 * The whole API is served by one router (src/server/http). Next.js only hands
 * requests over, which keeps the backend independent of the web framework.
 */
export const dynamic = 'force-dynamic';

const handler = (request: Request) => api.handle(request);

export { handler as GET, handler as POST, handler as PATCH, handler as DELETE };
