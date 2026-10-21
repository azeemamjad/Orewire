/**
 * Company-name casing for public posts.
 *
 * Exchange databases store many names in ALL CAPS ("MATSA RESOURCES LIMITED").
 * That reads as shouting in a tweet, so post composers title-case names that
 * arrive fully uppercase — while leaving names with authored mixed casing
 * ("AngloGold Ashanti", "batteries Minerals"…) exactly as stored, since any
 * automatic recasing would mangle deliberate brands.
 *
 * Rules when the name IS all caps:
 *   - small connective words stay lowercase ("Resources of Australia" → of)
 *   - short vowel-less tokens keep their initialism form (BHP, FMG, NL, NQM)
 *   - tokens with digits or symbols are left untouched ("3D", "A1", "88E")
 *   - first word always capitalizes ("BHP" alone stays "BHP", not "bHP")
 */

const SMALL_WORDS = new Set([
  'of', 'and', 'the', 'in', 'on', 'at', 'to', 'a', 'an', 'or', 'for', 'by',
  'with', 'its', 'de', 'da', 'von', 'la', 'le', 'du',
]);

function titleCaseWord(word, isFirst) {
  // Tokens with digits/symbols (3D, 88E, A$, (ASX)) keep their stored form.
  if (!/^[A-Za-z][A-Za-z'.&-]*$/.test(word)) return word;
  const lower = word.toLowerCase();
  const lettersOnly = lower.replace(/[^a-z]/g, '');
  if (isFirst && SMALL_WORDS.has(lettersOnly)) return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
  if (!isFirst && SMALL_WORDS.has(lettersOnly)) return lettersOnly;
  // Likely initialisms: short vowel-less tokens (BHP, FMG, NL, NQM, SFR…).
  if (lettersOnly.length >= 2 && lettersOnly.length <= 4 && !/[aeiou]/.test(lettersOnly)) {
    return word.toUpperCase();
  }
  return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
}

function displayCompanyName(name) {
  const s = String(name || '').trim();
  if (!s) return s;
  const letters = s.replace(/[^A-Za-z]/g, '');
  if (!letters) return s;                                   // no letters → nothing to fix
  if (letters !== letters.toUpperCase()) return s;          // authored mixed case → keep
  return s.split(/\s+/).map((w, i) => titleCaseWord(w, i === 0)).join(' ');
}

module.exports = { displayCompanyName };
