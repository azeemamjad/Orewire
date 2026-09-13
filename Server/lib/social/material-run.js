/**
 * Orchestration for the template-driven material posting pipeline:
 *   select one filing -> AI-generate the templated post -> publish via the active
 *   X credential set -> log to social_material_posts (+ social_post_runs).
 *
 * Guard rails live in material-select.js (dedupe, per-company suppression, daily cap,
 * min gap, category rotation). `dry_run` generates and logs without publishing.
 */
const db = require('../../db');
const { getSettings, PLATFORM } = require('./settings');
const { selectNext, loadCandidateDetail, candidateBlob } = require('./material-select');
const { composeMaterialPost } = require('./material-compose');
const { categoryFor, CATEGORY_PRIORITY } = require('./material-templates');
const { postThread } = require('./bridge-client');

let running = false;

function tweetIdFrom(posted) {
  const id = posted?.results?.tweets?.[0]?.id;
  if (id) return String(id);
  const m = String(posted?.threadUrl || '').match(/\/status\/(\d+)/);
  return m ? m[1] : null;
}

/** Insert or update the single row for a filing (filing_id is UNIQUE). */
async function saveMaterialPost(candidate, composed, extras = {}) {
  const text = extras.text ?? composed?.text ?? null;
  const r = await db.query(
    `INSERT INTO social_material_posts
       (filing_id, run_id, category, template_key, company_id, company_name, ticker, exchange,
        status, text, char_count, hashtags, fields, missing_fields, ai_model, ai_raw, attempts,
        tweet_id, thread_url, error, posted_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::jsonb,$14::jsonb,$15,$16::jsonb,$17,$18,$19,$20,$21)
     ON CONFLICT (filing_id) DO UPDATE SET
       run_id         = EXCLUDED.run_id,
       category       = EXCLUDED.category,
       template_key   = EXCLUDED.template_key,
       status         = EXCLUDED.status,
       text           = EXCLUDED.text,
       char_count     = EXCLUDED.char_count,
       hashtags       = EXCLUDED.hashtags,
       fields         = EXCLUDED.fields,
       missing_fields = EXCLUDED.missing_fields,
       ai_model       = EXCLUDED.ai_model,
       ai_raw         = EXCLUDED.ai_raw,
       attempts       = EXCLUDED.attempts,
       tweet_id       = EXCLUDED.tweet_id,
       thread_url     = EXCLUDED.thread_url,
       error          = EXCLUDED.error,
       posted_at      = EXCLUDED.posted_at
     RETURNING id`,
    [
      candidate.filing_id,
      extras.runId ?? null,
      candidate.category,
      candidate.category,
      candidate.company_id ?? null,
      candidate.company_display || candidate.company_name || null,
      candidate.ticker || null,
      candidate.company_exchange || candidate.exchange || null,
      extras.status || composed?.status || 'generated',
      text,
      text ? text.length : null,
      extras.hashtags ?? null,
      JSON.stringify(composed?.fields || {}),
      JSON.stringify(composed?.missing || []),
      composed?.model || null,
      composed?.raw ? JSON.stringify(composed.raw) : null,
      composed?.attempts || 0,
      extras.tweetId ?? null,
      extras.threadUrl ?? null,
      extras.error ?? null,
      extras.postedAt ?? null,
    ],
  );
  return r.rows[0]?.id || null;
}

async function createMaterialRun({ candidate, text, dryRun }) {
  const r = await db.query(
    `INSERT INTO social_post_runs (platform, status, trigger, dry_run, item_count, payload)
     VALUES ($1, 'running', 'material', $2, 1, $3::jsonb)
     RETURNING id`,
    [
      PLATFORM,
      !!dryRun,
      JSON.stringify({
        source: 'material',
        filingId: candidate.filing_id,
        category: candidate.category,
        ticker: candidate.ticker || null,
        text,
      }),
    ],
  );
  return r.rows[0]?.id || null;
}

async function finishMaterialRun(runId, { status, threadUrl, error }) {
  if (!runId) return;
  await db.query(
    `UPDATE social_post_runs
        SET finished_at = NOW(), status = $2, item_count = 1, thread_url = $3, error = $4
      WHERE id = $1`,
    [runId, status, threadUrl || null, error || null],
  ).catch(() => {});
}

/**
 * Generate (and optionally publish) one candidate.
 * @param {object} candidate  light candidate row + `category`
 * @param {{ settings: object, publish?: boolean, trigger?: string, persist?: boolean }} opts
 *        persist=false (preview) neither writes a row nor consumes the daily cap.
 */
