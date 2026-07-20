const db = require('../../db');
const { encrypt, decrypt, maskUsername } = require('./secrets');
const { PLATFORM } = require('./settings');

async function getAccount() {
  const r = await db.query(
    `SELECT id, platform, username, password_enc, email_enc, session_cookie_enc,
            session_expires_at, status, last_login_at, last_error, updated_at
       FROM social_accounts WHERE platform = $1`,
    [PLATFORM],
  );
  return r.rows[0] || null;
}

function publicAccount(row) {
  if (!row) {
    return {
      configured: false,
      usernameMasked: '',
      passwordSet: false,
      emailSet: false,
      sessionSet: false,
      status: 'needs_login',
      lastLoginAt: null,
      lastError: null,
      sessionExpiresAt: null,
    };
  }
  return {
    configured: true,
    usernameMasked: maskUsername(row.username),
    usernameHint: row.username ? `@${String(row.username).replace(/^@/, '')}` : '',
    passwordSet: !!row.password_enc,
    emailSet: !!row.email_enc,
    sessionSet: !!row.session_cookie_enc,
    status: row.status || 'needs_login',
    lastLoginAt: row.last_login_at,
    lastError: row.last_error,
    sessionExpiresAt: row.session_expires_at,
  };
}

async function saveCredentials({ username, password, email } = {}) {
  const user = String(username || '').trim().replace(/^@/, '');
  if (!user) throw new Error('Username is required');
  if (!password || !String(password).trim()) throw new Error('Password is required');

  const passwordEnc = encrypt(String(password));
  const emailEnc = email != null && String(email).trim() ? encrypt(String(email).trim()) : null;

  await db.query(
    `INSERT INTO social_accounts
       (platform, username, password_enc, email_enc, status, last_error, updated_at)
     VALUES ($1, $2, $3, $4, 'needs_login', NULL, NOW())
     ON CONFLICT (platform) DO UPDATE SET
       username = EXCLUDED.username,
       password_enc = EXCLUDED.password_enc,
       email_enc = COALESCE(EXCLUDED.email_enc, social_accounts.email_enc),
       status = 'needs_login',
       session_cookie_enc = NULL,
       session_expires_at = NULL,
       last_error = NULL,
       updated_at = NOW()`,
    [PLATFORM, user, passwordEnc, emailEnc],
  );
  return getAccount();
}

async function getDecryptedCredentials() {
  const row = await getAccount();
  if (!row) return null;
  return {
    username: row.username,
    password: decrypt(row.password_enc),
    email: decrypt(row.email_enc) || '',
    sessionCookie: decrypt(row.session_cookie_enc),
    status: row.status,
  };
}

async function saveSession({ cookieString, expiresAt = null } = {}) {
  if (!cookieString) throw new Error('cookieString required');
  await db.query(
    `UPDATE social_accounts
        SET session_cookie_enc = $2,
            session_expires_at = $3,
            status = 'ok',
            last_login_at = NOW(),
            last_error = NULL,
            updated_at = NOW()
      WHERE platform = $1`,
    [PLATFORM, encrypt(cookieString), expiresAt],
  );
}

async function markAccountStatus(status, errorMessage = null) {
  await db.query(
    `UPDATE social_accounts
        SET status = $2,
            last_error = $3,
            updated_at = NOW()
      WHERE platform = $1`,
    [PLATFORM, status, errorMessage],
  );
}

module.exports = {
  getAccount,
  publicAccount,
  saveCredentials,
  getDecryptedCredentials,
  saveSession,
  markAccountStatus,
};
