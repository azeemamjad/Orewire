'use strict';

/**
 * Shared helpers for the OreWire SEO / AEO / GEO layer.
 *
 * IMPORTANT — slug parity
 * -----------------------
 * `slugify()` here and `slugSql()` below MUST always produce the same string for
 * the same input. The JS side is used to build links and sitemap entries; the SQL
 * side is used to resolve an incoming `/company/<slug>` back to a row. If the two
 * ever disagree, every name based company URL 404s.
 *
 * Both deliberately do exactly one thing: lowercase, then collapse every run of
 * characters outside `[a-z0-9]` into a single `-`, then trim leading/trailing `-`.
 * No accent folding on either side, because PostgreSQL `lower()` plus a POSIX
 * bracket expression already turns `ó` into `-` exactly like the JS regex does.
 */

const DEFAULT_SITE_ORIGIN = 'https://www.orewire.com';

/** Canonical public origin, without a trailing slash. */
function siteOrigin() {
  const raw =
    process.env.SITE_ORIGIN ||
    process.env.PUBLIC_SITE_URL ||
    process.env.FRONTEND_URL ||
    DEFAULT_SITE_ORIGIN;
  return String(raw).trim().replace(/\/+$/, '');
}

/** Lowercase, collapse non alphanumerics to single dashes, trim dashes. */
function slugify(value) {
  return String(value == null ? '' : value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * SQL expression producing the same value as slugify() for a text column.
 *
 * The character class is written as a LITERAL LIST rather than the range `a-z`,
 * and that is load-bearing. In PostgreSQL a bracket *range* is interpreted using
 * the database collation, so under a UTF-8 locale `[^a-z0-9]` can treat `á` as
 * falling between `a` and `z` and therefore KEEP it in the slug. JavaScript's
 * `[a-z]` is always ASCII. The two would then disagree, and because the company
 * URL is built from the JS slug while the lookup uses this expression, that
 * company's page would 404 at its own canonical URL.
 *
 * Not hypothetical: production holds "Amapá Minerals Holdings Inc." (TSX:AMAP),
 * found via `GET /api/companies?search=á`. A literal list has no ordering, so
 * collation cannot widen it, and it matches the JS side by construction.
 *
 * `column` is interpolated, so only ever pass a trusted literal column name.
 */
function slugSql(column) {
  return `trim(both '-' from regexp_replace(lower(${column}), '[^abcdefghijklmnopqrstuvwxyz0123456789]+', '-', 'g'))`;
}

/** Absolute URL for a site relative path. Already absolute input passes through. */
function absoluteUrl(pathname) {
  if (!pathname) return siteOrigin() + '/';
  if (/^https?:\/\//i.test(pathname)) return pathname;
  return siteOrigin() + (pathname.startsWith('/') ? pathname : '/' + pathname);
}

/**
 * Canonical company URL. The company NAME is in the path on purpose: a searcher
 * types "Carson River Ventures Corp.", and a URL that repeats that phrase is a
 * small but free relevance signal. `/company/TSXV-CRV` still resolves, and is
 * redirected to this form by the SEO routes.
 */
function companyUrl(name) {
  const slug = slugify(name);
  return `/company/${slug || 'unknown'}`;
}

/** Legacy exchange + ticker slug, kept working for old shared links. */
function companyLegacySlug(exchange, ticker) {
  const ex = String(exchange || '').toUpperCase().replace(/-/g, '');
  const tk = String(ticker || '').toUpperCase();
  if (ex && tk) return `${ex}-${tk}`;
  return tk || '';
}

/** Company pages, matching the SPA route `/company/:slug`. */
function companyAbsoluteUrl(name) {
  return absoluteUrl(companyUrl(name));
}

/**
 * Canonical news URL: `/news/<title-slug>-<id>`.
 *
 * The old form was the URL-encoded external link, which is unusable as a
 * citation target and carries no keywords. The id suffix keeps the URL unique
 * when two outlets publish the same headline, and gives the resolver a cheap
 * primary key. Falls back gracefully when a row has no title or no id.
 */
function newsUrl(item) {
  if (!item) return '/news';
  const slug = slugify(item.title);
  const id = item.id != null && item.id !== '' ? String(item.id) : '';
  if (id && slug) return `/news/${slug}-${id}`;
  if (id) return `/news/${id}`;
  if (slug) return `/news/${slug}`;
  return item.link ? `/news/${encodeURIComponent(item.link)}` : '/news';
}

function filingUrl(id) {
  return `/filings/${id}`;
}

const HTML_ESCAPES = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

/** Escape a value for use in HTML text or a double quoted attribute. */
function escapeHtml(value) {
  if (value == null) return '';
  return String(value).replace(/[&<>"']/g, (ch) => HTML_ESCAPES[ch]);
}

/** Escape for an inline <script> JSON payload (prevents `</script>` breakout). */
function escapeJson(value) {
  return String(value)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}

/** Collapse whitespace and hard trim to `max` characters on a word boundary. */
function summarise(text, max = 155) {
  const clean = String(text == null ? '' : text)
    .replace(/\s+/g, ' ')
    .trim();
  if (clean.length <= max) return clean;
  const cut = clean.slice(0, max);
  const lastSpace = cut.lastIndexOf(' ');
  return (lastSpace > max * 0.6 ? cut.slice(0, lastSpace) : cut).replace(/[,;:.\-]$/, '') + '…';
}

/** Format a number as a compact human string (1.23B, 45.6M, 12.3K). */
function compactNumber(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n === 0) return null;
  const abs = Math.abs(n);
  if (abs >= 1e12) return (n / 1e12).toFixed(2) + 'T';
  if (abs >= 1e9) return (n / 1e9).toFixed(2) + 'B';
  if (abs >= 1e6) return (n / 1e6).toFixed(2) + 'M';
  if (abs >= 1e3) return (n / 1e3).toFixed(1) + 'K';
  return String(n);
}

/** ISO 8601 date, or null. Used for sitemap <lastmod>. */
function isoDate(value) {
  if (!value) return null;
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString();
}

/** YYYY-MM-DD for schema.org datePublished. */
function isoDay(value) {
  const iso = isoDate(value);
  return iso ? iso.slice(0, 10) : null;
}

/**
 * A news item counts as THIN when its summary is shorter than this.
 *
 * Verified against production: all six sampled `news_releases` rows had a
 * `summary` that was either a bare date ("Paris, October 1 st 2026, 2:00 p.m.")
 * or the title with the publisher's name appended. There are roughly **131,000**
 * such rows.
 *
 * Publishing them as indexable pages would put ~131,000 near-empty, largely
 * duplicate URLs in front of Google on a domain that has no authority yet. That
 * is the classic way a large site suppresses its own good pages, and it would
 * bury the ~2,400 company profiles this work exists to get indexed.
 *
 * The rule is a plain length test so that the SQL and the JS sides cannot drift:
 * `hasSubstantiveSummarySql()` and `hasSubstantiveSummary()` use the same number.
 */
const THIN_SUMMARY_CHARS = 200;

/** SQL predicate for "this news row carries a real summary". Alias `n`. */
function hasSubstantiveSummarySql(alias = 'n') {
  return `LENGTH(TRIM(COALESCE(NULLIF(${alias}.summary, ''), NULLIF(${alias}.description, ''), ''))) >= ${THIN_SUMMARY_CHARS}`;
}

/** The same test in JS, for the rendered page's robots directive. */
function hasSubstantiveSummary(item) {
  if (!item) return false;
  const text = String(item.summary || item.description || '').trim();
  return text.length >= THIN_SUMMARY_CHARS;
}

module.exports = {
  THIN_SUMMARY_CHARS,
  hasSubstantiveSummarySql,
  hasSubstantiveSummary,
  DEFAULT_SITE_ORIGIN,
  siteOrigin,
  slugify,
  slugSql,
  absoluteUrl,
  companyUrl,
  companyAbsoluteUrl,
  companyLegacySlug,
  newsUrl,
  filingUrl,
  escapeHtml,
  escapeJson,
  summarise,
  compactNumber,
  isoDate,
  isoDay,
};