async function processCandidate(candidate, { settings, publish = true, trigger = 'cron', persist = true } = {}) {
  const detail = await loadCandidateDetail(candidate.filing_id);
  if (!detail) return { ok: false, status: 'skipped', reason: 'filing_not_found' };

  const merged = {
    ...candidate,
    ...detail,
    category: candidate.category,
    filing_id: candidate.filing_id,
    ticker: detail.ticker || candidate.ticker,
  };

  const composed = await composeMaterialPost(merged);

  if (!composed.ok) {
    const bits = [composed.reason, composed.detail, composed.missing?.length ? `missing: ${composed.missing.join(', ')}` : null];
    const error = bits.filter(Boolean).join(' — ');
    if (!persist) {
      return {
        ok: false, status: composed.status, reason: composed.reason,
        detail: composed.detail, missing: composed.missing,
      };
    }
    const id = await saveMaterialPost(merged, composed, { status: composed.status, error });
    console.warn(`[material] ${composed.status} ${merged.ticker || merged.filing_id}: ${error}`);
    return {
      ok: false, status: composed.status, reason: composed.reason,
      detail: composed.detail, missing: composed.missing, id,
    };
  }

  if (!publish) {
    if (!persist) {
      return {
        ok: true, status: 'preview', text: composed.text, fields: composed.fields,
        category: merged.category, ticker: merged.ticker, filingId: merged.filing_id,
      };
    }
    const id = await saveMaterialPost(merged, composed, { status: 'generated' });
    return { ok: true, status: 'generated', id, text: composed.text, preview: true };
  }

  const dryRun = !!settings.dry_run;
  const runId = await createMaterialRun({ candidate: merged, text: composed.text, dryRun });

  try {
    const posted = await postThread([composed.text], { dryRun });
    const status = dryRun ? 'generated' : 'posted';
    const id = await saveMaterialPost(merged, composed, {
      runId,
      status,
      threadUrl: posted?.threadUrl || null,
      tweetId: tweetIdFrom(posted),
      postedAt: dryRun ? null : new Date(),
    });
    await finishMaterialRun(runId, { status: dryRun ? 'dry_run' : 'success', threadUrl: posted?.threadUrl });
    console.log(`[material] ${status} @${merged.ticker} (${merged.category}) filing #${merged.filing_id}${dryRun ? ' [dry run]' : ''}`);
    return {
      ok: true,
      status,
      id,
      runId,
      dryRun,
      category: merged.category,
      ticker: merged.ticker,
      threadUrl: posted?.threadUrl || null,
      text: composed.text,
      trigger,
    };
  } catch (err) {
    const msg = err?.message || String(err);
    const id = await saveMaterialPost(merged, composed, {
      runId,
      status: 'failed',
      error: msg,
      threadUrl: null,
    });
    await finishMaterialRun(runId, { status: 'error', error: msg });
    console.error(`[material] publish failed @${merged.ticker}: ${msg}`);
    return { ok: false, status: 'failed', reason: 'publish_failed', detail: msg, id, runId };
  }
}

/**
 * One scheduler tick: pick the best candidate and post it.
 * @param {{ trigger?: 'cron'|'manual', force?: boolean, publish?: boolean }} opts
 */
async function runMaterialTick({ trigger = 'cron', force = false, publish = true } = {}) {
  if (running) return { ok: false, error: 'A material post run is already in progress' };
  running = true;
  try {
    const settings = await getSettings();
    if (trigger === 'cron' && !settings.enabled) {
      return { ok: true, skipped: true, reason: 'paused' };
    }

    const sel = await selectNext({ settings, force });
    if (!sel.ok) return { ok: true, skipped: true, reason: sel.reason, guard: sel.guard };

    const result = await processCandidate(sel.candidate, { settings, publish, trigger });
    return { ...result, pool: sel.pool, guard: sel.guard };
  } finally {
    running = false;
  }
}

/**
 * Generate (and optionally publish) a specific filing — used by Preview and Retry.
 * `persist` defaults to `publish`, so a preview generates only (no row, no cap cost)
 * while a retry records its result.
 */
