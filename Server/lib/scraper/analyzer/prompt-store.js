/**
 * Per-type prompt overrides. The Testing tab lets an operator author/tune a
 * system prompt for a specific filing_type; production analysis uses that saved
 * prompt when present, otherwise the code's focused split (buildSystemPrompt).
 *
 * Stored in app_settings: `filing_prompt:<type>` per type, and the legacy global
 * key `testing_filing_prompt` for the "Default (all types)" slot (type = null).
 *
 * Production vs draft: the keys above are the LIVE prompts production analysis
 * reads. Draft edits from the Testing tab are kept separately under
 * `filing_prompt_draft:<type>` (and `testing_filing_prompt_draft` global) so an
 * operator can save/iterate without touching the real system until they
 * explicitly promote a draft to production.
 */
const db = require('../../../db');
const { SYSTEM_PROMPT, buildSystemPrompt } = require('./prompt');
const { CANONICAL_SET } = require('./classify');

const GLOBAL_KEY = 'testing_filing_prompt';
const PREFIX = 'filing_prompt:';
const GLOBAL_DRAFT_KEY = 'testing_filing_prompt_draft';
const DRAFT_PREFIX = 'filing_prompt_draft:';

function keyFor(type) {
  return type && CANONICAL_SET.has(type) ? `${PREFIX}${type}` : GLOBAL_KEY;
}

function draftKeyFor(type) {
  return type && CANONICAL_SET.has(type) ? `${DRAFT_PREFIX}${type}` : GLOBAL_DRAFT_KEY;
}

/** The built-in (code) default prompt for a type — full prompt for null/unmapped. */
function defaultPromptForType(type) {
  return type && CANONICAL_SET.has(type) ? buildSystemPrompt(type) : SYSTEM_PROMPT;
}

/** Saved custom prompt for a type, or null if none. */
async function getTypePrompt(type) {
  try {
    const r = await db.query(`SELECT value FROM app_settings WHERE key = $1`, [keyFor(type)]);
    const v = r.rows[0]?.value;
    if (v && typeof v.prompt === 'string' && v.prompt.trim()) return v.prompt;
  } catch { /* fall through */ }
  return null;
}

async function isCustom(type) {
  try {
    const r = await db.query(`SELECT 1 FROM app_settings WHERE key = $1`, [keyFor(type)]);
    return r.rows.length > 0;
  } catch {
    return false;
  }
}

async function saveTypePrompt(type, prompt) {
  await db.query(
    `INSERT INTO app_settings (key, value, updated_at)
     VALUES ($1, $2::jsonb, NOW())
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
    [keyFor(type), JSON.stringify({ prompt: String(prompt ?? '') })],
  );
}

async function clearTypePrompt(type) {
  await db.query(`DELETE FROM app_settings WHERE key = $1`, [keyFor(type)]);
}

/** Saved draft prompt for a type (testing only, never used by production), or null. */
async function getDraftPrompt(type) {
  try {
    const r = await db.query(`SELECT value FROM app_settings WHERE key = $1`, [draftKeyFor(type)]);
    const v = r.rows[0]?.value;
    if (v && typeof v.prompt === 'string' && v.prompt.trim()) return v.prompt;
  } catch { /* fall through */ }
  return null;
}

async function saveDraftPrompt(type, prompt) {
  await db.query(
    `INSERT INTO app_settings (key, value, updated_at)
     VALUES ($1, $2::jsonb, NOW())
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
    [draftKeyFor(type), JSON.stringify({ prompt: String(prompt ?? '') })],
  );
}

async function clearDraftPrompt(type) {
  await db.query(`DELETE FROM app_settings WHERE key = $1`, [draftKeyFor(type)]);
}

/** Which filing types currently have a saved custom prompt. */
async function listCustomizedTypes() {
  try {
    const r = await db.query(`SELECT key FROM app_settings WHERE key LIKE $1`, [`${PREFIX}%`]);
    return r.rows.map((row) => row.key.slice(PREFIX.length));
  } catch {
    return [];
  }
}

/** Effective production system prompt for a type: saved custom OR the code split. */
async function effectiveSystemPrompt(type) {
  const custom = await getTypePrompt(type);
  return custom || buildSystemPrompt(type);
}

module.exports = {
  keyFor,
  draftKeyFor,
  defaultPromptForType,
  getTypePrompt,
  isCustom,
  saveTypePrompt,
  clearTypePrompt,
  getDraftPrompt,
  saveDraftPrompt,
  clearDraftPrompt,
  listCustomizedTypes,
  effectiveSystemPrompt,
};
