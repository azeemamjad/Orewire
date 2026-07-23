const db = require('../../db');
const { getSettings, updateSettings, PLATFORM } = require('./settings');
const { getAccount, publicAccount, markAccountStatus } = require('./accounts');
const { selectThreadItems } = require('./select');
const { composeThread } = require('./compose');
const {
  postThread,
  isBridgeConfigured,
  getBridgeCredentials,
  getBridgePublic,
} = require('./bridge-client');

let running = false;

async function alreadyRanToday(timezone) {
  // Compare calendar day in settings timezone via Postgres AT TIME ZONE
  const r = await db.query(
    `SELECT id FROM social_post_runs
      WHERE platform = $1
        AND status IN ('success', 'dry_run')
        AND trigger = 'cron'
        AND (started_at AT TIME ZONE $2)::date = (NOW() AT TIME ZONE $2)::date
      LIMIT 1`,
    [PLATFORM, timezone || 'America/Toronto'],
  );
  return !!r.rows.length;
}

async function createRun({ trigger, dryRun }) {
  const r = await db.query(
    `INSERT INTO social_post_runs (platform, status, trigger, dry_run)
     VALUES ($1, 'running', $2, $3)
     RETURNING id`,
    [PLATFORM, trigger, !!dryRun],
  );
  return r.rows[0].id;
}

async function finishRun(runId, { status, itemCount, threadUrl, error, payload }) {
  await db.query(
    `UPDATE social_post_runs
        SET finished_at = NOW(),
            status = $2,
            item_count = $3,
            thread_url = $4,
            error = $5,
            payload = $6::jsonb
      WHERE id = $1`,
    [
      runId,
      status,
      itemCount || 0,
      threadUrl || null,
      error || null,
      JSON.stringify(payload || {}),
    ],
  );
}

async function insertItems(runId, composedItems, intro, close) {
  const rows = [
    { kind: 'intro', sourceId: null, tweetText: intro, position: 1 },
    ...composedItems.map((item) => ({
      kind: item.kind,
      sourceId: item.sourceId,
      tweetText: item.tweetText,
      position: item.position,
    })),
  ];
  rows.push({
    kind: 'close',
    sourceId: null,
    tweetText: close,
    position: rows.length + 1,
  });

  for (const row of rows) {
    await db.query(
      `INSERT INTO social_post_items (run_id, kind, source_id, tweet_text, position)
       VALUES ($1, $2, $3, $4, $5)`,
      [runId, row.kind, row.sourceId, row.tweetText, row.position],
    );
  }
}

/**
 * Orchestrate select → compose → post via WebBridge → log.
 * @param {{ trigger?: 'cron'|'manual', force?: boolean }} opts
 */
async function runSocialPost(opts = {}) {
  const trigger = opts.trigger || 'cron';
  const force = !!opts.force;

  if (running) {
    return { ok: false, error: 'A social post run is already in progress' };
  }

  const settings = await getSettings();
  if (trigger === 'cron' && !settings.enabled) {
    return { ok: false, skipped: true, reason: 'paused' };
  }

  if (trigger === 'cron' && !force) {
    const done = await alreadyRanToday(settings.timezone);
    if (done) {
      return { ok: false, skipped: true, reason: 'already_ran_today' };
    }
  }

  const dryRun = settings.dry_run;
  if (!dryRun) {
    let creds;
    try {
      creds = await getBridgeCredentials();
    } catch (err) {
      return { ok: false, error: err?.message || 'Invalid bridge URL' };
    }
    if (!isBridgeConfigured(creds)) {
      return { ok: false, error: 'WebBridge not configured — paste ngrok URL + token in Social Automation' };
    }
    if (settings.bridge_status !== 'ok' && trigger === 'cron') {
      return {
        ok: false,
        error: 'WebBridge not verified — open Social Automation and Test connection',
      };
    }
  }

  running = true;
  const runId = await createRun({ trigger, dryRun });

  try {
    const items = await selectThreadItems({
      itemsMin: settings.items_min,
      itemsMax: settings.items_max,
    });

    if (!items.length) {
      await finishRun(runId, {
        status: 'skipped',
        itemCount: 0,
        error: 'No filings/news items in the last 24h',
        payload: { reason: 'no_items' },
      });
      return { ok: true, skipped: true, reason: 'no_items', runId };
    }

    const composed = await composeThread(items);
    await insertItems(runId, composed.items, composed.intro, composed.close);

    const posted = await postThread(composed.pages, { dryRun });

    const status = dryRun ? 'dry_run' : 'success';
    await finishRun(runId, {
      status,
      itemCount: items.length,
      threadUrl: posted.threadUrl,
      payload: {
        hashtags: composed.hashtags,
        dryRun,
        pageCount: composed.pages.length,
        via: dryRun ? 'local' : 'webbridge',
        preview: dryRun ? composed.pages : undefined,
      },
    });

    return {
      ok: true,
      runId,
      dryRun,
      itemCount: items.length,
      threadUrl: posted.threadUrl,
      pages: dryRun ? composed.pages : undefined,
    };
  } catch (err) {
    const msg = err?.message || String(err);
    console.error('[social] Run failed:', msg);
    await finishRun(runId, {
      status: 'error',
      itemCount: 0,
      error: msg,
      payload: {},
    });
    if (/bridge|ngrok|extension|unauthorized|401/i.test(msg)) {
      // Auto-pause cron on bridge failure so we don't spam errors
      if (settings.enabled) {
        await updateSettings({ enabled: false });
      }
    }
    // Legacy account status (no longer required for posting)
    if (/auth|login|cookie|csrf|session/i.test(msg)) {
      await markAccountStatus('needs_login', msg).catch(() => {});
    }
    return { ok: false, runId, error: msg };
  } finally {
    running = false;
  }
}

async function getStatusSnapshot() {
  const [settings, account, bridge, lastRun] = await Promise.all([
    getSettings(),
    getAccount(),
    getBridgePublic(),
    db.query(
      `SELECT id, started_at, finished_at, status, trigger, item_count, thread_url, error, dry_run
         FROM social_post_runs
        WHERE platform = $1
        ORDER BY started_at DESC
        LIMIT 1`,
      [PLATFORM],
    ),
  ]);

  return {
    settings,
    account: publicAccount(account),
    bridge,
    lastRun: lastRun.rows[0] || null,
    cronEnabledEnv: process.env.SOCIAL_X_CRON_ENABLED !== 'false',
  };
}

module.exports = {
  runSocialPost,
  getStatusSnapshot,
  alreadyRanToday,
};
