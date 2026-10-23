/**
 * The Terms of Use and Privacy Notice in force (src/app/terms, src/app/privacy).
 * Change `version` whenever either text changes in substance: everyone is then
 * asked to read and accept them again the next time they sign in.
 */
export const LEGAL = {
  version: '2026-10-23',
  effectiveDate: '23 October 2026',
  /** Who runs the service and answers for the personal data in it. */
  operator: 'the SimeTown project team',
  /** Where people send privacy requests and questions: the team's monitored address. */
  contactEmail: '6bytestech@gmail.com',
} as const;
