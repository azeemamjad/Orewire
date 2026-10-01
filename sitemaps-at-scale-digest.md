# Sitemaps at Scale — Technical Digest (2026)

## 1. Hard limits: the numbers

**Per sitemap file:** max **50,000 URLs** and max **50MB = 52,428,800 bytes**, measured **uncompressed**. The [sitemaps.org protocol](https://www.sitemaps.org/protocol.html) is explicit: *"If you would like, you may compress your Sitemap files using gzip to reduce your bandwidth requirement; however the sitemap file once uncompressed must be no larger than 50MB."* So **50MB applies before compression** — gzip buys bandwidth, not extra URL capacity. `<loc>` values must be **under 2,048 characters**.

**Per sitemap index file:** max **50,000 `<sitemap>` entries**, max **50MB**. The index file's own size limit is independent; *"A Sitemap index file can only specify Sitemaps that are found on the same site as the Sitemap index file."* You can have more than one index file.

**Nesting:** sitemap-in-sitemap file is **not supported**; sitemap-in-index is fine; **index-in-index is not supported**. Google's John Mueller, [13 Aug 2017](https://www.marketingminer.com/en/blog/5-interesting-facts-google-has-recently-confirmed-about-sitemaps.html): *"We support sitemap index files, but not nested sitemap files (sitemap in sitemap index is OK, sitemap in sitemap not)"* and [28 Jun 2017](https://www.marketingminer.com/en/blog/5-interesting-facts-google-has-recently-confirmed-about-sitemaps.html): *"Off-hand, it looks like you have sitemap index files in sitemap index files, which isn't supported."* **Max index depth = 1** (root index → leaf sitemaps).

**Does the index count against limits?** No. The index is a separate file with its own 50,000-entry / 50MB budget; its children each get their own 50,000/50MB. Bing's [31 Jul 2025 blog](https://blogs.bing.com/webmaster/July-2025/Keeping-Content-Discoverable-with-Sitemaps-in-AI-Powered-Search) states the arithmetic: 50,000 URLs/file × 50,000 children = **2.5 billion URLs per index file**, and *"multiple index files can support up to 2.5 trillion URLs across a domain."*

**The 10MB→50MB change is dated.** Bing's Fabrice Canel, [30 Nov 2016](https://blogs.bing.com/webmaster/2016/11/Increasing-the-size-limit-of-Sitemaps-file-to-addr/): *"we are increasing sitemaps file and index size from 10 MB to 50MB (52,428,800 bytes)… each sitemap file once uncompressed must still be no larger than 50MB. This update only impacts the file size; each sitemap file and index file still cannot exceed the maximum of 50,000 URLs."* Any source still quoting 10MB is pre-2016.

**Supported formats:** XML (required by Google for extensions), plus RSS 2.0 / Atom 1.0 feeds and plain UTF-8 **text files** (one URL per line, same 50,000/50MB limits). Google's docs and sitemaps.org both list these; RSS/Atom only expose recent URLs. Bing's 2025 post: *"XML remains the preferred format for sitemaps, as it supports structured metadata like lastmod."*

**Google's ping endpoint is dead.** Google deprecated `POST /ping?sitemap=` in June 2023 ([Google Search Central blog, "Sitemaps ping endpoint is going away"](https://developers.google.com/search/blog/2023/06/sitemaps-lastmod-ping)). The sitemaps.org page still documents `/ping` — **stale**; do not build on it. Discovery is now **robots.txt + Search Console/Bing Webmaster Tools submission only**.

## 2. lastmod, priority, changefreq

**Google uses `<lastmod>` conditionally.** Official wording ([Google Search Central, Build and submit a sitemap](https://developers.google.com/search/docs/crawling-indexing/sitemaps/build-sitemap), quoted and linked by [Yoast, 18 Jun 2024](https://yoast.com/lastmod-xml-sitemaps-google-bing/)): *"Google uses the `<lastmod>` value if it's consistently and verifiably (for example, by comparing to the last modification of the page) accurate."* And: *"The value should reflect the date and time of the last significant update to the page. For example, an update to the main content, the structured data, or links on the page is generally considered significant, however an update to the copyright date is not."*

Trust is **binary**. Gary Illyes, LinkedIn, 11 Jun 2024: *"it's binary, or at least was last time I checked. we either trust it or not."* Restated on **16 Jul 2026** (Bluesky, reported by [Search Engine Roundtable](https://www.seroundtable.com/) and summarized by [Digital Applied, 18 Jul 2026](https://www.digitalapplied.com/blog/xml-sitemap-lastmod-hygiene-illyes-directive-seo-2026)): sites emitting wrong dates are *"probably better off without the lastmods. at least you save a few bytes."* **Practitioner takeaway: if your timestamps aren't truthful, omit the tag.**

**Formats:** W3C Datetime. Both `YYYY-MM-DD` and full ISO 8601 with offset work — `2026-01-23T18:23:17+00:00`. Bing's July 2025 post explicitly asks for **date *and* time** in ISO 8601: *"use standard ISO 8601 date formatting for lastmod values, including both the date and time… Including a timestamp provides a more precise signal."* Always emit UTC (`+00:00` or `Z`).

**index-level `<lastmod>` means something different:** the modification time of **the child sitemap file**, not the pages inside it. Copying page-level logic into the index is a classic silent lie.

**`<priority>` and `<changefreq>` are ignored by both engines.** Bing, July 2025: *"Optional sitemap tags like changefreq and priority are ignored by Bing and do not influence how your content is crawled or ranked."* Bing, Feb 2023: *"Bing largely disregards these fields."* Google: Mueller, 17 Aug 2017, *"We ignore priority in sitemaps."* Google's current docs list only `<loc>` and `<lastmod>` as meaningful. **Omit both tags** — they are pure bytes.

**Bing's own data** ([Bing, 1 Feb 2023](https://blogs.bing.com/webmaster/february-2023/The-Importance-of-Setting-the-lastmod-Tag-in-Your-Sitemap)): of hosts with ≥1 indexed URL, 58% have a known XML sitemap; 84% of those set lastmod; **79% correct, 18% incorrect, 3% partial**; 42% of hosts have no known sitemap. Most common failure = identical dates across all URLs, i.e. build-time stamping. Bing: *"if we observe that the dates are consistently set to the current date, we will suspect the validity of those dates and may disregard them."* Bing also **revamped its crawl scheduler** to consume lastmod, rolled out by June 2023.

## 3. Crawl budget at millions of URLs

Google's [Optimize your crawl budget](https://developers.google.com/crawling/docs/crawl-budget) (last updated 2026-07-22) defines crawl budget = **crawl capacity limit** (`hostload`, per hostname) × **crawl demand** (perceived inventory, popularity, staleness). Relevant advice verbatim: *"Keep your sitemaps up to date. Google reads your sitemap regularly… If your site includes updated content, we recommend including the `<lastmod>` tag."* Explicit warning: **do not use `noindex` for URL-inventory control** (Google still fetches then drops, wasting crawl), and **do not use robots.txt to "reallocate" crawl budget** — *"Google won't shift this newly available crawl budget to other pages unless Google is already hitting your site's crawl capacity limit."* Use 404/410 for removals; blocked URLs stay queued longer.

**Practical read:** Google does not publish a "max sitemaps fetched" number. The [50,000/50MB](#1-hard-limits-the-numbers) protocol caps are the only *documented* limits. The frequently-cited **"500 sitemaps per index in Search Console"** figure surfaced in [Google Search Central Community threads](https://support.google.com/webmasters/thread/107819775/is-it-true-that-google-limit-for-xml-sitemap-is-500-sitemaps-only?hl=en) — **treat as unconfirmed**; the spec says 50,000. For OreWire (thousands, not millions, of URLs) this is moot; keep the index under ~50 children for operational sanity.

## 4. Sitemaps and AI search

Bing's [July 2025 post](https://blogs.bing.com/webmaster/July-2025/Keeping-Content-Discoverable-with-Sitemaps-in-AI-Powered-Search) (Fabrice Canel + Krishna Madhavan, both "Principal Product Manager, Microsoft AI") is the strongest primary signal: freshness from `lastmod` *"directly influence[s] how quickly updates are reflected in search results and AI generated answers"*, helping Bing *"prioritize URLs for recrawling and reindexing, or skip them entirely if the content hasn't changed."* Bing fetches a newly submitted sitemap **immediately**, then *"typically at least once per day."* Verdict: **AI search accelerates the value of accurate sitemaps; it does not change the sitemap spec.** Note the post's own hedge: *"no tool can guarantee when or how your content will appear in AI-generated results."*

**OpenAI** documents crawlers at [developers.openai.com/api/docs/bots](https://developers.openai.com/api/docs/bots) — `GPTBot` (training), `OAI-SearchBot` (ChatGPT search; opting out removes you from ChatGPT search answers), `ChatGPT-User` (user-triggered; *"robots.txt rules may not apply"*), `OAI-AdsBot`. The docs discuss **robots.txt and IP ranges extensively but never mention sitemaps** — so GPTBot's sitemap consumption is **unconfirmed**. Allow `OAI-SearchBot` if you want ChatGPT citations.

**`llms.txt`: proposed, not consumed by any major engine.** The [spec, v2](https://llmstxt.org/) (Jeremy Howard, published 2024-09-03, **modified 2026-08-10**) is self-described as *"A proposal"*. It explicitly positions itself as *not* a sitemap replacement: sitemap.xml is *"a list of all the indexable human-readable information"*, whereas llms.txt is a curated overview. Real adoption signals are limited to doc platforms (Mintlify, GitBook, Yoast, AIOSEO, Wix), a [Chrome Lighthouse agentic-browsing audit](https://developer.chrome.com/docs/lighthouse/agentic-browsing/llms-txt), and the labs' own doc sites. **No OpenAI/Anthropic/Google/Bing statement that their crawlers fetch `/llms.txt` exists.** Ship it if cheap; do not count on it.

## 5. News sitemaps (mining/finance journalism)

Requirements: a **separate** sitemap using `xmlns:news="http://www.google.com/schemas/sitemap-news/0.9"`, containing **only articles from the last 48 hours**, capped at **1,000 `<url>` entries** ([Google News sitemap docs](https://developers.google.com/search/docs/crawling-indexing/sitemaps/news-sitemap); the 2-day/1,000 rules are echoed by [SEOPress](https://www.seopress.org/support/guides/enable-google-news-xml-sitemap/) and [practitioner walkthroughs](https://ujjwalganesh.com/blog/google-news-sitemap-xml-for-wordpress/)). Required children: `<news:publication>` (`<news:name>`, `<news:language>` as ISO 639-1), `<news:publication_date>` (W3C Datetime, must be the **original publication** datetime), `<news:title>`. `<news:name>` must match your Google News Publisher Center name. Keep a **standard** sitemap for evergreen company/financial pages alongside it.

```xml
<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"
        xmlns:news="http://www.google.com/schemas/sitemap-news/0.9">
  <url>
    <loc>https://orewire.com/news/carson-river-ventures-drill-results</loc>
    <news:news>
      <news:publication>
        <news:name>OreWire</news:name>
        <news:language>en</news:language>
      </news:publication>
      <news:publication_date>2026-09-14T08:30:00+00:00</news:publication_date>
      <news:title>Carson River Ventures Reports Drill Results</news:title>
    </news:news>
  </url>
</urlset>
```

## 6. IndexNow and robots.txt

**Google does not support IndexNow.** Confirmed by absence: Google's [Ask Google to recrawl](https://developers.google.com/search/docs/crawling-indexing/ask-google-to-recrawl) lists only Search Console URL Inspection and sitemaps; Google's Indexing API is [restricted to JobPosting and BroadcastEvent](https://developers.google.com/search/apis/indexing-api/v3/quickstart). Mueller's Oct 2021 reaction to launch: *"we too, would like to be crawled less often"* ([PPC Land](https://ppc.land/googles-absence-from-indexnow-raises-questions-about-web-indexing-standards/)). Treat any "Google joined IndexNow" claim as **false**.

Participating engines per the [IndexNow spec's SE-to-SE document](https://www.indexnow.org/searchengines): **Microsoft Bing, Yandex, Seznam, Naver** (authors: Internet Archive, Seznam, Yandex, Microsoft; doc dated March 2024). This has not changed.

Protocol facts ([indexnow.org/documentation](https://www.indexnow.org/documentation)):
- Single URL: `GET https://<engine>/indexnow?url=<escaped>&key=<key>`
- Batch: `POST /indexnow`, `Content-Type: application/json; charset=utf-8`, body `{"host","key","keyLocation","urlList":[...]}`, **up to 10,000 URLs per POST**
- Key: **8–128 hexadecimal chars**, `[a-zA-Z0-9-]`; key file `https://orewire.com/<key>.txt` at root (or anywhere with `keyLocation`)
- Responses: `200` OK, `202` key validation pending, `400` bad format, `403` key invalid, `422` URL/key mismatch, `429` too many requests
- Endpoints: `https://api.indexnow.org/indexnow` is the shared/virtual endpoint; Bing is `https://www.bing.com/indexnow`
- **URLs submitted to one engine are propagated to all others** (within ~10s of verification) — submit once.

**robots.txt `Sitemap:` directive** — protocol-official: *"This directive is independent of the user-agent line, so it doesn't matter where you place it in your file."* Point to the **index only**; you do not need to list children. Multiple `Sitemap:` lines are allowed. For OreWire, put it at the very top, outside any `User-agent` group.

```
# https://orewire.com/robots.txt
Sitemap: https://orewire.com/sitemap.xml
User-agent: *
Allow: /
Disallow: /api/
Disallow: /search?
User-agent: OAI-SearchBot
Allow: /
```

## 7. Concrete plan for OreWire (React/Vite SPA + nginx + Express + PostgreSQL)

**Critical first:** a client-rendered Vite SPA serves one identical HTML shell for every route. Google renders JS, but Bing and AI crawlers largely do not. Prerender company/news routes server-side (or SSR/SSG them) **before** investing in sitemap sharding — a perfect sitemap pointing at an empty shell is worthless.

**Split by content type** (this is the actionable index shape):

```xml
<?xml version="1.0" encoding="UTF-8"?>
<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <sitemap>
    <loc>https://orewire.com/sitemap-companies-1.xml</loc>
    <lastmod>2026-09-14T08:30:00+00:00</lastmod>
  </sitemap>
  <sitemap>
    <loc>https://orewire.com/sitemap-news-1.xml</loc>
    <lastmod>2026-09-14T08:30:00+00:00</lastmod>
  </sitemap>
  <sitemap>
    <loc>https://orewire.com/sitemap-static.xml</loc>
    <lastmod>2026-09-14T08:30:00+00:00</lastmod>
  </sitemap>
</sitemapindex>
```

**PostgreSQL at scale.** Never `SELECT *` into a JS string — use a server-side cursor / streaming and paginate in 50,000-row chunks. Keyset pagination beats `OFFSET`:

```sql
-- companies: keyset pagination, per-shard lastmod
SELECT id, slug, updated_at AT TIME ZONE 'UTC' AS lastmod
FROM companies
WHERE is_published = true AND id > $1
ORDER BY id
LIMIT 50000;
```

Derive each shard's index `<lastmod>` from the shard itself:

```sql
SELECT max(updated_at) FROM companies WHERE is_published = true;
```

**Do not** put `updated_at` on the table if it's bumped by unrelated writes. Add a dedicated column and only touch it on significant change:

```sql
ALTER TABLE companies ADD COLUMN content_updated_at timestamptz;
-- trigger: only when content-bearing columns actually changed
CREATE OR REPLACE FUNCTION bump_content_updated_at() RETURNS trigger AS $$
BEGIN
  IF NEW.description IS DISTINCT FROM OLD.description
     OR NEW.assets IS DISTINCT FROM OLD.assets
     OR NEW.status IS DISTINCT FROM OLD.status THEN
    NEW.content_updated_at := now();
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
```

**Express route** with strong caching and correct headers:

```js
// GET /sitemap-:type-:page.xml
app.get('/sitemap-:type(companies|news|static)-:page(\\d+).xml', async (req, res) => {
  const { type, page } = req.params;
  const rows = await getSitemapChunk(type, Number(page), 50000); // prepared stmt, keyset
  res.type('application/xml');
  res.set('Cache-Control', 'public, max-age=3600, s-maxage=86400');
  res.send(renderUrlset(rows, req.query.news === '1'));
});
```

Stream or string-concatenate with an XML escaper for `&`→`&amp;` — company names like *"Carson River Ventures Corp."* are safe, but mining-company names with `&` are not.

**nginx:** serve `/sitemap*.xml` from a cache or directly from Express (`proxy_pass`), set `gzip on; gzip_types application/xml;` — but remember the **50MB limit is post-decompression**. Exclude news sitemaps from long CDN TTLs (48h window means stale = wrong). Add `Content-Type: application/xml; charset=UTF-8`. Do not let the SPA fallback (`try_files ... /index.html`) swallow `/sitemap.xml` — route those paths to Express explicitly and verify with `curl -I`.

**Submit:** robots.txt → `sitemap.xml` index; Search Console + Bing Webmaster Tools; then **IndexNow on every publish/update** (Bing/Yandex/Seznam/Naver). Google still needs sitemap + URL Inspection.

```bash
curl -X POST "https://api.indexnow.org/indexnow" \
  -H "Content-Type: application/json; charset=utf-8" \
  -d '{"host":"orewire.com","key":"YOURKEY","keyLocation":"https://orewire.com/YOURKEY.txt",
       "urlList":["https://orewire.com/news/carson-river-ventures-drill-results"]}'
```

---

## Deprecated / changed (date-stamped)

| Date | Change |
|---|---|
| **30 Nov 2016** | Sitemap file/index size limit raised **10MB → 50MB** (52,428,800 bytes), uncompressed; 50,000-URL cap unchanged. Bing/Google joint. |
| **~2015 → 2017** | Google went from largely ignoring `lastmod` (2015) to using it when proven reliable (2017). |
| **11 Jun 2024** | Illyes confirms lastmod trust is **binary** (LinkedIn). |
| **Jun 2023** | Google **deprecated the sitemaps ping endpoint** (`/ping?sitemap=`). Discovery now robots.txt + Search Console only. |
| **1 Feb 2023** | Bing revamped crawl scheduling to consume `lastmod`; full rollout by June 2023. Bing confirms it *"largely disregards"* `changefreq`/`priority`. |
| **31 Jul 2025** | Bing reaffirms `changefreq`/`priority` **ignored**, demands ISO 8601 date+time `lastmod`, publishes 50k×50k=2.5B / 2.5T index math. |
| **10 Aug 2026** | `llms.txt` **v2** published (still a proposal; still not consumed by major engines). |
| **16 Jul 2026** | Illyes: inaccurate lastmod sites are *"probably better off without the lastmods."* |
| **2026-07-22** | Google crawl-budget doc last updated; recommends `<lastmod>` in sitemaps. |

## Uncertainties

1. **"Google fetches max 500 sitemaps per index"** — surfaced only in Search Central Community threads; spec says 50,000. Unverified.
2. **IndexNow's full engine list.** indexnow.org names Bing/Yandex/Seznam/Naver; I could not resolve `searchengines.json` to confirm no fifth engine. Recent traffic claims (60M sites / 1.4B URLs daily) come from a secondary aggregator, not a primary stat.
3. **Whether any AI crawler fetches sitemaps.** OpenAI's docs never mention sitemaps; no primary statement exists for GPTBot/OAI-SearchBot, ClaudeBot, or PerplexityBot consuming `sitemap.xml`. The Bing July 2025 post is the only vendor statement tying sitemaps to AI answers.
4. **`llms.txt` consumption is unproven.** The spec says "a proposal"; adoption evidence is tooling and Lighthouse, not crawler behaviour.
5. **Google's exact `<lastmod>` verification mechanism** is undocumented. The claim that Google stores a per-URL "last significant update" is inferred from the 2024 Search API leak, not confirmed.
6. **Google's sitemap doc body** could not be fully retrieved (navigation menu truncates both mirrors and locale variants). The `lastmod` wording is quoted verbatim via [Yoast](https://yoast.com/lastmod-xml-sitemaps-google-bing/), which links the official anchor `#additional-notes-about-xml-sitemaps`; I did not read the paragraph in the primary page context.
7. **Whether Bing separately supports Google-format news sitemaps** is unresolved; no Bing news-sitemap documentation was found.
