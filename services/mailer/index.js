// Basecamp — invite email worker
// ============================================================
// Polls claim_invite_emails() and sends each pending invite its
// /invite/<token> link over the same SMTP relay GoTrue uses.
//
// Deliberately minimal in what it can do:
//   - connects as basecamp_mailer, which owns no tables and holds three
//     function grants (0008_invite_email.sql)
//   - has no service_role key and never calls the GoTrue admin API
//   - listens on no port; Kong has no route to it
//
// So the worst case if this container is compromised is disclosure of
// pending invite tokens — bad, but bounded, and not account creation.
// See 0008's header for why this isn't the BFF that ARCH.md §2 rules out.

import { Pool } from 'pg';
import nodemailer from 'nodemailer';

const {
  MAILER_DB_HOST = 'db',
  MAILER_DB_PORT = '5432',
  MAILER_DB_NAME = 'postgres',
  MAILER_DB_USER = 'basecamp_mailer',
  MAILER_DB_PASSWORD,
  SMTP_HOST,
  SMTP_PORT = '587',
  SMTP_USER,
  SMTP_PASS,
  SMTP_ADMIN_EMAIL,
  SMTP_SENDER_NAME = 'Basecamp',
  SITE_URL,
  MAILER_POLL_SECONDS = '20',
  MAILER_BATCH_SIZE = '20',
} = process.env;

for (const [name, value] of Object.entries({
  MAILER_DB_PASSWORD, SMTP_HOST, SMTP_USER, SMTP_PASS, SMTP_ADMIN_EMAIL, SITE_URL,
})) {
  if (!value) {
    console.error(`[mailer] missing required env var: ${name}`);
    process.exit(1);
  }
}

const pool = new Pool({
  host: MAILER_DB_HOST,
  port: Number(MAILER_DB_PORT),
  database: MAILER_DB_NAME,
  user: MAILER_DB_USER,
  password: MAILER_DB_PASSWORD,
  max: 2,
});

// secure:false + port 587 means STARTTLS upgrade, not plaintext — the same
// thing GoTrue does. requireTLS makes the upgrade mandatory rather than
// best-effort, so a relay that silently stops offering STARTTLS fails loudly
// instead of sending invite tokens in the clear.
const transport = nodemailer.createTransport({
  host: SMTP_HOST,
  port: Number(SMTP_PORT),
  secure: Number(SMTP_PORT) === 465,
  requireTLS: Number(SMTP_PORT) !== 465,
  auth: { user: SMTP_USER, pass: SMTP_PASS },
});

const siteUrl = SITE_URL.replace(/\/+$/, '');

function renderInvite({ invite_token, level_name, department_name, invited_by_name }) {
  const link = `${siteUrl}/invite/${invite_token}`;
  const role = department_name ? `${level_name} — ${department_name}` : level_name;
  const from = invited_by_name ? `${invited_by_name} has` : 'You have been';

  const text = [
    `${from} invited you to Basecamp as ${role}.`,
    '',
    'Set up your account here:',
    link,
    '',
    "You'll create your own password and set up two-factor authentication.",
    'This link is specific to your email address — do not forward it.',
  ].join('\n');

  // Inline styles only, and the URL repeated as visible text: several
  // institutional mail clients strip <style> blocks and rewrite anchors, so
  // the link has to survive as copyable plain text too.
  const html = `
    <div style="font-family:system-ui,-apple-system,Segoe UI,sans-serif;font-size:15px;line-height:1.6;color:#111">
      <p>${escapeHtml(from)} invited you to <strong>Basecamp</strong> as ${escapeHtml(role)}.</p>
      <p>
        <a href="${link}" style="display:inline-block;padding:10px 18px;background:#1f6feb;color:#fff;border-radius:6px;text-decoration:none">
          Set up your account
        </a>
      </p>
      <p style="color:#555;font-size:13px">Or paste this into your browser:<br><span style="word-break:break-all">${link}</span></p>
      <p style="color:#555;font-size:13px">
        You'll create your own password and set up two-factor authentication.<br>
        This link is specific to your email address — please don't forward it.
      </p>
    </div>`.trim();

  return { subject: `You've been invited to Basecamp (${role})`, text, html };
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

async function drainOnce() {
  const { rows } = await pool.query('select * from claim_invite_emails($1)', [Number(MAILER_BATCH_SIZE)]);
  if (rows.length === 0) return 0;

  let sent = 0;
  for (const row of rows) {
    const { subject, text, html } = renderInvite(row);
    try {
      await transport.sendMail({
        from: `"${SMTP_SENDER_NAME}" <${SMTP_ADMIN_EMAIL}>`,
        to: row.email,
        subject, text, html,
      });
      await pool.query('select mark_invite_email_sent($1)', [row.id]);
      sent += 1;
      console.log(`[mailer] sent invite to ${row.email}`);
    } catch (err) {
      // Left unsent: claim_invite_emails() already incremented attempts, so
      // this retries on the next poll and stops after 5 tries rather than
      // hammering a broken relay forever.
      const message = err?.message ?? String(err);
      await pool.query('select mark_invite_email_failed($1, $2)', [row.id, message]);
      console.error(`[mailer] FAILED invite to ${row.email}: ${message}`);
    }
  }
  return sent;
}

let stopping = false;
for (const sig of ['SIGTERM', 'SIGINT']) {
  process.on(sig, () => { stopping = true; });
}

async function main() {
  await transport.verify();
  console.log(`[mailer] SMTP ${SMTP_HOST}:${SMTP_PORT} ok — polling every ${MAILER_POLL_SECONDS}s`);

  const intervalMs = Number(MAILER_POLL_SECONDS) * 1000;
  while (!stopping) {
    try {
      await drainOnce();
    } catch (err) {
      // Never let a transient DB error kill the loop — restart:unless-stopped
      // would just respawn into the same failure a second later.
      console.error(`[mailer] poll error: ${err?.message ?? err}`);
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }

  await pool.end();
  console.log('[mailer] stopped');
}

main().catch((err) => {
  console.error(`[mailer] fatal: ${err?.message ?? err}`);
  process.exit(1);
});
