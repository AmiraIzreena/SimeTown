import { friendlyFields } from '@/shared/validation';
import { reloadTo } from './navigate';

/** The browser's one way to talk to the server. Every screen goes through here. */

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: { fields?: Record<string, string>; [key: string]: unknown },
  ) {
    super(message);
  }
  /** Field messages to show next to each field. Anything that reads like a validator's wording becomes "Please check this field." */
  get fields(): Record<string, string> {
    return friendlyFields(this.details?.fields);
  }
}

const BASE = '/api/v1';

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const isForm = typeof FormData !== 'undefined' && body instanceof FormData;
  let response: Response;
  try {
    response = await fetch(BASE + path, {
      method,
      credentials: 'same-origin',
      headers: body !== undefined && !isForm ? { 'Content-Type': 'application/json' } : undefined,
      body: body === undefined ? undefined : isForm ? (body as FormData) : JSON.stringify(body),
    });
  } catch {
    throw new ApiError(0, 'NETWORK', 'You seem to be offline. Check your connection and try again.');
  }
  const payload = (await response.json().catch(() => null)) as { data?: T; error?: { code: string; message: string; details?: ApiError['details'] } } | null;
  if (!response.ok) {
    // A session that ended elsewhere: send the person back to sign in, once.
    if (response.status === 401 && !path.startsWith('/auth/') && typeof window !== 'undefined' && !window.location.pathname.startsWith('/login')) {
      reloadTo(`/login?next=${encodeURIComponent(window.location.pathname)}`);
    }
    throw new ApiError(response.status, payload?.error?.code ?? 'UNKNOWN', payload?.error?.message ?? 'Something went wrong. Please try again.', payload?.error?.details);
  }
  return payload?.data as T;
}

export const api = {
  get: <T>(path: string) => request<T>('GET', path),
  post: <T>(path: string, body: unknown = {}) => request<T>('POST', path, body),
  patch: <T>(path: string, body: unknown) => request<T>('PATCH', path, body),
  del: <T>(path: string) => request<T>('DELETE', path),
};
