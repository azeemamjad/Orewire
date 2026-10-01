'use strict';

/**
 * Repair text that was decoded as Latin-1 when the source was UTF-8.
 *
 * The exchange profile feeds hand back strings such as
 * "RegiÃ³n Metropolitana de Santiago" where the issuer's data says "Región":
 * the UTF-8 bytes `C3 B3` were each read as a Latin-1 character. The corrupted
 * value lands in `companies.headquarters` and is rendered in the facts table of
 * the company page, so the crawler publishes a misspelled place name — and so
 * does the SPA, because both read the same stored column.
 *
 * Observed in production on Aclara Resources Inc. (TSX:ARA, id 2), whose
 * `headquarters` reads "…Office 901 9th Floor, RegiÃ³n Metropolitana de
 * Santiago, Santiago, CL". Feeding `?search=Ã` to the companies API returns no
 * matches, so no company *name* is affected and no URL is at risk.
 *
 * Repairing here, at the write point, rather than in the SEO renderer is
 * deliberate: the stored value is wrong for every consumer, and correcting it in
 * the renderer alone would make the crawler page disagree with the SPA about the
 * same fact.
 *
 * The rewrite is guarded three ways, because silently altering stored text is
 * only acceptable when it is provably safe:
 *
 *   1. The mojibake signature must be present — a `Â` or `Ã` immediately followed
 *      by a continuation character. Correctly encoded text effectively never
 *      contains that pair.
 *   2. Every character must be Latin-1 representable. If the string also holds
 *      genuine non-Latin text, `latin1` re-encoding would destroy it, so the
 *      string is left untouched.
 *   3. The re-decode must not produce U+FFFD. If it does, the guess was wrong.
 *
 * Failing any guard returns the input unchanged, so the worst case is the status
 * quo rather than new corruption.
 */
function repairMojibake(value) {
  if (typeof value !== 'string' || value === '') return value;

  // 1. Signature: a Latin-1 lead byte followed by a continuation byte.
  if (!/[\u00c2\u00c3][\u0080-\u00bf]/.test(value)) return value;

  // 2. Latin-1 only, or the re-encode would mangle real text.
  for (const ch of value) {
    if (ch.codePointAt(0) > 0xff) return value;
  }

  // 3. Accept the repair only if it decoded cleanly.
  const repaired = Buffer.from(value, 'latin1').toString('utf8');
  if (repaired.includes('\ufffd')) return value;

  return repaired;
}

module.exports = { repairMojibake };
