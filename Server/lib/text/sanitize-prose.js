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
  // Numeric ranges joined by a dash -> hyphen (e.g. "12–15" -> "12-15")
  s = s.replace(/(\d)[ \t]*[‒–—―−][ \t]*(\d)/g, '$1-$2');
  // Remaining em/en/figure/horizontal-bar/minus dashes used as separators -> comma
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

module.exports = { sanitizeProse };
