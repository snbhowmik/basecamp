import { reactive } from 'vue';
import { sessionMfa } from './auth';
import { loadUserContext, type UserContext } from './context';

// Where the app is in the sign-in gate. Mirrors the React App.tsx order:
// the MFA check runs FIRST, before any PostgREST call, because aal1 requests
// are refused by require_mfa() and a failure there would loop to login.
export type Gate = 'loading' | 'login' | 'verify' | 'app';

export const session = reactive<{ gate: Gate; ctx: UserContext | null; factorId: string | null }>({
  gate: 'loading',
  ctx: null,
  factorId: null,
});

export async function bootstrap() {
  try {
    const mfa = await sessionMfa();
    session.factorId = mfa.factorId;
    if (mfa.signedIn && !mfa.aal2) { session.gate = 'verify'; return; }
    const ctx = await loadUserContext();
    if (!ctx) { session.gate = 'login'; return; }
    session.ctx = ctx;
    session.gate = 'app';
  } catch {
    session.gate = 'login';
  }
}
