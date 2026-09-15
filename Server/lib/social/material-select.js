/**
 * Candidate selection for the template-driven material posting pipeline.
 *
 * Responsibilities: pull recent high-verdict filings, resolve each to a material
 * category (deterministic — see material-templates.js), rank them, and enforce the
 * guards that keep volume sane:
 *   - never the same filing twice (social_material_posts.filing_id is UNIQUE)
 *   - no more than one post per company per `material_per_company_days`
 *   - daily cap counted in the account timezone
 *   - minimum gap between posts
 *   - category rotation so drill results cannot monopolise the cap
 */
const db = require('../../db');
const { PLATFORM } = require('./settings');
const { categoryFor, CATEGORY_PRIORITY } = require('./material-templates');

const CANDIDATE_WINDOW_HOURS = Number(process.env.SOCIAL_MATERIAL_WINDOW_HOURS) || 48;
const CANDIDATE_POOL_LIMIT = Number(process.env.SOCIAL_MATERIAL_POOL_LIMIT) || 800;

function verdictListFor(minVerdict) {
  return minVerdict === 'watch' ? ['noteworthy', 'watch'] : ['noteworthy'];
}

/**
 * Light rows for categorisation + ranking (no raw_response — that is fetched only
 * for the one filing we actually generate).
 */
async function loadCandidates({ settings, hours = CANDIDATE_WINDOW_HOURS, limit = CANDIDATE_POOL_LIMIT } = {}) {
  const since = new Date(Date.now() - hours * 3600 * 1000);
  const verdicts = verdictListFor(settings?.material_min_verdict);
  const perCompanyDays = Number(settings?.material_per_company_days) || 7;

  const r = await db.query(
    `SELECT f.id AS filing_id, f.company_id, f.company_name, f.exchange, f.filing_type,
            f.pdf_filename, f.created_at, f.source_url,
            c.ticker, c.exchange AS company_exchange, c.name AS company_display,
            a.verdict, a.ticker_summary, a.summary, a.verdict_reason,
            a.pp_amount, a.pp_price, a.resource_estimate
       FROM filings f
       JOIN ai_output a ON a.filing_id = f.id
       JOIN companies c ON c.id = f.company_id
      WHERE f.created_at > $1
        AND lower(COALESCE(a.verdict, '')) = ANY($2)
        AND c.ticker IS NOT NULL
        AND NOT EXISTS (SELECT 1 FROM social_material_posts m WHERE m.filing_id = f.id)
        AND NOT EXISTS (
              SELECT 1 FROM social_material_posts m2
               WHERE m2.company_id = f.company_id
                 AND m2.posted_at IS NOT NULL
                 AND m2.posted_at > NOW() - ($3::int * INTERVAL '1 day')
            )
      ORDER BY f.created_at DESC
      LIMIT $4`,
    [since, verdicts, perCompanyDays, limit],
  );
  return r.rows;
}

/** Keyword haystack for a light candidate row (filename + AI summaries). */
function candidateBlob(row) {
  return [row.pdf_filename, row.ticker_summary, row.summary, row.verdict_reason]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
}

/** Attach the resolved category; drop rows that match no material category. */
function categorize(rows, { categories } = {}) {
  const allowed = Array.isArray(categories) && categories.length ? new Set(categories) : null;
  const out = [];
  for (const row of rows) {
    const category = categoryFor({ filing_type: row.filing_type, blob: candidateBlob(row) });
    if (!category) continue;
    if (allowed && !allowed.has(category)) continue;
    out.push({ ...row, category });
  }
  return out;
}

/** Materiality signal available without the heavy raw_response. */
function rankScore(row) {
  let score = 0;
  if (String(row.verdict || '').toLowerCase() === 'noteworthy') score += 2;
  if (row.category === 'financing' && row.pp_amount != null) score += 2;
  if ((row.category === 'resource' || row.category === 'study') && row.resource_estimate != null) score += 2;
  if (row.category === 'drill' && /\d+(?:\.\d+)?\s*(?:g\/t|%|ppm|moz|koz|mt\b)/i.test(row.summary || '')) score += 1;
  if (row.company_exchange) score += 0.5; // TSX/TSXV/CSE/ASX — more relevant to the audience
  return score;
}

/**
 * How many posts each category has had in the last N days (drives rotation).
 * Counts dry-run generations too — if only 'posted' counted, a dry run would leave every
 * counter at zero and the same high-scoring categories would win every single tick.
 */
async function categoryRecentCounts(days = 7) {
  const r = await db.query(
    `SELECT category, COUNT(*)::int AS n
       FROM social_material_posts
      WHERE status IN ('posted', 'generated')
        AND COALESCE(posted_at, created_at) > NOW() - ($1::int * INTERVAL '1 day')
      GROUP BY category`,
    [Number(days) || 7],
  );
  const counts = Object.fromEntries(CATEGORY_PRIORITY.map((c) => [c, 0]));
  for (const row of r.rows) counts[row.category] = row.n;
  return counts;
}

