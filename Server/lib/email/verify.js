/**
 * Pre-send email verification ("does this mailbox actually exist?").
 *
 * Uses the open-source check-if-email-exists backend (reacherhq) as a sidecar
 * service. It probes the recipient's MX/SMTP server WITHOUT sending any email.
 *
 * Config (all optional — feature is off unless EMAIL_VERIFIER_URL is set):
 *   EMAIL_VERIFIER_URL              e.g. http://email-verifier:8080
 *   EMAIL_VERIFICATION_TTL_DAYS     re-check addresses older than this (default 30)
 *
 * Decision policy (conservative on purpose):
 *   - suppressed ONLY when the mailbox is definitively invalid:
 *       is_reachable === 'invalid'  OR  smtp.is_deliverable === false
 *   - 'risky' / 'unknown' (catch-alls, gmail greylisting, probe failures) are
 *     NOT suppressed — they still get sent, so a flaky probe never blocks a
 *     real recipient. Postal catches true bounces reactively anyway.
 */

const db = require('../../db');

const VERIFIER_URL = process.env.EMAIL_VERIFIER_URL || '';
const TTL_DAYS = Number(process.env.EMAIL_VERIFICATION_TTL_DAYS || 30);
const TTL_MS = TTL_DAYS * 24 * 60 * 60 * 1000;

/** Ask the reacher backend whether this mailbox exists. */
async function probeMailbox(email, timeoutMs = 45000) {
  if (!VERIFIER_URL) throw new Error('EMAIL_VERIFIER_URL not configured');
  const res = await fetch(`${VERIFIER_URL.replace(/\/$/, '')}/v0/check_email`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ to_email: email.toLowerCase() }),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) throw new Error(`verifier failed: ${res.status} ${await res.text().catch(() => '')}`);
  return res.json();
}

/** Look up a recent verification result, if we have one inside the TTL. */
async function getRecentVerification(email) {
  const r = await db.query(
    `SELECT * FROM email_verifications
      WHERE email = $1 AND checked_at > NOW() - ($2 || ' milliseconds')::interval`,
    [email.toLowerCase(), String(TTL_MS)],
  );
  return r.rows[0] || null;
}

/** Store a verification result (and its suppression decision). */
async function saveVerification(email, result, { suppressed, reason }) {
  await db.query(
    `INSERT INTO email_verifications
        (email, is_reachable, is_deliverable, is_catch_all, is_disposable, suppressed, suppress_reason, checked_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
      ON CONFLICT (email) DO UPDATE SET
        is_reachable = EXCLUDED.is_reachable,
        is_deliverable = EXCLUDED.is_deliverable,
        is_catch_all = EXCLUDED.is_catch_all,
        is_disposable = EXCLUDED.is_disposable,
        suppressed = EXCLUDED.suppressed,
        suppress_reason = EXCLUDED.suppress_reason,
        checked_at = NOW()`,
    [
      email.toLowerCase(),
      result?.is_reachable || null,
      result?.smtp?.is_deliverable ?? null,
      result?.smtp?.is_catch_all ?? null,
      result?.misc?.is_disposable ?? null,
      suppressed,
      reason || null,
    ],
  );
}

/** Is this address currently on the suppression list? */
async function isSuppressed(email) {
  const r = await db.query(
    `SELECT suppress_reason FROM email_verifications
      WHERE email = $1 AND suppressed = TRUE`,
    [email.toLowerCase()],
  );
  return r.rows[0]?.suppress_reason || null;
}

/**
 * THE one call to make before sending to any address.
 * Returns { send, reason, result } — when send is false, skip the send.
 * If no verifier is configured, always returns { send: true }.
 */
async function verifyOrSuppress(email) {
  const addr = email.toLowerCase();

  const prior = await getRecentVerification(addr);
  if (prior) {
    return { send: !prior.suppressed, reason: prior.suppress_reason, result: prior, cached: true };
  }

  const already = await isSuppressed(addr);
  if (already) return { send: false, reason: already, result: null, cached: true };

  let result;
  try {
    result = await probeMailbox(addr);
  } catch (err) {
    // Probe infrastructure failed — never let that block a send.
    console.warn(`[verify] probe failed for ${addr}:`, err?.message || err);
    return { send: true, reason: 'probe-failed', result: null };
  }

  const deliverable = result?.smtp?.is_deliverable;
  const invalid = result?.is_reachable === 'invalid' || deliverable === false;

  if (invalid) {
    const reason = `mailbox does not exist (is_reachable=${result?.is_reachable}, deliverable=${deliverable})`;
    await saveVerification(addr, result, { suppressed: true, reason });
    return { send: false, reason, result };
  }

  await saveVerification(addr, result, { suppressed: false, reason: null });
  return { send: true, reason: result?.is_reachable || 'ok', result };
}

/** Manually suppress an address (bounce-driven or hand-added). */
async function suppressEmail(email, reason = 'manual') {
  await saveVerification(email, null, { suppressed: true, reason });
}

module.exports = { verifyOrSuppress, verifyEmail: probeMailbox, isSuppressed, suppressEmail };
