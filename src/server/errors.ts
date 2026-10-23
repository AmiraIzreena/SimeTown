/**
 * Errors the API is allowed to show to a caller. Anything else becomes a
 * generic 500 so internal details never leak.
 */
export class AppError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export const badRequest = (message: string, details?: unknown) => new AppError(400, 'BAD_REQUEST', message, details);
export const unauthorized = (message = 'Please sign in.') => new AppError(401, 'UNAUTHORIZED', message);
export const forbidden = (message = 'You do not have permission to do this.') => new AppError(403, 'FORBIDDEN', message);
export const notFound = (what = 'Resource') => new AppError(404, 'NOT_FOUND', `${what} not found.`);
export const conflict = (code: string, message: string, details?: unknown) => new AppError(409, code, message, details);
/** A bank reference that was used before: shown on the form's `bankRef` field, inside any open dialog. */
export const duplicateBankRef = (message = 'A deposit with this bank reference is already recorded.') => conflict('DUPLICATE_BANK_REF', message, { fields: { bankRef: message } });
/** A request that is well-formed but breaks a business rule. */
export const ruleViolation = (code: string, message: string, details?: unknown) => new AppError(422, code, message, details);
/** Field errors found by a service, in the same shape the request checks use, so forms highlight the fields. */
export const fieldErrors = (fields: Record<string, string>) => new AppError(400, 'VALIDATION_FAILED', 'Please check the highlighted fields.', { fields });
export const tooManyRequests = (retryAfterSec: number) =>
  new AppError(429, 'RATE_LIMITED', 'Too many requests. Please wait a moment and try again.', { retryAfterSec });
