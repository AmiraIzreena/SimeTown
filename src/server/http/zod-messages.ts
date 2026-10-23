import { z } from 'zod';
import { friendlyIssue, type Issue } from '@/shared/validation';

/**
 * Gives every schema friendly default messages ("Please fill in this field.") instead of Zod's own
 * ("Invalid input: expected string, received undefined"). A message a schema sets itself still wins.
 * Imported once by the router, so it is in place before any request is checked.
 */
z.config({ customError: (issue) => friendlyIssue(issue as Issue) });
