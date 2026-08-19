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
