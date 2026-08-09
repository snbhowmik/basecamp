// Basecamp — generate ANON_KEY / SERVICE_ROLE_KEY for .env.
// Usage: node scripts/gen-jwt.cjs "$JWT_SECRET"
//
// These are HS256 JWTs signed with JWT_SECRET, carrying {"role": "anon"}
// and {"role": "service_role"} respectively — PostgREST/GoTrue read the
// `role` claim to decide what the caller can do. If ANON_KEY/SERVICE_ROLE_KEY
// were signed with a different secret than what's actually configured as
// JWT_SECRET, every request fails with a signature error — see DEPLOY.md's
// troubleshooting table and verify with scripts/verify-jwt.cjs after
// generating.
const crypto = require('crypto');

function b64url(buf) {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function sign(payload, secret) {
  const header = { alg: 'HS256', typ: 'JWT' };
  const h = b64url(Buffer.from(JSON.stringify(header)));
  const p = b64url(Buffer.from(JSON.stringify(payload)));
  const data = `${h}.${p}`;
  const sig = crypto.createHmac('sha256', secret).update(data).digest();
  return `${data}.${b64url(sig)}`;
}

const secret = process.argv[2];
if (!secret) {
  console.error('Usage: node scripts/gen-jwt.cjs "$JWT_SECRET"');
  process.exit(1);
}

const now = Math.floor(Date.now() / 1000);
const tenYears = 10 * 365 * 24 * 3600;

const anon = sign({ role: 'anon', iss: 'basecamp', iat: now, exp: now + tenYears }, secret);
const service = sign({ role: 'service_role', iss: 'basecamp', iat: now, exp: now + tenYears }, secret);

console.log('ANON_KEY=' + anon);
console.log('SERVICE_ROLE_KEY=' + service);
