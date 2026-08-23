// supabase-js returns PostgrestError as a plain object, not an Error instance.
// So the natural-looking `err instanceof Error ? err.message : 'Something went
// wrong'` silently discards every message the database sends back — including
// the ones written specifically to tell the user what to do, like "Still in use
// by: batches.org_unit_id (1)". Every catch block goes through this instead.
export function errorMessage(err: unknown, fallback: string): string {
  if (!err) return fallback;

  if (err instanceof Error && err.message.trim()) return err.message;
  if (typeof err === 'string' && err.trim()) return err;

  if (typeof err === 'object') {
    const e = err as { message?: unknown; hint?: unknown; details?: unknown };
    const message = typeof e.message === 'string' ? e.message.trim() : '';
    const hint = typeof e.hint === 'string' ? e.hint.trim() : '';
    // details is usually a Postgres internal ("Key (id)=(...) is not present"),
    // so it is only worth showing when there is nothing better.
    const details = typeof e.details === 'string' ? e.details.trim() : '';
    if (message) return hint ? `${message} ${hint}` : message;
    if (details) return details;
  }

  return fallback;
}

// ------------------------------------------------------------------
// What kind of failure was that?
// ------------------------------------------------------------------
// errorMessage() answers "what do I show the user". This answers "what should
// the app *do*", which is a different question and until now nothing asked it:
// every failure arrived as a string, so a session that needed re-verifying and
// a duplicate register number were handled identically — printed, and nothing
// else.
//
// Classification keys off SQLSTATE, which PostgREST passes through in `code`,
// because that is the part of the error the database guarantees. Message text
// is for people and can be reworded; the code cannot.
export type ErrorKind =
  /** MFA verified too long ago. Re-challenge for a code — do not sign out. */
  | 'mfa-stale'
  /** Signed in with a password only, no authenticator. Send them to enrol. */
  | 'mfa-absent'
  /** RLS or a grant said no. Not fixable by retrying, and not the user's fault. */
  | 'forbidden'
  /** A unique constraint. Something with this name/number already exists. */
  | 'duplicate'
  /** A foreign key still points at this row — the "Still in use by:" case. */
  | 'in-use'
  /** A check constraint or invalid input: the value itself is wrong. */
  | 'invalid'
  /** The row is not there, or RLS hid it so completely it reads as absent. */
  | 'not-found'
  /** The request never reached the server. Retrying is reasonable. */
  | 'offline'
  | 'unknown';

export interface ClassifiedError {
  kind: ErrorKind;
  message: string;
  /** SQLSTATE or PostgREST code, when there was one. Useful in a log line. */
  code: string | null;
  /** True when trying the same thing again could plausibly work. */
  retryable: boolean;
}

export function classifyError(err: unknown, fallback = 'Something went wrong.'): ClassifiedError {
  const message = errorMessage(err, fallback);
  const e = (typeof err === 'object' && err ? err : {}) as { code?: unknown; details?: unknown };
  const code = typeof e.code === 'string' ? e.code : null;
  const details = typeof e.details === 'string' ? e.details : '';

  // fetch() rejects with a TypeError when the request never left the machine.
  // There is no code on this one — the shape is all there is to go on.
  if (err instanceof TypeError && /fetch|network/i.test(err.message)) {
    return { kind: 'offline', message: 'Could not reach the server. Check your connection and try again.', code, retryable: true };
  }

  switch (code) {
    case '42501': {
      // require_mfa() (schema-v2/0024) tags its detail line so the two MFA
      // failures can be told apart. Everything else at 42501 is a real denial.
      if (details.startsWith('MFA_STALE')) return { kind: 'mfa-stale', message, code, retryable: false };
      if (details.startsWith('MFA_ABSENT')) return { kind: 'mfa-absent', message, code, retryable: false };
      return { kind: 'forbidden', message, code, retryable: false };
    }
    case '23505': return { kind: 'duplicate', message, code, retryable: false };
    case '23503': return { kind: 'in-use', message, code, retryable: false };
    case '23514':
    case '22P02':
    case '23502': return { kind: 'invalid', message, code, retryable: false };
    case 'PGRST116': return { kind: 'not-found', message, code, retryable: false };
    default: return { kind: 'unknown', message, code, retryable: false };
  }
}

/** True when this failure means the session must verify an authenticator again. */
export function isMfaError(err: unknown): boolean {
  const kind = classifyError(err).kind;
  return kind === 'mfa-stale' || kind === 'mfa-absent';
}
