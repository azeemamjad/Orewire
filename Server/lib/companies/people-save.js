/**
 * Persist website-extracted people. Unlike the exchange scraper's savePeople
 * (which DELETEs every row for a company), this:
 *   - preserves source='manual' rows (they win on conflict),
 *   - only applies when confidence + result quality clear the bar,
 *   - stamps a people_scraped_at watermark either way so a backfill terminates.
 */
const db = require('../../db');
const { stripHonorific } = require('./people-name');
const { PEOPLE_APPLY_MIN_CONFIDENCE } = require('./people-extract');

/**
 * @param {number} companyId
 * @param {object} data
 * @param {Array<{name,title,kind,role_code}>} data.people
 * @param {number} data.confidence
 * @param {string} [data.sourceUrl]
 * @param {number} [data.applyMinConfidence]
 * @returns {Promise<{applied:boolean, inserted?:number, reason?:string}>}
 */
async function savePeopleFromWebsite(companyId, {
  people = [],
  confidence = 0,
  sourceUrl = null,
  applyMinConfidence = PEOPLE_APPLY_MIN_CONFIDENCE,
} = {}) {
  const clean = (Array.isArray(people) ? people : [])
    .map((p) => ({ ...p, name: stripHonorific(String(p?.name || '').trim()) }))
    .filter((p) => p.name);

  const willApply = confidence >= applyMinConfidence && clean.length > 0;

  if (!willApply) {
    // Mark that we looked (so re-runs skip), but never wipe existing/manual people.
    await db.query(`UPDATE companies SET people_scraped_at = NOW() WHERE id = $1`, [companyId]);
    return {
      applied: false,
      reason: clean.length === 0 ? 'no_people' : 'low_confidence',
    };
  }

  const client = await db.connect();
  try {
    await client.query('BEGIN');
    // Replace previously-scraped people; keep manual entries.
    await client.query(
      `DELETE FROM company_people WHERE company_id = $1 AND source <> 'manual'`,
      [companyId],
    );
    let inserted = 0;
    for (const p of clean) {
      const r = await client.query(
        `INSERT INTO company_people (company_id, name, role_code, title, kind, source, updated_at)
         VALUES ($1, $2, $3, $4, $5, 'website', NOW())
         ON CONFLICT (company_id, name, kind) DO NOTHING`,
        [companyId, p.name, p.role_code ?? null, p.title ?? null, p.kind === 'director' ? 'director' : 'manager'],
      );
      inserted += r.rowCount || 0;
    }
    await client.query(
      `UPDATE companies SET people_scraped_at = NOW(), people_source = 'website', updated_at = NOW() WHERE id = $1`,
      [companyId],
    );
    await client.query('COMMIT');
    return { applied: true, inserted, sourceUrl };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

module.exports = { savePeopleFromWebsite };
