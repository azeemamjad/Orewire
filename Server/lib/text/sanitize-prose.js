/**
 * Strip AI-tell punctuation from generated prose: smart quotes, ellipsis
 * characters and stray markdown emphasis. Em dashes used as a parenthetical
 * separator become commas; numeric ranges become hyphens.
 * Whitespace around dashes is limited to spaces/tabs so paragraph breaks survive.
 */
function sanitizeProse(text) {
  if (text == null) return text;
  let s = String(text);
  // Smart quotes -> straight quotes
  s = s.replace(/[‘’‚‛]/g, "'").replace(/[“”„‟]/g, '"');
  // Ellipsis -> three dots
  s = s.replace(/…/g, '...');
  // Ranges -> hyphen. Only two forms are treated as ranges, because collapsing a
  // SEPARATOR into a bare hyphen corrupts text: "A1AC26012 – 8m" would become
  // "A1AC26012-8m", which reads as a different drill hole.
  //   1. An unspaced dash after a number: "2021–2023", "2.1M–2.4M".
  s = s.replace(/(\d[A-Za-z]{0,3})[‒–—―−](\d)/g, '$1-$2');
  //   2. A spaced dash between two bare decimals: "5.1 – 5.6 Mlb". Decimals on
  //      both sides is a strong range signal; integers ("2026 – 31") are not.
  s = s.replace(/(?<![\w.])(\d+\.\d+)[ \t]*[‒–—―−][ \t]*(\d+\.\d+)(?![\w.])/g, '$1-$2');
  // Everything else is a separator -> comma
  s = s.replace(/[ \t]*[‒–—―−][ \t]*/g, ', ');
  // Strip markdown emphasis the model may emit despite instructions
  s = s.replace(/\*\*(.+?)\*\*/g, '$1').replace(/__(.+?)__/g, '$1');
  // Tidy artifacts left by the replacements
  s = s
    .replace(/[ \t]+,/g, ',')          // " ," -> ","
    .replace(/,[ \t]*,/g, ',')         // ",," -> ","
    .replace(/,[ \t]*([.!?;:])/g, '$1') // ", ." -> "."
    .replace(/[ \t]{2,}/g, ' ');       // collapse runs of spaces
  return s.trim();
}

/**
 * sanitizeProse applied to every string inside an arbitrary JSON value.
 * Used for structured columns (key_facts) where strings may be nested.
 */
function sanitizeDeep(value) {
  if (typeof value === 'string') return sanitizeProse(value);
  if (Array.isArray(value)) return value.map(sanitizeDeep);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, sanitizeDeep(v)]));
  }
  return value;
}

module.exports = { sanitizeProse, sanitizeDeep };
