// Basecamp — confirm a JWT (ANON_KEY/SERVICE_ROLE_KEY) actually verifies
// against a given secret, before trusting it in .env.
// Usage: node scripts/verify-jwt.cjs "$JWT_SECRET" "$ANON_KEY"
//
// Worth running any time ANON_KEY/SERVICE_ROLE_KEY changed by hand — a
// mismatched secret produces a token that looks fine (decodes, has the
// right claims) but fails PostgREST/GoTrue with a signature error that
// gives no hint the secret is the problem.
const crypto = require('crypto');

const secret = process.argv[2];
const token = process.argv[3];
if (!secret || !token) {
  console.error('Usage: node scripts/verify-jwt.cjs "$JWT_SECRET" "$TOKEN"');
  process.exit(1);
}

const [h, p, s] = token.split('.');
const expected = crypto
  .createHmac('sha256', secret)
  .update(`${h}.${p}`)
  .digest('base64')
  .replace(/\+/g, '-')
  .replace(/\//g, '_')
  .replace(/=+$/, '');

if (s === expected) {
  console.log('OK — signature matches.');
} else {
  console.error('MISMATCH — this token was not signed with the given secret.');
  process.exit(1);
}
