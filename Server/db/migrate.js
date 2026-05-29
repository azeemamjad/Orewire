const db = require('./index');

async function safeQuery(sql) {
  try { await db.query(sql); } catch { /* ignore — column/index may already exist */ }
}

async function migrate() {
  // Users
  await db.query(`
    CREATE TABLE IF NOT EXISTS users (
      id          SERIAL PRIMARY KEY,
      email       TEXT UNIQUE NOT NULL,
      username    TEXT UNIQUE,
      password    TEXT NOT NULL,
      salt        TEXT NOT NULL,
      first_name  TEXT,
      last_name   TEXT,
      two_step_enabled BOOLEAN DEFAULT FALSE,
      email_verified BOOLEAN DEFAULT FALSE,
      created_at  TIMESTAMPTZ DEFAULT NOW()
    )
  `);
  await safeQuery(`ALTER TABLE users ADD COLUMN IF NOT EXISTS first_name TEXT`);
  await safeQuery(`ALTER TABLE users ADD COLUMN IF NOT EXISTS last_name TEXT`);
  await safeQuery(`ALTER TABLE users ADD COLUMN IF NOT EXISTS username TEXT`);
  await safeQuery(`CREATE UNIQUE INDEX IF NOT EXISTS idx_users_username_unique ON users(username) WHERE username IS NOT NULL`);
  await safeQuery(`ALTER TABLE users ADD COLUMN IF NOT EXISTS two_step_enabled BOOLEAN DEFAULT FALSE`);
  await safeQuery(`ALTER TABLE users ADD COLUMN IF NOT EXISTS email_verified BOOLEAN DEFAULT FALSE`);
  await safeQuery(`UPDATE users SET email_verified = TRUE WHERE email_verified IS NULL`);

  // Auth OTP / password reset
  await db.query(`
    CREATE TABLE IF NOT EXISTS auth_otps (
      id          SERIAL PRIMARY KEY,
      user_id     INTEGER REFERENCES users(id) ON DELETE CASCADE,
      email       TEXT NOT NULL,
      purpose     TEXT NOT NULL,
      code_hash   TEXT NOT NULL,
      expires_at  TIMESTAMPTZ NOT NULL,
      consumed_at TIMESTAMPTZ,
      created_at  TIMESTAMPTZ DEFAULT NOW()
    )
  `);
  await safeQuery(`CREATE INDEX IF NOT EXISTS idx_auth_otps_email_purpose ON auth_otps(email, purpose, created_at DESC)`);

  // Discussions
  await db.query(`
    CREATE TABLE IF NOT EXISTS discussions (
      id            SERIAL PRIMARY KEY,
      company_id    INTEGER REFERENCES companies(id) ON DELETE CASCADE,
      commodity_key TEXT,
      user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      body          TEXT NOT NULL,
      created_at    TIMESTAMPTZ DEFAULT NOW()
    )
  `);
  await safeQuery(`CREATE INDEX IF NOT EXISTS idx_discussions_company ON discussions(company_id)`);
  await safeQuery(`CREATE INDEX IF NOT EXISTS idx_discussions_commodity ON discussions(commodity_key)`);
  await safeQuery(`CREATE INDEX IF NOT EXISTS idx_discussions_currency ON discussions(currency_key)`);
  await safeQuery(`CREATE INDEX IF NOT EXISTS idx_discussions_index ON discussions(index_key)`);
  await safeQuery(`ALTER TABLE discussions ADD COLUMN IF NOT EXISTS commodity_key TEXT`);
  await safeQuery(`ALTER TABLE discussions ADD COLUMN IF NOT EXISTS currency_key TEXT`);
  await safeQuery(`ALTER TABLE discussions ADD COLUMN IF NOT EXISTS index_key TEXT`);
  await safeQuery(`ALTER TABLE discussions ALTER COLUMN company_id DROP NOT NULL`);

  await db.query(`
    CREATE TABLE IF NOT EXISTS discussion_votes (
      id             SERIAL PRIMARY KEY,
      discussion_id  INTEGER NOT NULL REFERENCES discussions(id) ON DELETE CASCADE,
      user_id        INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      vote           SMALLINT NOT NULL CHECK (vote IN (-1, 1)),
      created_at     TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE (discussion_id, user_id)
    )
  `);
  await safeQuery(`CREATE INDEX IF NOT EXISTS idx_discussion_votes_disc ON discussion_votes(discussion_id)`);

  // News — drop and recreate to fix schema mismatch
  await db.query(`DROP TABLE IF EXISTS news CASCADE`);
  await db.query(`
    CREATE TABLE news (
      id          SERIAL PRIMARY KEY,
      title       TEXT NOT NULL,
      link        TEXT UNIQUE NOT NULL,
      source      TEXT,
      pub_date    TIMESTAMPTZ,
      description TEXT,
      summary     TEXT,
      commodity   TEXT,
      sentiment   TEXT DEFAULT 'neutral',
      relevant    BOOLEAN DEFAULT TRUE,
      ai_processed BOOLEAN DEFAULT FALSE,
      company_id  INTEGER,
      ticker      TEXT,
      category    TEXT DEFAULT 'general',
      created_at  TIMESTAMPTZ DEFAULT NOW()
    )
  `);
  await safeQuery(`CREATE INDEX idx_news_pub_date ON news(pub_date DESC)`);
  await safeQuery(`CREATE INDEX idx_news_category ON news(category)`);
  await safeQuery(`CREATE INDEX idx_news_link ON news(link)`);
  await safeQuery(`CREATE INDEX idx_news_company_id ON news(company_id)`);

  // Jobs
  await db.query(`
    CREATE TABLE IF NOT EXISTS jobs (
      id            SERIAL PRIMARY KEY,
      user_id       INTEGER REFERENCES users(id) ON DELETE SET NULL,
      company_name  TEXT NOT NULL,
      ticker        TEXT,
      title         TEXT NOT NULL,
      location      TEXT NOT NULL,
      contact_email TEXT NOT NULL,
      description   TEXT,
      salary        TEXT,
      discipline    TEXT,
      job_type      TEXT DEFAULT 'Full-time',
      tags          TEXT[] DEFAULT '{}',
      promoted      BOOLEAN DEFAULT FALSE,
      status        TEXT DEFAULT 'active',
      expires_at    TIMESTAMPTZ DEFAULT (NOW() + INTERVAL '30 days'),
      created_at    TIMESTAMPTZ DEFAULT NOW()
    )
  `);
  await safeQuery(`CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs(status)`);
  await safeQuery(`CREATE INDEX IF NOT EXISTS idx_jobs_created ON jobs(created_at DESC)`);

  // Job applications
  await db.query(`
    CREATE TABLE IF NOT EXISTS job_applications (
      id              SERIAL PRIMARY KEY,
      job_id          INTEGER NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
      user_id         INTEGER REFERENCES users(id) ON DELETE SET NULL,
      name            TEXT NOT NULL,
      email           TEXT NOT NULL,
      phone           TEXT,
      resume_url      TEXT,
      cover_letter    TEXT,
      expected_salary TEXT,
      website         TEXT,
      status          TEXT DEFAULT 'new',
      created_at      TIMESTAMPTZ DEFAULT NOW()
    )
  `);
  await safeQuery(`CREATE INDEX IF NOT EXISTS idx_applications_job ON job_applications(job_id)`);
  await safeQuery(`CREATE INDEX IF NOT EXISTS idx_applications_user ON job_applications(user_id)`);
  await safeQuery(`CREATE UNIQUE INDEX IF NOT EXISTS idx_applications_unique ON job_applications(job_id, email)`);

  // Company profile enrichment (MarketScreener)
  await safeQuery(`ALTER TABLE companies ADD COLUMN IF NOT EXISTS description TEXT`);
  await safeQuery(`ALTER TABLE companies ADD COLUMN IF NOT EXISTS website TEXT`);
  await safeQuery(`ALTER TABLE companies ADD COLUMN IF NOT EXISTS headquarters TEXT`);
  await safeQuery(`ALTER TABLE companies ADD COLUMN IF NOT EXISTS ms_slug TEXT`);
  await safeQuery(`ALTER TABLE companies ADD COLUMN IF NOT EXISTS profile_scraped_at TIMESTAMPTZ`);
  await safeQuery(`CREATE INDEX IF NOT EXISTS idx_companies_ms_slug ON companies(ms_slug)`);

  // Company managers / directors (one row per person, source = 'marketscreener' | 'website')
  await db.query(`
    CREATE TABLE IF NOT EXISTS company_people (
      id          SERIAL PRIMARY KEY,
      company_id  INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
      name        TEXT NOT NULL,
      role_code   TEXT,
      title       TEXT,
      age         INTEGER,
      since_year  INTEGER,
      kind        TEXT NOT NULL DEFAULT 'manager',
      source      TEXT NOT NULL DEFAULT 'marketscreener',
      updated_at  TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE (company_id, name, kind)
    )
  `);
  await safeQuery(`CREATE INDEX IF NOT EXISTS idx_company_people_company ON company_people(company_id)`);

  // Watchlist
  await db.query(`
    CREATE TABLE IF NOT EXISTS watchlist (
      id          SERIAL PRIMARY KEY,
      user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      item_type   TEXT NOT NULL DEFAULT 'company',
      item_key    TEXT NOT NULL,
      company_id  INTEGER REFERENCES companies(id) ON DELETE CASCADE,
      created_at  TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE (user_id, item_type, item_key)
    )
  `);
  await safeQuery(`CREATE INDEX IF NOT EXISTS idx_watchlist_user ON watchlist(user_id)`);

  console.log('[DB] All migrations complete');
}

module.exports = migrate;