/**
 * Rank candidates: least-represented category first (rotation), then materiality,
 * then newest. Returns the ordered list.
 */
async function rankCandidates(rows) {
  const recent = await categoryRecentCounts(7);
  return rows
    .map((row) => ({
      ...row,
      score: rankScore(row),
      categoryRecent: recent[row.category] ?? 0,
    }))
    .sort((a, b) => (
      a.categoryRecent - b.categoryRecent
      || b.score - a.score
      || new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
    ));
}

/**
 * Posts produced today, in the account timezone.
 * While `dry_run` is on this counts generations, so a dry run cannot burn AI calls every
 * tick. Once live it counts only real posts, so a day's dry runs do not eat the live quota.
 */
async function countPostedToday(timezone = 'America/Toronto', { dryRun = false } = {}) {
  const statuses = dryRun ? ['posted', 'generated'] : ['posted'];
  const r = await db.query(
    `SELECT COUNT(*)::int AS n
       FROM social_material_posts
      WHERE status = ANY($2)
        AND (COALESCE(posted_at, created_at) AT TIME ZONE $1)::date = (NOW() AT TIME ZONE $1)::date`,
    [timezone, statuses],
  );
  return r.rows[0]?.n || 0;
}

/** Timestamp of the most recent post/generation (for the min-gap guard). */
async function lastPostedAt({ dryRun = false } = {}) {
  const statuses = dryRun ? ['posted', 'generated'] : ['posted'];
  const r = await db.query(
    `SELECT MAX(COALESCE(posted_at, created_at)) AS last
       FROM social_material_posts
      WHERE status = ANY($1)`,
    [statuses],
  );
  return r.rows[0]?.last || null;
}

/** Guard result explaining why we are (not) posting right now. */
async function checkGuards({ settings, force = false } = {}) {
  if (force) return { ok: true, forced: true };

  const dryRun = !!settings.dry_run;
  const postedToday = await countPostedToday(settings.timezone, { dryRun });
  const cap = Number(settings.material_daily_cap) || 3;
  if (postedToday >= cap) {
    return { ok: false, reason: 'daily_cap_reached', postedToday, cap };
  }

  const gapMin = Number(settings.material_min_gap_minutes) || 0;
  if (gapMin > 0) {
    const last = await lastPostedAt({ dryRun });
    if (last) {
      const elapsedMin = (Date.now() - new Date(last).getTime()) / 60000;
      if (elapsedMin < gapMin) {
        return { ok: false, reason: 'min_gap', elapsedMin: Math.round(elapsedMin), gapMin };
      }
    }
  }
  return { ok: true, postedToday, cap };
}

/** Full detail (incl. raw_response) for the one filing we are about to generate. */
async function loadCandidateDetail(filingId) {
  const r = await db.query(
    `SELECT f.id AS filing_id, f.company_id, f.company_name, f.exchange, f.filing_type,
            f.pdf_filename, f.created_at, f.source_url,
            c.ticker, c.exchange AS company_exchange, c.name AS company_display, c.sector,
            a.verdict, a.ticker_summary, a.summary, a.verdict_reason, a.key_facts,
            a.context, a.grade_commentary, a.what_to_watch, a.resource_estimate,
            a.pp_amount, a.pp_price, a.raw_response
       FROM filings f
       JOIN ai_output a ON a.filing_id = f.id
       JOIN companies c ON c.id = f.company_id
      WHERE f.id = $1`,
    [filingId],
  );
  return r.rows[0] || null;
}

/**
 * Pick the single best candidate to post now.
 * @returns {Promise<{ ok: boolean, reason?: string, candidate?: object }>}
 */
async function selectNext({ settings, force = false, hours, limit } = {}) {
  const guard = await checkGuards({ settings, force });
  if (!guard.ok) return { ok: false, reason: guard.reason, guard };

  const rows = await loadCandidates({ settings, hours, limit });
  if (!rows.length) return { ok: false, reason: 'no_candidates' };

  const categorized = categorize(rows, { categories: settings.material_categories });
  if (!categorized.length) return { ok: false, reason: 'no_candidates' };

  const ranked = await rankCandidates(categorized);
  return { ok: true, candidate: ranked[0], guard, pool: ranked.length };
}

module.exports = {
  CANDIDATE_WINDOW_HOURS,
  CANDIDATE_POOL_LIMIT,
  verdictListFor,
  loadCandidates,
  candidateBlob,
  categorize,
  rankScore,
  categoryRecentCounts,
  rankCandidates,
  countPostedToday,
  lastPostedAt,
  checkGuards,
  loadCandidateDetail,
  selectNext,
  PLATFORM,
};
