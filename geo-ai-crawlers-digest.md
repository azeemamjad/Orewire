# GEO, AI Crawlers & robots.txt Policy — Technical Digest (OreWire)

## 1. The citation evidence base: what is actually proven

**(a) The Princeton GEO paper — the 9 tactics.** Aggarwal et al., *GEO: Generative Engine Optimization*, [arXiv:2311.09735](https://arxiv.org/abs/2311.09735) (submitted 16 Nov 2023; v3 28 Jun 2024; accepted **ACM KDD 2024**, DOI 10.1145/3637528.3671900). Setup: GEO-bench, **10,000 queries**, 25 domains, 8K/1K/1K split; engine = Google **top 5** results as context + gpt-3.5-turbo, 5 samples at temp 0.7. The nine methods: **Authoritative, Statistics Addition, Keyword Stuffing, Cite Sources, Quotation Addition, Easy-to-Understand, Fluency Optimization, Unique Words, Technical Terms**.

Headline: **"up to 40%"** visibility boost; **up to 37% on live Perplexity.ai**. The paper's own text: *"including citations, quotations from relevant sources, and statistics can significantly boost source visibility, with an increase of over 40%."* The abstract only says "up to 40%" — **the 9 tactics do not each have a clean published percentage in the abstract**, and the per-tactic table (Table 2) is the part almost nobody quotes. From a detailed secondary breakdown of that table ([Finseo, Aug 2026](https://www.finseo.ai/blog/geo-techniques-tested), which cites Table 2): best methods improved Position-Adjusted Word Count up to **41%**, Subjective Impression up to **28%**; Cite Sources / Quotation Addition / Statistics Addition gave **30–40%** relative gains; Fluency and Easy-to-Understand **15–30% but inconsistent**; **Authoritative tone showed no significant improvement**; **Keyword Stuffing was below baseline**. The deployed Perplexity test: Quotation Addition ≈ **+22%** position-adjusted / **+30%** impression; Statistics Addition ≈ **+9% / +37%**.

**The critical caveat — it's a redistribution effect, not a promise.** Table 2, optimising *all* source pages at once: adding citations gave **+115.1% at Google rank 5** but **−30.3% at rank 1**; Quotation Addition ≈ +98%/−23%; Statistics Addition ≈ +100%/−21%. **If you already rank #1, the same edit can cost you citations.** Combination test (200 examples): best pair beat best single technique by only **5.5%**.

**(b) Follow-ups and replications.**
- **Chen, Wang, Chen, Koudas (U. Toronto), *GEO: How to Dominate AI Search*, [arXiv:2509.08919](https://arxiv.org/abs/2509.08919)** (10 Sep 2025). Finding: AI Search shows **"a systematic and overwhelming bias towards Earned media (third-party, authoritative sources) over Brand-owned and Social content"**, unlike Google's more balanced mix. Engines differ in domain diversity, **freshness**, cross-language stability and **sensitivity to phrasing**. Agenda: engineer for machine scannability/justification, dominate earned media, be engine- and language-specific, overcome "big brand bias". It explicitly states **"no published studies"** existed on whether classic SEO transfers, and labels parts of its own landscape framing "at best speculation".
- **Contesting evidence:** **FeatGEO** (arXiv 2026, per Finseo) found Princeton-style token edits did **not** consistently beat baseline (GPT-4o-mini baseline 13.34% vs methods 10.92–12.21%; Gemini baseline 8.89% vs 4.62–5.62%). **AgentGEO** (arXiv 2026): failure taxonomy — **62.2% semantic alignment**, 27.1% content quality, 10.1% technical integrity, 0.6% systemic exclusion; >40% relative citation lift changing ~5% of content. **GEO-SFE** (arXiv 2026): 200 articles, 377 queries, 6 engines; citation rate **45.0% → 52.8%** (p<.001, d=0.64); **macro structure = 44.9%** of structural gain. **Competitive GEO** (Sprinklr, ACM SIGIR 2026, 252,000 pairwise trials): significant across all systems — **topic match, explicit price, recent timestamp, position one**; **structured vs dense formatting was weak/inconsistent (OR 0.78–1.68)**. That directly undercuts "tables and lists win".

**(c) Industry studies — which sources AI engines cite.**
- **[Profound](https://www.tryprofound.com/blog/enhanced-citation-categories)** (8 Jan 2026), **27 million citations** across ChatGPT, Gemini, AI Overviews, AI Mode, Perplexity, Claude, Copilot: brand-owned citations are only **54–73%**; the rest is third-party. By platform — ChatGPT Brand 54% / Media 25% / Institution 15% / Social 5%; Gemini 73/18/6/2; AIO 69/17/7/7; **Perplexity 57/19/5/19**; Claude 66/24/7/3; Copilot 59/33/6/3. **Owned content = only 4.3% of citations on category prompts** (but those URLs sit in the top 5% of cited domains). Financial Services vertical: **61% Brand / 27% Media / 8% Institution / 3% Social** — i.e. for a mining/finance site, media and third-party corroboration carry ~39% of the citation surface.
- **Profound, 30 Sep 2026:** median AI citation **half-life is 11 days** across 883,000 pages, seven engines.
- **Pew Research (22 Jul 2025):** AI summaries appeared on **~18%** of observed Google searches; link clicks fell to **8% with** a summary vs **15% without**; only ~**1%** of clicks were inside the AI box; **~26%** of such searches ended with no click. ([Pew](https://www.pewresearch.org/short-reads/2025/07/22/google-users-are-less-likely-to-click-on-links-when-an-ai-summary-appears-in-the-results/))
- **[Ahrefs](https://ahrefs.com/blog/ai-overview-citations-top-10/): 38% of AI Overview citations come from top-10 Google results** (2026 update). Corroborated by AirOps 2026 (15,000 prompts, 548,534 retrieved pages): position-one pages were cited **3.5× more often**; **43.2%** of position-one pages got cited; only **15% of retrieved pages made it into the answer**.

**What correlates with citation, ranked honestly:** (1) **Answering the exact question, in the first third of the page** (AgentGEO 62.2%; Kevin Indig: 44.2% of citations from the first 30%) — strong. (2) **Title/query overlap** (AirOps 20.1% vs 9.3% citation rate; Ahrefs title similarity 0.602 vs 0.484) — strong. (3) **Freshness/dates** (Sprinklr recency OR 14.4 to >10,000) — strong. (4) **Specificity: prices, specs, named entities** (Growth Memo: cited text carried **20.6% proper nouns** vs ~5–8% in ordinary English; Flesch-Kincaid grade **16 vs 19.1**) — strong. (5) **Statistics + quotations + cited sources** — moderate and **rank-dependent**. (6) **Macro document structure** — moderate (44.9% of GEO-SFE gain). (7) **Schema/JSON-LD** — correlated with cited pages but **no measured causal lift** in the strongest test. (8) **Keyword stuffing, jargon, "authoritative tone"** — **do not** (at or below baseline). Fresh, dated, entity-explicit, answer-first content beats decoration.

---

## 2. AI crawler reference — operator, token, purpose, robots.txt

Legend: **T** = model training · **S** = search index / automated retrieval for an AI answer product · **U** = user-triggered live fetch.

| Token (robots.txt) | Operator | Type | Honours robots.txt | Official doc |
|---|---|---|---|---|
| `GPTBot` | OpenAI | **T** | Yes | [OpenAI crawlers](https://developers.openai.com/api/docs/bots) |
| `OAI-SearchBot` | OpenAI | **S** | Yes | same |
| `ChatGPT-User` | OpenAI | **U** | *"robots.txt rules may not apply"* | same |
| `OAI-AdsBot` | OpenAI | Ads landing-page validation, **not** training | Yes | same |
| `PerplexityBot` | Perplexity | **S** (retrieval index; *"not used to crawl content to train AI foundation models"*) | Yes (claimed) | [Perplexity crawlers](https://docs.perplexity.ai/docs/resources/perplexity-crawlers) |
| `Perplexity-User` | Perplexity | **U** | Contested (see below) | same |
| `ClaudeBot` | Anthropic | **T** | Yes | [Anthropic](https://support.claude.com/en/articles/8896518-does-anthropic-crawl-data-from-the-web-and-how-can-site-owners-block-the-crawler) (updated **7 Apr 2026**) |
| `Claude-User` | Anthropic | **U** | Yes | same |
| `Claude-SearchBot` | Anthropic | **S** | Yes | same |
| `anthropic-ai` | Anthropic | **legacy/observed token**, not on the current official page | — | — |
| `Google-Extended` | Google | **Control token only** — training *and* grounding for Gemini Apps + Vertex AI | Yes | [Google common crawlers](https://developers.google.com/crawling/docs/crawlers-fetchers/google-common-crawlers) |
| `Googlebot` | Google | **S** (Search, Discover, **and all Search features incl. AI Overviews/AI Mode**) | Yes | same |
| `Google-CloudVertexBot` | Google | **S** — crawls *you requested* for Vertex AI Agents | Yes | same |
| `Applebot` | Apple | **S** — Siri, Spotlight, Safari, and Apple's AI surfaces | Yes | [About Applebot](https://support.apple.com/en-us/119829) |
| `Applebot-Extended` | Apple | **T** — Apple Intelligence foundation models | Yes | same |
| `CCBot` | Common Crawl | **T** (open corpus; third parties train on it) | Yes — `CCBot/2.0 (https://commoncrawl.org/faq/)` | [commoncrawl.org/ccbot](https://commoncrawl.org/ccbot) |
| `Bytespider` | ByteDance | **T** | Disputed (documented non-compliance complaints) | — |
| `Amazonbot` | Amazon | **T** — *"may be used to train Amazon AI models"* | Yes | [About AmazonBot](https://developer.amazon.com/en/amazonbot) |
| `Amzn-SearchBot` | Amazon | **S** — Alexa/search surfaces, not training | Yes | same |
| `Amzn-User` | Amazon | **U** — *"may not follow all robots.txt directives"* | Partial | same |
| `meta-externalagent` | Meta | **T** (Meta AI/Llama; formerly FacebookBot/MetaAIBot) | Yes | [Meta crawlers](https://developers.facebook.com/docs/sharing/webmasters/crawler) |
| `meta-externalfetcher` | Meta | **U** | Yes | same |
| `cohere-ai` | Cohere | **T** | Yes | [Cohere web crawlers](https://docs.cohere.com/docs/cohere-web-crawlers) |
| `YouBot` | You.com | **S** — *"powers the You.com search engine"*; respects robots.txt and `Crawl-delay`, caches robots.txt 30 min | Yes | [you.com/docs/youbot](https://you.com/docs/youbot) |
| `Diffbot` | Diffbot | **T/Commercial** — knowledge graph sold as data; independent opt-out mechanism | Yes | diffbot.com |
| `ImagesiftBot` | Imagesift (image dataset) | **T** | Yes | — |
| `Timpibot` | Timpi | **T** | Yes | — |
| `Omgilibot` | Webz.io | **T** — **retired/replaced by the Webz.io "WebzBot" agents** | — | [Webz.io](https://webz.io/blog/company/from-omgilibot-to-the-webzbot-duo-a-powerful-leap-for-ethical-and-comprehensive-data-collection/) |
| `DuckAssistBot` | DuckDuckGo | **S/U** — real-time crawl for AI-assisted answers; **not used to train**; opt-out takes effect **72 hours**; UA `DuckAssistBot/1.2; (+http://duckduckgo.com/duckassistbot.html)` | Yes | [DuckDuckGo](https://duckduckgo.com/duckduckgo-help-pages/results/duckassistbot) |
| `MistralAI-User` | Mistral | **U** | Yes | Mistral docs |
| **xAI / Grok** | xAI | **No published token.** `robots.txt` gives you **no control**; there is no documented user agent to govern. Agentic "Grok Bot" traffic arrives inside authenticated sessions. | **N/A** | ([tracker](https://keywordseverywhere.com/news/grok-updates/)) |

### The two distinctions that decide your policy

**Does blocking `Google-Extended` hurt Search/rankings? No.** Google's exact wording, on the live page (last updated 2026-07-14): *"`Google-Extended` is a standalone product token that web publishers can use to manage whether content Google crawls from their sites may be used for training future generations of Gemini models that power Gemini Apps and Vertex AI API for Gemini **and for grounding (providing content from the Google Search index to the model at prompt time to improve factuality and relevancy) in Gemini Apps and Grounding with Google Search on Vertex AI**."* Then: *"**Google-Extended does not impact a site's inclusion in Google Search nor is it used as a ranking signal in Google Search.**"* — **but note the 2025→2026 scope expansion: Google-Extended now also governs *grounding*, not just training.** If you want Gemini Apps to be able to ground on your pages, you must allow it. AI Overviews themselves are governed by `Googlebot` (*"affect Google Search (including Discover and **all Google Search features**)"*). **Blocking Google-Extended costs you zero Google Search ranking. Whether it costs you Gemini-app citations is a 2026 change and is not separately documented.**

**Does blocking `GPTBot` hurt ChatGPT search citations? No — they are independent controls.** OpenAI: *"Each setting is independent of the others – for example, a webmaster can allow OAI-SearchBot in order to appear in search results while disallowing GPTBot to indicate that crawled content should not be used for training... **Sites that are opted out of OAI-SearchBot will not be shown in ChatGPT search answers, though can still appear as navigational links.**"* Allowance can take **~24 hours** to apply. `OAI-SearchBot` is the only OpenAI token that gates ChatGPT answer visibility. **Blocking GPTBot costs you nothing in ChatGPT citations and gains you nothing either.**

**Training-only tokens (blocking = no citation cost, no citation gain):** `GPTBot`, `ClaudeBot`, `CCBot`, `Applebot-Extended`, `Google-Extended` (training *and* Gemini grounding), `Amazonbot`, `meta-externalagent`, `cohere-ai`, `Bytespider`, `Diffbot`, `ImagesiftBot`, `Timpibot`, `Omgilibot`. **Note the trap:** `CCBot` feeds Common Crawl, which is a substrate for many models *and* for some retrieval corpora — blocking it is a genuine trade-off, not free.

**Answer-visibility tokens (blocking = you disappear from that engine's answers):** `OAI-SearchBot`, `PerplexityBot`, `Claude-SearchBot`, `Claude-User`, `Applebot`, `Googlebot`, `DuckAssistBot`, `YouBot`, `Amzn-SearchBot`, `Google-CloudVertexBot`. `ChatGPT-User`, `Perplexity-User`, `Claude-User`, `Amzn-User`, `MistralAI-User`, `meta-externalfetcher` are user-triggered fetches — several vendors **state explicitly that robots.txt may not apply to them**, which is a known hole.

**Contested compliance:** Cloudflare's **August 2025** report, [*"Perplexity is using stealth, undeclared crawlers to evade website no-crawl directives"*](https://blog.cloudflare.com/perplexity-is-using-stealth-undeclared-crawlers-to-evade-website-no-crawl-directives/), alleges undeclared crawlers and IP rotation to bypass blocks. Perplexity [rejected the accusations as based on "embarrassing errors"](https://www.zdnet.com/article/perplexity-says-cloudflares-accusations-of-stealth-ai-scraping-are-based-on-embarrassing-errors/). **Widely reported, unconfirmed.** Anthropic's page is the strongest primary commitment: *"Anthropic's Bots respect 'do not crawl' signals by honoring industry standard directives in robots.txt"* and *"respect anti-circumvention technologies (e.g., we will not attempt to bypass CAPTCHAs)"*; it also supports non-standard `Crawl-delay` and warns that IP blocking *"may not work correctly or persistently guarantee an opt-out, as doing so impedes our ability to read your robots.txt file."* **Verify by reverse DNS/IP, never by user-agent string alone** — Google, OpenAI, Anthropic, Amazon, DuckDuckGo and You.com all publish IP JSON endpoints (e.g. `https://openai.com/searchbot.json`, `https://openai.com/gptbot.json`, `https://openai.com/chatgpt-user.json`, `https://claude.com/crawling/bots.json`, `https://duckduckgo.com/duckassistbot.json`, `https://index.commoncrawl.org/ccbot.json`, `https://you.com/.well-known/http-message-signatures-directory` for Web Bot Auth).

---

## 3. Recommended `robots.txt` for maximum AI citation visibility

Policy: **allow every answer-visibility and user-triggered agent; disallow training-only agents; let Google-Extended through, because it now also governs Gemini grounding.** If you would rather stay out of Gemini grounding, move `Google-Extended` into the disallow block — it costs nothing in Google Search.

```
# robots.txt — orewire.com
# Policy: maximum AI answer/citation visibility; no model-training ingestion.
# Last reviewed: 2026

# --- AI ANSWER ENGINES: allowed (blocking these removes you from their answers) ---
User-agent: OAI-SearchBot
Allow: /

User-agent: ChatGPT-User
Allow: /

User-agent: PerplexityBot
Allow: /

User-agent: Perplexity-User
Allow: /

User-agent: Claude-SearchBot
Allow: /

User-agent: Claude-User
Allow: /

User-agent: DuckAssistBot
Allow: /

User-agent: YouBot
Allow: /

User-agent: Amzn-SearchBot
Allow: /

User-agent: Amzn-User
Allow: /

User-agent: MistralAI-User
Allow: /

User-agent: meta-externalfetcher
Allow: /

User-agent: Google-CloudVertexBot
Allow: /

User-agent: Applebot
Allow: /

User-agent: Googlebot
Allow: /

# --- MODEL TRAINING: disallowed (costs you no citations; stops training ingestion) ---
User-agent: GPTBot
Disallow: /

User-agent: ClaudeBot
Disallow: /

User-agent: Google-Extended
Disallow: /          # remove this block if you want Gemini grounding to use your pages

User-agent: Applebot-Extended
Disallow: /

User-agent: CCBot
Disallow: /          # NOTE: also removes you from the Common Crawl corpus

User-agent: Amazonbot
Disallow: /

User-agent: meta-externalagent
Disallow: /

User-agent: Bytespider
Disallow: /

User-agent: cohere-ai
Disallow: /

User-agent: Diffbot
Disallow: /

User-agent: ImagesiftBot
Disallow: /

User-agent: Timpibot
Disallow: /

User-agent: Omgilibot
Disallow: /

# --- EVERYTHING ELSE (incl. undeclared crawlers): public HTML only ---
User-agent: *
Allow: /
Disallow: /api/          # NOTE: robots.txt is PREFIX matching, so /api/ also
Disallow: /admin/        #       matches /api-docs — keep API docs off this prefix
Disallow: /internal/
Disallow: /*?sort=
Disallow: /*?filter=
Disallow: /*?page=
Disallow: /search?

Sitemap: https://orewire.com/sitemap.xml
Sitemap: https://orewire.com/sitemap-news.xml
```

**Sitemap/robots interaction — the exact mechanics:** the `Sitemap:` directive is **non-standard but supported by Google, Bing, Yandex and others**; it must be an **absolute URL**, and you may declare it in robots.txt, ping it, or submit it in Search Console / Bing Webmaster Tools. It is **independent of the `User-agent` groups** — it is not scoped to a bot. Critically, **`Sitemap:` in robots.txt does not grant crawl permission, and blocking a bot in robots.txt means that bot will not use your sitemap.** Use `sitemap.xml` for all indexable URLs and a separate **Google News sitemap** (`<news:news>` with `publication_date`) for mining-journalism posts — AI answer engines weight freshness heavily, and `lastmod` is the cheapest freshness signal you control. Keep `lastmod` in **W3C/ISO 8601 with timezone** (`2026-09-14T08:30:00+00:00`); inconsistent `lastmod` is a documented cause of sitemaps being ignored.

For an SPA, also **remove any `Disallow` on the JS/CSS bundles** and confirm crawlers are not blocked from `/assets/`. And note Google's file-size limit: crawlers fetch only the **first 15 MB** of a file by default (Googlebot may apply a smaller, e.g. 2 MB, limit for HTML).

---

## 4. `llms.txt` — spec, adoption, and honest efficacy

**Spec** ([llmstxt.org](https://llmstxt.org/), Jeremy Howard, published 3 Sep 2024, **v2 modified 10 Aug 2026**): a Markdown file at `/llms.txt` or any subpath (e.g. `/docs/llms.txt`), covering URLs under that path; most specific file wins. Required: an **H1** with the site/project name. Then optional **blockquote summary**, free-form Markdown sections, and zero or more **H2 "file lists"** of `- [name](url): optional note`. A convention section `## Optional` holds skippable links. **v2 adds a second proposal:** publish a clean Markdown version of each page at the *same URL* with `.md` appended (`page.html.md`) or the extension replaced (`page.md`; `index.html.md`/`index.md` for bare paths), and advertise it with link relations — `rel="alternate" type="text/markdown"` for the Markdown twin and `rel="describedby"` for the covering `llms.txt`. Both can go in `<link>` tags **or** an HTTP `Link:` header, which nginx can emit without touching the app.

**Adoption:** SE Ranking's study of **300,000 domains** found `llms.txt` present on **10.13%** and **no clear, consistent citation-frequency lift** ([SEJ coverage](https://www.searchenginejournal.com/llms-txt-shows-no-clear-effect-on-ai-citations-based-on-300k-domains/561542/)). A second independent study, **Trakkr Research, 37,894 domains**, reported the same null: *"The llms.txt Effect: Zero Citation Advantage"* ([summary of both](https://somethinginc.com/blog/does-llms-txt-work-2026-data/)). Rankability measured **8.7% adoption among the top 1,000 sites** (June 2026) — adoption climbing, effectiveness flat. **Ahrefs, 137K sites: 97% of `llms.txt` files never get read** ([Ahrefs](https://ahrefs.com/blog/llmstxt-study/)). The honest reading is **"inert, not harmful."**

**Do AI crawlers fetch it?** Server-log evidence is thin and largely anecdotal; the best-documented public attempt is a Zenodo preprint on *crawler retrieval of an `llms.txt` resource announced through robots.txt across seven sites on one server* ([Zenodo 22814844](https://zenodo.org/records/22814844)), whose title itself flags **"what a server log can and cannot show."** Treat "AI crawlers don't read llms.txt" as **widely reported, weakly evidenced**. What *is* confirmed by primary source: the AI labs publish their own (OpenAI `developers.openai.com/llms.txt`, Anthropic, Gemini), Mintlify/GitBook/Yoast/AIOSEO/Wix generate them, and **Chrome Lighthouse audits for one** as part of agentic browsing checks. So the file has real machine-consumer value for *documentation* and *coding agents* — which is exactly the use case Howard now foregrounds. **Verdict: ship it, spend 30 minutes, expect no citation lift, do not lead a GEO plan with it.**

**Practical alternatives that do work, in priority order:**
1. **Server-rendered, semantic HTML** — this is the whole ballgame for a Vite SPA. Test with `curl` and confirm every fact you want cited is in the initial HTML response.
2. **Answer-first, dated, entity-explicit content** — first 30% of the page; proper nouns over pronouns; numbers over adjectives.
3. **Sitemaps with accurate `lastmod`** + RSS/Atom for news.
4. **Markdown twins** (`.md`) with `Link:` headers — the genuinely useful half of llms.txt v2.
5. **Public datasets and stable URLs** — a downloadable JSON/CSV of your mining data, with a permanent URL and an explicit licence, is a citation magnet that nothing else replicates.
6. **API / MCP endpoints** — machine-readable access beats text-file hints. If you expose an MCP server or documented API, agents fetch facts directly.
7. **Wikipedia/Wikidata presence** — Profound's data shows ChatGPT leads on institutional citations *"largely due to Wikipedia"*; institution share reaches 28–30% in education and healthcare. Create/maintain correct Wikidata items for companies and people (with `instance of`, `stock exchange`, `official website`, `inception`), and make sure `sameAs` links point at them.
8. **Earned media** — the 2509.08919 finding: AI Search over-weights third-party authoritative sources. For OreWire, trade-press coverage of your data is worth more than any on-site tweak.

---

## 5. OreWire-specific: what to change in this stack

**The SPA is your single biggest liability.** Vite/React ships an empty shell; Googlebot renders JS, but **most AI crawlers do not execute JavaScript** (`OAI-SearchBot` and `PerplexityBot` are documented as fetchers, not renderers; Meta's guidance is explicit: *"Render without JavaScript... content gated by JS often won't be parsed"*). **The Princeton GEO paper served crawlers plain text of the top-5 Google results — no JS involved.** Fix, in order of effort:

1. **Prerender the crawler-critical routes on the server.** In nginx, route known bot UAs (or all requests without a session) to an Express prerender middleware instead of the SPA shell:
   ```nginx
   map $http_user_agent $is_bot {
     default 0;
     "~*(GPTBot|OAI-SearchBot|ChatGPT-User|PerplexityBot|Perplexity-User|ClaudeBot|Claude-User|Claude-SearchBot|Googlebot|Google-Extended|Google-CloudVertexBot|Applebot|Amazonbot|Amzn-SearchBot|Amzn-User|Bytespider|CCBot|meta-externalagent|meta-externalfetcher|cohere-ai|YouBot|Diffbot|DuckAssistBot|MistralAI-User|ImagesiftBot|Timpibot|Omgilibot)" 1;
   }
   server {
     listen 443 ssl http2;
     server_name orewire.com;
     root /var/www/orewire/dist;
     location / {
       if ($is_bot) { proxy_pass http://127.0.0.1:3000; }   # Express SSR/prerender
       try_files $uri /index.html;
     }
   }
   ```
   Cleaner still: render-to-string in Express for `/company/:slug` and `/news/:slug`, or pre-generate static HTML per slug at build time.
2. **First-contentful facts, not a chart.** Put the company's name, ticker, exchange, jurisdiction, project names, resource/reserve figures, key dates and a 2–3 sentence dated summary in the **initial HTML**. Charts must be progressive enhancement on top, never the only carrier of a number.
3. **Give every Company page a stable, canonical, human-readable URL** (`/company/carson-river-ventures-corp`) with `<link rel="canonical">`, an `Article`/`Organization` JSON-LD block with `sameAs` → Wikidata/SEDAR+/exchange listing, and a visible **"Last updated: <date>"**. Natural-language slugs correlated with citations in Ahrefs' 2026 data (89.78% vs 81.11%).
4. **Put a dated, quotable "Key facts" table near the top** of each Company and news page — this is the extractable unit. Note the honest caveat: controlled tests found table-vs-paragraph formatting weak (OR 0.78–1.68), so the win comes from **specificity and position**, not the table itself.
5. **Serve `.md` twins** for Company and article pages via nginx (`try_files $uri.md`), with the `Link: <...>; rel="alternate"; type="text/markdown"` response header from the llms.txt v2 spec. Cheap, and it's the part of the spec with a real consumer (documentation and coding agents).
6. **Ship `/llms.txt`** at the root indexing your Company pages, newsroom, and a public dataset — 30 minutes, no expected lift, useful as a map for agent tooling.
7. **Publish the data.** A `https://orewire.com/data/companies.json` (or CSV) with a versioned URL, a `dateModified`, and a permissive licence is the highest-leverage GEO asset available to a data site and directly feeds an MCP endpoint later.
8. **Buy/monitor citations, don't just optimise.** Given Profound's Financial Services split (61/27/8/3) and the 11-day citation half-life, set up a fixed prompt set of 20–50 mining/finance questions, run it weekly, and record which third-party domains are being cited for your companies. That is the actionable signal; `llms.txt` is not.
9. **Instrument the backend.** Log bot hits by verified reverse-DNS/IP at the nginx layer, tag them in PostgreSQL, and watch whether `OAI-SearchBot` / `PerplexityBot` / `Claude-SearchBot` actually fetch your Company pages. This gives you real server-log evidence about your own site instead of trusting vendor folklore.
