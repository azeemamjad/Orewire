/**
 * Normalize a person's name for company Management / Board rosters.
 *
 * Exchange listing data (TMX/CSE/ASX) often prefixes names with an honorific
 * ("Mr Mike Henry", "Ms Vandita Pant"). We store and display the bare name, so
 * strip a leading title before persisting.
 */
const HONORIFIC_RE = /^\s*(mr|mrs|ms|mx|dr|prof|professor|sir|miss|madam|hon)\.?\s+/i;

function stripHonorific(name) {
  if (typeof name !== 'string') return name;
  let out = name.trim();
  // Allow up to two passes for rare stacked titles (e.g. "Dr Prof ...").
  for (let i = 0; i < 2 && HONORIFIC_RE.test(out); i++) {
    out = out.replace(HONORIFIC_RE, '').trim();
  }
  // Never return an empty name (e.g. the source literally sent just "Mr").
  return out || name.trim();
}

module.exports = { stripHonorific, HONORIFIC_RE };
