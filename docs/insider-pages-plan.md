# Insider pages (`/insider/:slug`) — implementation spec

**Status:** not built. This document exists because the links to it already ship.

---

## 1. The problem being solved

`CompanyDetail.tsx` links names to `/insider/<slug>` in two places:

- every manager and director, in `PeopleSection` (line ~711)
- every insider transaction name, in the insider table (line ~1234)

But:

- no `/insider` page component exists anywhere in `frontend/src`
- `routes.tsx` declares no `/insider` path
- `path="*"` renders `NotFound`

So every one of those links lands on the 404 page — several dead internal links on
each of ~2,400 company pages. This is a **defect, not a missing feature**: the
product already tells crawlers and users that these pages exist.

Two ways to close it, and the choice is a product decision:

1. **Build the page** (this document). Real long-tail value: people do search
   executive names, and "person + companies" is exactly the entity shape answer
   engines resolve well.
2. **Unwrap the `<Link>`s** so names render as plain text. Removes the dead links in
   two small edits and adds no new surface.

Doing neither is the only wrong answer.

---

## 2. Data available

Both tables are keyed by `company_id` **and** `insider_name`, which is what makes
aggregation across companies possible.

```
insider_ownership      company_id, insider_name, title, total_shares,
                       percent_ownership, last_transaction, last_transaction_date

insider_transactions   company_id, insider_name, title, transaction_type, shares,
                       price, transaction_date, total_holdings_after
```

Join `companies` for the issuer name, exchange and ticker. Do **not** filter on
`archived_at IS NULL` only at the top level — an insider page listing a company the
site has hidden would link to a URL that 404s, which is the same mistake section
3.28 fixed for news.

---

## 3. The slug rule, and the two traps in it

`CompanyDetail.tsx` builds the slug like this:

```js
const stripHonorific = (name) =>
  name.replace(/^\s*(mr|mrs|ms|mx|dr|prof|professor|sir|miss|madam|hon)\.?\s+/i, "").trim() || name;

const insiderSlug = (name) =>
  name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");

// PeopleSection
const displayName = stripHonorific(p.name);
<Link to={`/insider/${insiderSlug(displayName)}`}>
```

**Trap 1 — the honorific is stripped before slugging.** `"Mr. Jeff Cocks"` produces
`jeff-cocks`, not `mr-jeff-cocks`. A resolver that slugs the raw `insider_name`
column will not match, and **every person link will 404** — the same failure mode,
and the same invisibility, as section 3.41's accented company name. Whatever
resolves the slug must apply the identical strip, on both sides of the comparison.
Note that `db/migrate.js` already strips honorifics from `company_people` at
startup, but nothing guarantees it for `insider_ownership` / `insider_transactions`.

**Trap 2 — JS and SQL must produce identical slugs.** This is section 3.41 again. If
the lookup uses `regexp_replace(lower(name), '[^a-z0-9]+', '-', 'g')`, PostgreSQL
interprets that **range** by collation and may keep an accented letter JavaScript
strips. Use the same literal character class `slugSql()` uses:

```sql
trim(both '-' from regexp_replace(lower(<expr>), '[^abcdefghijklmnopqrstuvwxyz0123456789]+', '-', 'g'))
```

**Recommendation: add a `slug` column instead of computing it.** Two reasons beyond
these traps: a stored slug makes a person's URL stable if their recorded name is
later corrected, and it removes the JS/SQL parity question entirely. Populate it at
write time from the same function the SPA uses, and reject an empty or purely
numeric slug there — section 3.30 already flags that `/company/<digits>` collides
with numeric primary-key resolution, and `/insider/<digits>` would inherit it.

---

## 4. What the page should render

A person page is an aggregation, so it needs the "no rows" case handled explicitly:

- **Heading**: the person's name (honorific stripped).
- **Roles**: distinct `title` values with the issuer they belong to.
- **Companies**: each issuer as a link to `/company/<name-slug>` — real internal
  links, which is the main SEO benefit.
- **Ownership**: rows from `insider_ownership`, with a visible "as reported" caveat.
- **Transactions**: rows from `insider_transactions`, most recent first, capped —
  the crawler must show exactly the rows the SPA shows, no more and no fewer.
- **Source line**: SEDI insider reports, mirroring the wording already used on the
  company page ("Source: SEDI insider reports · last 90 days").

**Thin-page risk.** A person with a single ownership row and no transactions is a
thin page, and there may be many of them. Apply the section 3.20 rule: gate
indexing on substance, and run `SELECT COUNT(*) FROM (SELECT insider_name FROM
insider_ownership UNION SELECT insider_name FROM insider_transactions) x;` before
adding anything to a sitemap. If the count is large, index only people with two or
more companies or at least one transaction.

---

## 5. Work required

| # | piece | file | notes |
|---|---|---|---|
| 1 | slug column + backfill | `Server/db/migrate.js` | `ADD COLUMN IF NOT EXISTS`, backfilled with the literal character class |
| 2 | person lookup | `Server/lib/seo/data.js` | `findPersonBySlug`, `getPersonProfile`; aggregate by slug, not name |
| 3 | public API | `Server/routes/api/` | `GET /api/insiders/:slug` for the SPA |
| 4 | SPA page | `frontend/src/features/people/pages/InsiderDetail.tsx` | `useSeo` with a canonical built from the stored slug |
| 5 | SPA route | `frontend/src/app/routes.tsx` | `/insider/:slug`, above the `*` catch-all |
| 6 | crawler renderer | `Server/lib/seo/pages.js` | `renderInsiderPage`, same sections as #4 |
| 7 | crawler route | `Server/routes/seo.js` | `/insider/:slug` |
| 8 | nginx proxy | `frontend/nginx.conf` | add `insider` to the crawler content regex, and to the loop in `scripts/check-seo.js` that cross-checks proxy paths against routes |
| 9 | sitemap | `Server/lib/seo/sitemaps.js` | only if #4's thin-page gate passes |

Steps 6–8 are **not optional**. Without them the page is JavaScript-only, which is
exactly what the AI crawlers this work targets do not execute — the reasoning
already recorded in section 3.37.

---

## 6. Constraints that apply, from the existing rules

- **Parity.** The crawler page must show what the SPA shows, in both directions
  (§3.15, §3.17). The section list and headings should be lifted from the SPA
  component, not invented — §3.37 and §3.39 both exist because I got that wrong
  once.
- **Canonical.** One URL per person, built from the stored slug, and the SPA and
  crawler must emit byte-identical canonicals (§3.33 shows how easily that breaks:
  `URLSearchParams` encodes a space as `+`, `encodeURIComponent` as `%20`).
- **No external calls** in the crawler render path.
- **`robots.txt`** already allows all of this; no change needed. Note that any new
  named `user-agent` group would need the Disallows repeated inside it (§3.43).

---

## 7. Open questions for the owner

1. **Is a person page wanted at all?** Option 2 in section 1 is a legitimate answer
   and much cheaper.
2. **Is SEDI insider data appropriate to publish as a standalone profile?** It is
   public and already rendered on the company page, but a person-centric page is a
   different presentation.
3. **Slug collisions.** A slug identifies a *name*, not a person. Two different
   people with the same name share one page, and "J. Smith" / "John Smith" are
   different slugs. Acceptable if stated on the page; not acceptable silently.
