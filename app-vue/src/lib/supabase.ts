import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!url || !anonKey) {
  throw new Error('Missing VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY. Check .env.local.');
}

// Same client config as the React app, so both read the same persisted
// session (localStorage key sb-<host>-auth-token) while they coexist.
export const supabase = createClient(url, anonKey);
