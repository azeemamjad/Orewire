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

  // News — preserve rows across restarts; add columns if missing
  await db.query(`
    CREATE TABLE IF NOT EXISTS news (
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
  await safeQuery(`ALTER TABLE news ADD COLUMN IF NOT EXISTS summary TEXT`);
  await safeQuery(`ALTER TABLE news ADD COLUMN IF NOT EXISTS commodity TEXT`);
  await safeQuery(`ALTER TABLE news ADD COLUMN IF NOT EXISTS sentiment TEXT DEFAULT 'neutral'`);
  await safeQuery(`ALTER TABLE news ADD COLUMN IF NOT EXISTS relevant BOOLEAN DEFAULT TRUE`);
  await safeQuery(`ALTER TABLE news ADD COLUMN IF NOT EXISTS ai_processed BOOLEAN DEFAULT FALSE`);
  await safeQuery(`ALTER TABLE news ADD COLUMN IF NOT EXISTS company_id INTEGER`);
  await safeQuery(`ALTER TABLE news ADD COLUMN IF NOT EXISTS ticker TEXT`);
  await safeQuery(`ALTER TABLE news ADD COLUMN IF NOT EXISTS category TEXT DEFAULT 'general'`);
  await safeQuery(`ALTER TABLE news ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW()`);
  // origin marks where a row came from: 'rss' = scheduled feeds (Newsfile, GlobeNewsWire),
  // 'google' = per-company Google News search. Drives the News Releases vs Market News split.
  await safeQuery(`ALTER TABLE news ADD COLUMN IF NOT EXISTS origin TEXT DEFAULT 'rss'`);
  // Backfill legacy rows: scheduled-feed rows carry a fixed source label; anything else with a
  // real publisher name (Reuters, Bloomberg, …) came from Google News. Idempotent — only flips
  // rows still tagged 'rss', so it matches nothing after the first run.
  await safeQuery(`
    UPDATE news SET origin = 'google'
    WHERE origin = 'rss'
      AND COALESCE(source, '') NOT IN ('TMX Newsfile', 'GlobeNewsWire', 'News', '')
  `);
  await safeQuery(`CREATE INDEX IF NOT EXISTS idx_news_pub_date ON news(pub_date DESC)`);
  await safeQuery(`CREATE INDEX IF NOT EXISTS idx_news_origin ON news(origin)`);
  await safeQuery(`CREATE INDEX IF NOT EXISTS idx_news_category ON news(category)`);
  await safeQuery(`CREATE INDEX IF NOT EXISTS idx_news_link ON news(link)`);
  await safeQuery(`CREATE INDEX IF NOT EXISTS idx_news_company_id ON news(company_id)`);

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

  // Exchange-sourced profile fields (TMX / CSE / ASX official listing pages).
  // transfer_agent covers Transfer Agent (Canada: TSX/TSXV/CSE) and Share Registry (AUS: ASX).
  await safeQuery(`ALTER TABLE companies ADD COLUMN IF NOT EXISTS transfer_agent TEXT`);
  // Set whenever the SEDAR+ transfer-agent scrape has looked at a company —
  // whether or not an agent was found — so a "missing only" re-run skips rows
  // we've already checked (and found none) instead of re-scraping them forever.
  await safeQuery(`ALTER TABLE companies ADD COLUMN IF NOT EXISTS transfer_agent_checked_at TIMESTAMPTZ`);
  await safeQuery(`ALTER TABLE companies ADD COLUMN IF NOT EXISTS phone TEXT`);
  await safeQuery(`ALTER TABLE companies ADD COLUMN IF NOT EXISTS shares_outstanding BIGINT`);
  await safeQuery(`ALTER TABLE companies ADD COLUMN IF NOT EXISTS profile_source TEXT`);

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

  // Filing source URL (link back to the original document on SEDAR+/ASX)
  await safeQuery(`ALTER TABLE filings ADD COLUMN IF NOT EXISTS source_url TEXT`);

  // Insider ownership — current snapshot, one row per (company, insider).
  // Populated from filings (SEDI / proxy / director interest / substantial holder).
  await db.query(`
    CREATE TABLE IF NOT EXISTS insider_ownership (
      id                       SERIAL PRIMARY KEY,
      company_id               INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
      insider_name             TEXT NOT NULL,
      title                    TEXT,
      total_shares             BIGINT,
      percent_ownership        REAL,
      last_transaction         TEXT,
      last_transaction_date    DATE,
      last_updated_from_filing INTEGER REFERENCES filings(id) ON DELETE SET NULL,
      updated_at               TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE (company_id, insider_name)
    )
  `);
  await safeQuery(`CREATE INDEX IF NOT EXISTS idx_insider_ownership_company ON insider_ownership(company_id)`);

  // Insider transactions — chronological history, one row per filed transaction.
  await db.query(`
    CREATE TABLE IF NOT EXISTS insider_transactions (
      id                   SERIAL PRIMARY KEY,
      company_id           INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
      filing_id            INTEGER REFERENCES filings(id) ON DELETE CASCADE,
      insider_name         TEXT NOT NULL,
      title                TEXT,
      transaction_type     TEXT,
      shares               BIGINT,
      price                REAL,
      transaction_date     DATE,
      total_holdings_after BIGINT,
      created_at           TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE (company_id, insider_name, transaction_date, shares, transaction_type)
    )
  `);
  await safeQuery(`CREATE INDEX IF NOT EXISTS idx_insider_tx_company ON insider_transactions(company_id, transaction_date DESC)`);

  await safeQuery(`ALTER TABLE users ADD COLUMN IF NOT EXISTS briefing_enabled BOOLEAN DEFAULT TRUE`);

  await db.query(`
    CREATE TABLE IF NOT EXISTS briefing_subscribers (
      id              SERIAL PRIMARY KEY,
      email           TEXT UNIQUE NOT NULL,
      created_at      TIMESTAMPTZ DEFAULT NOW(),
      unsubscribed_at TIMESTAMPTZ
    )
  `);

  await safeQuery(`ALTER TABLE users ADD COLUMN IF NOT EXISTS watchlist_alerts_enabled BOOLEAN DEFAULT TRUE`);

  await db.query(`
    CREATE TABLE IF NOT EXISTS watchlist_news_email_sent (
      user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      news_id    INTEGER NOT NULL REFERENCES news(id) ON DELETE CASCADE,
      sent_at    TIMESTAMPTZ DEFAULT NOW(),
      PRIMARY KEY (user_id, news_id)
    )
  `);
  await safeQuery(`CREATE INDEX IF NOT EXISTS idx_watchlist_news_sent_news ON watchlist_news_email_sent(news_id)`);

  await db.query(`
    CREATE TABLE IF NOT EXISTS watchlist_filing_email_sent (
      user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      filing_id  INTEGER NOT NULL REFERENCES filings(id) ON DELETE CASCADE,
      sent_at    TIMESTAMPTZ DEFAULT NOW(),
      PRIMARY KEY (user_id, filing_id)
    )
  `);
  await safeQuery(`CREATE INDEX IF NOT EXISTS idx_watchlist_filing_sent_filing ON watchlist_filing_email_sent(filing_id)`);

  await safeQuery(`ALTER TABLE watchlist ADD COLUMN IF NOT EXISTS alerts_enabled BOOLEAN DEFAULT FALSE`);
  // User-defined ordering for watchlist rows (NULL = unsorted, falls back to created_at).
  await safeQuery(`ALTER TABLE watchlist ADD COLUMN IF NOT EXISTS sort_order INTEGER`);
  await safeQuery(`ALTER TABLE watchlist ADD COLUMN IF NOT EXISTS alert_move_notified_date DATE`);

  // Admin / pipeline configuration (JSON per key — e.g. pipeline schedules & workers)
  await db.query(`
    CREATE TABLE IF NOT EXISTS app_settings (
      key         TEXT PRIMARY KEY,
      value       JSONB NOT NULL DEFAULT '{}',
      updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  // Relay — which pipeline jobs need a browser / captcha (see Server/relay/task-registry.js)
  await db.query(`
    CREATE TABLE IF NOT EXISTS browser_tasks (
      slug                  TEXT PRIMARY KEY,
      name                  TEXT NOT NULL,
      category              TEXT NOT NULL,
      script_entry          TEXT,
      exchange              TEXT,
      needs_browser         BOOLEAN NOT NULL DEFAULT TRUE,
      needs_captcha         BOOLEAN NOT NULL DEFAULT FALSE,
      captcha_site          TEXT,
      preferred_relay_tier  TEXT,
      relay_worker_id       TEXT,
      notes                 TEXT,
      enabled               BOOLEAN NOT NULL DEFAULT TRUE,
      created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS relay_task_events (
      id              SERIAL PRIMARY KEY,
      task_slug       TEXT REFERENCES browser_tasks(slug) ON DELETE SET NULL,
      worker_id       TEXT,
      status          TEXT NOT NULL,
      message         TEXT,
      company_ticker  TEXT,
      created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await safeQuery(`CREATE INDEX IF NOT EXISTS idx_relay_task_events_created ON relay_task_events(created_at DESC)`);
  await safeQuery(`CREATE INDEX IF NOT EXISTS idx_relay_task_events_slug ON relay_task_events(task_slug)`);

  // AI-generated situational brief per company (company detail page).
  await db.query(`
    CREATE TABLE IF NOT EXISTS company_snapshots (
      company_id    INTEGER PRIMARY KEY REFERENCES companies(id) ON DELETE CASCADE,
      body          TEXT NOT NULL,
      paragraphs    JSONB NOT NULL DEFAULT '[]',
      key_points    JSONB NOT NULL DEFAULT '[]',
      sources_meta  JSONB NOT NULL DEFAULT '{}',
      input_hash    TEXT,
      model         TEXT,
      generated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await safeQuery(`CREATE INDEX IF NOT EXISTS idx_company_snapshots_generated ON company_snapshots(generated_at DESC)`);

  // Contact form messages (public site → admin inbox)
  await db.query(`
    CREATE TABLE IF NOT EXISTS contact_messages (
      id         SERIAL PRIMARY KEY,
      name       TEXT NOT NULL,
      email      TEXT,
      company    TEXT,
      subject    TEXT NOT NULL,
      message    TEXT NOT NULL,
      user_id    INTEGER REFERENCES users(id) ON DELETE SET NULL,
      read_at    TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await safeQuery(`CREATE INDEX IF NOT EXISTS idx_contact_messages_created ON contact_messages(created_at DESC)`);
  await safeQuery(`CREATE INDEX IF NOT EXISTS idx_contact_messages_unread ON contact_messages(read_at) WHERE read_at IS NULL`);

  await safeQuery(`ALTER TABLE users ADD COLUMN IF NOT EXISTS must_change_password BOOLEAN NOT NULL DEFAULT FALSE`);
  await safeQuery(`ALTER TABLE users ADD COLUMN IF NOT EXISTS created_by_admin BOOLEAN NOT NULL DEFAULT FALSE`);
  await safeQuery(`ALTER TABLE users ADD COLUMN IF NOT EXISTS password_set_at TIMESTAMPTZ`);
  await safeQuery(`ALTER TABLE users ADD COLUMN IF NOT EXISTS company TEXT`);

  // VA task queue — deduplicated items needing human attention
  await db.query(`
    CREATE TABLE IF NOT EXISTS va_tasks (
      id               SERIAL PRIMARY KEY,
      source_key       TEXT NOT NULL UNIQUE,
      module           TEXT NOT NULL,
      error_type       TEXT NOT NULL,
      title            TEXT NOT NULL,
      description      TEXT,
      action_url       TEXT,
      severity         TEXT NOT NULL DEFAULT 'medium',
      occurrence_count INTEGER NOT NULL DEFAULT 1,
      sample_detail    TEXT,
      auto_managed     BOOLEAN NOT NULL DEFAULT TRUE,
      status           TEXT NOT NULL DEFAULT 'open',
      assigned_note    TEXT,
      first_seen_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      last_seen_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      resolved_at      TIMESTAMPTZ,
      resolved_by      TEXT
    )
  `);
  await safeQuery(`CREATE INDEX IF NOT EXISTS idx_va_tasks_status ON va_tasks(status, last_seen_at DESC)`);
  await safeQuery(`CREATE INDEX IF NOT EXISTS idx_va_tasks_module ON va_tasks(module, error_type)`);

  const contactCount = await db.query(`SELECT COUNT(*)::int AS n FROM contact_messages`);
  if ((contactCount.rows[0]?.n || 0) === 0) {
    await db.query(
      `INSERT INTO contact_messages (name, email, company, subject, message, read_at, created_at)
       VALUES
         ($1, $2, $3, $4, $5, NULL, NOW() - INTERVAL '2 hours'),
         ($6, $7, $8, $9, $10, NULL, NOW() - INTERVAL '1 day'),
         ($11, $12, $13, $14, $15, NOW() - INTERVAL '3 days', NOW() - INTERVAL '4 days')`,
      [
        'Sarah Mitchell',
        'sarah.mitchell@northerngold.ca',
        'Northern Gold Corp',
        'Partnership inquiry',
        'Hi team, we are interested in featuring OreWire in our investor newsletter. Could you share media kit and sponsorship options?',
        'James Okonkwo',
        'j.okonkwo@example.com',
        null,
        'Bug: watchlist alerts',
        'I added three TSX-V companies to my watchlist but only received one alert this week. Is there a delay or a setting I missed?',
        'Elena Vasquez',
        'elena@pacificresources.io',
        'Pacific Resources',
        'Data licensing question',
        'We would like to discuss API access or bulk export for our internal research desk. Please let me know if this is available.',
      ],
    );
    console.log('[DB] Seeded 3 dummy contact messages');
  }

  console.log('[DB] All migrations complete');
}

module.exports = migrate;