async function generateForFiling(filingId, { publish = false, persist = publish, settings } = {}) {
  const s = settings || await getSettings();
  const detail = await loadCandidateDetail(filingId);
  if (!detail) return { ok: false, error: 'Filing not found' };

  const category = categoryFor({ filing_type: detail.filing_type, blob: candidateBlob(detail) });
  if (!category) return { ok: false, error: 'Filing does not match a material category' };

  const candidate = { ...detail, category, filing_id: Number(filingId) };
  return processCandidate(candidate, { settings: s, publish, persist, trigger: 'manual' });
}

async function retryMaterialPost(id, { publish = true } = {}) {
  const r = await db.query('SELECT id, filing_id FROM social_material_posts WHERE id = $1', [id]);
  if (!r.rows.length) return { ok: false, error: 'Post not found' };
  return generateForFiling(r.rows[0].filing_id, { publish });
}

// ---------------------------------------------------------------------------
// Read models for the admin tab
// ---------------------------------------------------------------------------

async function listMaterialPosts({ status, category, limit = 50 } = {}) {
  const where = [];
  const params = [];
  if (status) { params.push(String(status)); where.push(`status = $${params.length}`); }
  if (category) { params.push(String(category)); where.push(`category = $${params.length}`); }
  params.push(Math.min(Math.max(Number(limit) || 50, 1), 200));
  const r = await db.query(
    `SELECT id, filing_id, run_id, category, template_key, company_name, ticker, exchange,
            status, text, char_count, hashtags, fields, missing_fields, ai_model,
            attempts, tweet_id, thread_url, error, created_at, posted_at
       FROM social_material_posts
      ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
      ORDER BY created_at DESC
      LIMIT $${params.length}`,
    params,
  );
  return r.rows;
}

async function getMaterialStats() {
  const [totals, byCategory, queue] = await Promise.all([
    db.query(
      `SELECT
         COUNT(*) FILTER (WHERE status = 'posted' AND posted_at > NOW() - INTERVAL '1 day')::int AS posted_today,
         COUNT(*) FILTER (WHERE status = 'posted' AND posted_at > NOW() - INTERVAL '7 days')::int AS posted_7d,
         COUNT(*) FILTER (WHERE status = 'posted' AND posted_at > NOW() - INTERVAL '30 days')::int AS posted_30d,
         COUNT(*) FILTER (WHERE status = 'generated' AND posted_at IS NULL)::int AS dry_runs,
         COUNT(*) FILTER (WHERE status = 'suppressed')::int AS suppressed,
         COUNT(*) FILTER (WHERE status = 'failed')::int AS failed,
         COUNT(*)::int AS total,
         MAX(posted_at) AS last_posted_at
       FROM social_material_posts`,
    ),
    db.query(
      `SELECT category,
              COUNT(*) FILTER (WHERE status = 'posted')::int AS posted,
              COUNT(*) FILTER (WHERE status = 'suppressed')::int AS suppressed,
              COUNT(*) FILTER (WHERE status = 'failed')::int AS failed,
              COUNT(*)::int AS total
         FROM social_material_posts
        GROUP BY category`,
    ),
    db.query(
      `SELECT status, COUNT(*)::int AS n FROM social_material_posts GROUP BY status`,
    ),
  ]);

  const t = totals.rows[0] || {};
  const attempted = (t.posted_30d || 0) + (t.suppressed || 0) + (t.failed || 0);
  const successRate30d = attempted > 0 ? Math.round((100 * (t.posted_30d || 0)) / attempted) : null;

  const categories = Object.fromEntries(
    CATEGORY_PRIORITY.map((c) => [c, { posted: 0, suppressed: 0, failed: 0, total: 0 }]),
  );
  for (const row of byCategory.rows) {
    categories[row.category] = {
      posted: row.posted || 0,
      suppressed: row.suppressed || 0,
      failed: row.failed || 0,
      total: row.total || 0,
    };
  }

  return {
    counters: {
      postedToday: t.posted_today || 0,
      posted7d: t.posted_7d || 0,
      posted30d: t.posted_30d || 0,
      dryRuns: t.dry_runs || 0,
      suppressed: t.suppressed || 0,
      failed: t.failed || 0,
      total: t.total || 0,
      successRate30d,
    },
    byCategory: categories,
    byStatus: Object.fromEntries(queue.rows.map((r) => [r.status, r.n])),
    lastPostedAt: t.last_posted_at || null,
  };
}

module.exports = {
  runMaterialTick,
  generateForFiling,
  retryMaterialPost,
  listMaterialPosts,
  getMaterialStats,
  saveMaterialPost,
  processCandidate,
  tweetIdFrom,
};
