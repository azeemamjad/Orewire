# Structured Data / schema.org for Finance & Mining Pages — Technical Digest

**Prepared for:** OreWire (orewire.com) — React SPA (Vite) + nginx + Node/Express/PostgreSQL
**Research date:** 2026 · **Scope:** schema.org type selection, Google rich-result support, 2023–2026 retirements, JSON-LD mechanics for SPAs

---

## 1. Bottom line for this stack

1. **JSON-LD is the only format you should ship.** Google's current *Understand how structured data works* doc marks JSON-LD **(Recommended)** and states all three formats "are equally fine for Google" — but JSON-LD is the only one that survives an SPA cleanly.
2. **Google does process JS-injected structured data.** Confirmed twice by primary sources (quoted in §5). However, for a Vite SPA the *reliable* path is **SSR/prerender** because JSON-LD must be present in the DOM at render time.
3. **Most of your proposed type list is semantic-only.** Of ~14 types proposed, only **4–5** produce live Google rich results today (Organization, BreadcrumbList, Article/NewsArticle, ProfilePage, plus Dataset in Dataset Search only).
4. **FAQPage is dead for Google but not for schema.org.** Retired May 2026 (§3.1). Keep the markup for LLM/other-engine consumption; do not expect a rich result.
5. **`tickerSymbol` has zero Google support.** It is valid schema.org (property of `Corporation`) but appears in **no** Google feature guide. Semantic-only — still worth shipping for entity clarity.

---

## 2. Type-by-type recommendation

### 2.1 Entity / organization layer

| Type | Verdict | Google rich result? | Notes |
|---|---|---|---|
| **`NewsMediaOrganization`** | ✅ **Use on homepage** | ✅ Organization markup feeds knowledge panel + `logo` in results | Subtype of `Organization`. Adds Trust Project newsroom-policy properties (`masthead`, `ethicsPolicy`, `correctionsPolicy`, `diversityPolicy`, `actionableFeedbackPolicy`, `unnamedSourcesPolicy`, `verificationFactCheckingPolicy`, `noBylinesPolicy`, `missionCoveragePrioritiesPolicy`, `ownershipFundingInfo`). All `CreativeWork`-or-`URL` ranged. |
| **`Organization`** | ✅ parent type | ✅ | Google: "There are **no required properties**; instead, we recommend adding as many properties that are relevant." Place on **home page or a single about page** — "You don't need to include it on every page of your site." |
| **`Corporation`** | ✅ **Use for company entity pages** | ✅ (as Organization markup) | Confirmed live schema.org Type: *"Organization: A business corporation."* Carries `tickerSymbol`. Google's guidance is to use **the most specific subtype that matches** — so `Corporation` beats bare `Organization` for Carson River Ventures Corp. |
| **`WebSite`** | ⚠️ Use, but **drop `potentialAction`** | ❌ **No** — sitelinks searchbox retired | See §3.3. `WebSite` itself is still valid and useful; the `SearchAction` inside it is now inert for Google. |
| **`Person`** | ✅ Use for authors/execs | ✅ via `ProfilePage` | Pair with `ProfilePage` on bio pages. |
| **`ProfilePage`** | ✅ Use | ✅ still documented | Caution: Google's Nov 2023 launch and Aug 2024 clarification narrowed this — it feeds the **"Forums"/Perspectives** surface, not a standalone rich result. |
| **`AboutPage`** | ✅ Use | ❌ semantic-only | Subtype of `WebPage`. Ideal target for `ownershipFundingInfo` on the org. |

### 2.2 Company identifiers — what Google actually reads

This is where practitioner advice most often diverges from Google's docs. Google's Organization guide lists these properties; note the two explicit **"use X instead"** instructions:

- **`iso6523Code`** — *"The ISO 6523 identifier of your organization… We recommend separating the ICD and the identifier with a colon character (`U+003A`). Common ICD values include: `0060`: Dun & Bradstreet DUNS · `0088`: GS1 GLN · `0199`: Legal Entity Identifier (LEI)."*
- **`leiCode`** — Google: *"We encourage using the `iso6523Code` field with prefix `0199:` **instead**."* ← **Primary-source confirmed downgrade.**
- **`duns`** — Google: *"We encourage using the `iso6523Code` field with prefix `0060:` **instead**."* ← Same.
- **`sameAs`** — *"The URL of a page on another website with additional information about your organization… You can provide multiple `sameAs` URLs."* schema.org defines it as: *"URL of a reference Web page that unambiguously indicates the item's identity. E.g. the URL of the item's Wikipedia page, Wikidata entry, or official website."* → **This is your SEDAR+ / exchange profile / Wikidata hook.**
- **`identifier`** — *"any kind of identifier for any kind of Thing, such as ISBNs, GTIN codes, UUIDs."* Range: `PropertyValue | Text | URL`. Use for **SEDAR+ profile IDs and exchange ticker IDs** where they aren't `sameAs` URLs.
- **`naics`**, **`taxID`**, **`vatID`**, **`legalName`**, **`globalLocationNumber`** — all Google-recognized.
- **`tickerSymbol`** — ❌ **not in Google's Organization property table at all.** schema.org definition: *"The exchange traded instrument associated with a Corporation object. The tickerSymbol is expressed as an exchange and an instrument name separated by a space character. For the exchange component… we recommend using the controlled vocabulary of Market Identifier Codes (MIC) specified in ISO 15022."* → Format as `"TSXV: CRV"` (MIC + space + instrument). Semantic-only for Google; valuable for LLM extraction and entity disambiguation.

### 2.3 Content layer

| Type | Google rich result? | Guidance |
|---|---|---|
| **`NewsArticle`** (⊂ `Article` ⊂ `CreativeWork`) | ✅ **Strongest live feature you have** — the Article feature drives headline + large image in Top Stories/News surfaces | Required per Google: `author`, `datePublished`, `headline`, `image`, `publisher`. Add `dateModified`, `about`, `mentions`. NewsArticle adds `dateline`, `printColumn`, `printEdition`, `printPage`, `printSection`. |
| **`Article`** | ✅ | Use bare `Article` for non-news commentary; `NewsArticle` for journalism. |
| **`BreadcrumbList`** | ✅ **but desktop-only** | Google added a feature-availability note on **January 22, 2025** stating breadcrumbs *"only appear on desktop search results, not mobile."* Still worth shipping. |
| **`Dataset`** | ⚠️ **Dataset Search only** | Clarified **November 5, 2025**: Dataset markup *"exclusively powers results within Dataset Search"* and *"does not influence regular Google Search result presentation."* **Still fully documented and supported** — not deprecated. Highly relevant for OreWire's commodity/price/filing datasets. |
| **`QAPage`** | ✅ still documented + expanded | Google **expanded** supported properties for Q&A Page markup in **March 2026**. Keep. |
| **`FAQPage`** | ❌ **RETIRED — May 2026** | See §3.1 |
| **`FinancialProduct`** | ❌ **no Google feature** | Real type: `FinancialProduct` ⊂ `Service` ⊂ `Intangible`. Properties: `interestRate`, `annualPercentageRate`, `feesAndCommissionsSpecification`. Subtypes: `BankAccount`, `CurrencyConversionService`, `InvestmentOrDeposit`, `LoanOrCredit`, `PaymentCard`, `PaymentService`. |
| **`InvestmentFund`** | ❌ **no Google feature** | Real type: `InvestmentFund` ⊂ `InvestmentOrDeposit` ⊂ `FinancialProduct`. Adds `amount` (`MonetaryAmount`). |
| **`ExchangeRateSpecification`** | ❌ no Google feature | **Confirmed real:** `Thing > Intangible > StructuredValue > ExchangeRateSpecification`. Properties: `currency` (`Text`, ISO 4217 / crypto ticker / LETS name), `currentExchangeRate` (`UnitPriceSpecification`), `exchangeRateSpread` (`MonetaryAmount | Number`). schema.org reports **"Usage: 1K–10K Domains (Google – August 2026)"** — modest but real adoption. |
| **`MonetaryAmount`** | ❌ no Google feature | `StructuredValue` subtype. Properties: `currency`, `value`, `minValue`, `maxValue`, `validFrom`, `validThrough`. |

### 2.4 Mining-specific types — **confirmed: none exist**

**Verified against schema.org's own Full schema hierarchy** (`https://schema.org/docs/full.html`): a pattern search for `mining|mineral|mine|ore|quarry|drill|exploration|commodit|metal|geolog|petrol|oil|gas` returns **no domain types**. The only hits are `EnergyConsumptionDetails` / `EnergyEfficiencyEnumeration` / `EUEnergyEfficiencyCategory*` / `EnergyStarCertified` — all **white-goods energy labelling**, unrelated to extractive industry. There is no `Mine`, `Mineral`, `MiningCompany`, `ExplorationLicense`, `Resource`, or `Reserve` type.

**What to use instead** (practitioner pattern, not officially endorsed):

1. **`Corporation` as the entity type** — this *is* the intended schema.org type for companies, and mining juniors are companies.
2. **`additionalType` for external-vocabulary extension.** schema.org's own definition: *"An additional type for the item, typically used for adding more specific types from external vocabularies in microdata syntax… Typically the value is a URI-identified RDF class."* Point this at a geoscience vocabulary URI, e.g. an [EarthResourceML](https://earthresourceml.org/) class. **Caveat:** `additionalType` is documented as a *microdata-syntax* mechanism; there is **no evidence Google consumes it**, so treat it as LLM/semantic-only.
3. **`Product` + `additionalProperty` (`PropertyValue`)** to model commodities/mineral output — again semantic-only for Google.
4. **`Dataset`** for drill results, resource estimates, assays, and price series — this is the *only* mining-adjacent use with a real (non-Google-Search) consumer: **Dataset Search**.
5. **`mentions` / `about`** on articles, pointing at `Corporation` and `Place` nodes — this is the cleanest way to tie a news article to a project and a mining district without inventing vocabulary.

**Honest assessment:** the gap is real and unfilled. EarthResourceML/GeoSciML are XML/OGC standards used in geoscience data infrastructure, not JSON-LD web-markup vocabularies with search-engine consumers. There is no confirmed community proposal merged into schema.org for mining types.

---

## 3. Retirements — date-stamped (the critical section)

### 3.1 FAQ rich results — **FULLY RETIRED**

| Date | Event |
|---|---|
| **Aug 8, 2023** | Google announces *"Changes to HowTo and FAQ rich results."* FAQ rich results restricted to **"well-known, authoritative government and health websites"** only. Most publishers lost them immediately. |
| **May 2026** (`#deprecating-the-faq-rich-result-feature`) | Search Central changelog: **"Deprecating the FAQ rich result feature."** Widely reported (Search Engine Land, Search Engine Journal, SEOcrawl) as taking effect **~May 7, 2026**. |
| **June 15, 2026** | Search Central changelog `#removing-faq-rich-result`: **"Removing documentation for the FAQ rich result feature."** The `/search/docs/appearance/structured-data/faqpage` page was **deleted**. `FAQPage` is **absent from the current Search Gallery**. |
| **June 2026** | FAQ rich results report retired from Search Console; Rich Results Test support removed. *(Industry-reported.)* |
| **August 2026** | Search Console API support removed. *(Industry-reported.)* |

**Actionable:** `FAQPage` now has **zero** Google rich-result effect. It is **not** a ranking signal and never was. Do **not** remove it reflexively — third-party reporting (SEOcrawl) argues LLMs read it — but that claim is **unverified practitioner opinion**, not a Google or OpenAI/Anthropic primary source.

### 3.2 HowTo — **REMOVED**

- **Aug 8, 2023:** Same blog post restricted HowTo rich results to **desktop only**.
- Google subsequently removed the HowTo feature entirely; the `/search/docs/appearance/structured-data/how-to` path now 404s and **`HowTo` is absent from the current Search Gallery**. *(HowToStep/HowToSection remain as valid schema.org types.)*
- **Date precision caveat:** the 2023 announcement date is primary-source confirmed; the exact date the HowTo docs page was removed is **not** pinned to a changelog entry I could verify. Google's own Apr 2026 note *"Removed outdated information about JavaScript and accessibility"* is unrelated.

### 3.3 Sitelinks search box — **RETIRED**

- **Oct 21, 2024** — blog post **"Farewell, Sitelinks Search Box"** (publish timestamp confirmed: `Mon, 21 Oct 2024 07:00:00 GMT`).
- **Nov 21, 2024** — box stops appearing in Search results. *(Industry-reported; SEJ headline: "Google To Retire Sitelinks Search Box In November.")*
- **Nov 29, 2024** — Search Central changelog `#bye-sitelinkbox` (primary source): *"**Removing sitelinks search box documentation.** What: Removed the sitelinks search box documentation and **archived the `nositelinkssearchbox` rule**. Why: The sitelinks search box feature is no longer available in Google Search results."*
- The **current** `/search/docs/appearance/sitelinks` doc (last updated 2025-12-10) describes only automated sitelinks and contains **no mention of the search box or `SearchAction`**. There is **no current Google documentation recommending `WebSite` + `SearchAction`.**

**Actionable for OreWire:**
- **DELETE** the `WebSite.potentialAction` → `SearchAction` block. It is inert for Google.
- **KEEP** the `WebSite` node itself — `name`, `url`, `alternateName`, `inLanguage`, `publisher` still contribute to site-name and entity understanding.
- **DO NOT** ship `nositelinkssearchbox` — Google archived it. Per the `noarchive` precedent, Google's guidance for retired opt-outs is that you needn't remove them because other engines may still use them, but it does nothing for Google.
- `SearchAction` remains a **valid schema.org type** — harmless for other consumers, pointless for Google.

### 3.4 The 2025–2026 retirement wave

**June 12, 2025 — seven types retired simultaneously**, announced by Henry Hsu (PM, Google Search) in *"Simplifying the search results page."* Google's stated rationale: *"our analysis shows that they're not commonly used in Search, and we found that these specific displays are no longer providing significant additional value for users."*

1. **Book Actions** ⚠️ *later partially reversed* — see below
2. **Course Info** (the *feature*; the separate "Course list"/Carousel feature survives)
3. **Claim Review**
4. **Estimated Salary**
5. **Learning Video**
6. **Special Announcement**
7. **Vehicle Listing**

**Reversal (Nov 5, 2025):** Google **removed the deprecation banner from Book actions** documentation, and `Book actions` **is listed in the current Feature guides sidebar**. Reporting attributes the reversal to Google's review finding active implementations. ⚠️ Similarly, **`Fact check` is still listed** in the current Feature guides sidebar despite Claim Review being in the June 2025 retirement list — **treat ClaimReview's status as contradictory** and verify before building on it.

**September 2025:** *"Removing documentation for some deprecated structured data types"* — cleanup pass following June.
**November 5, 2025:** *"Removing and clarifying documentation for some structured data types"* — practice problem deprecation + Dataset clarification.
**January 2026:** *"Removing documentation for the practice problem structured data type"* — **Practice problems fully retired** (Rich Results Test, Search Console reporting, Search appearance filters). *Note: the physics/math solver feature `Math solver` **remains** listed in the current Search Gallery — practice problems ≠ math solvers.*
**March 2026:** *"Added new supported properties for Discussion Forum and QA Page markup"* — **QAPage was expanded, not retired.**
**June 15, 2026:** *"Clarifying guidance on llms.txt files."*
**July 24, 2026:** New review-snippet guideline re fake/undisclosed incentivized reviews.

**Still alive (verified against the current Search Gallery):** Article, Breadcrumb, Carousel, Course list, Dataset, Discussion forum, Education Q&A, Employer aggregate rating, Event, Image metadata, Job posting, Local business, Math solver, Movie, Organization, Product, Profile page, **Q&A**, Recipe, Review snippet, Software app, Speakable, Subscription/paywalled content, Vacation rental, Video. **Plus** Book actions and Fact check in the sidebar.

---

## 4. What Google does *not* want to hear (2026 primary source)

From *"Optimizing for generative AI search"* (last updated **2026-07-10**) — the **Mythbusting** section, verbatim:

- **llms.txt:** *"**LLMS.txt files and other 'special' markup**: You don't need to create new machine readable files, AI text files, markup, or Markdown to appear in Google Search (including its generative AI capabilities), as **Google Search itself doesn't use them**."*
- **Structured data:** *"**Overfocusing on structured data**: Structured data isn't required for generative AI search, and **there's no special schema.org markup you need to add**. However, it's a good idea to continue using it as part of your overall SEO strategy, as it helps with being eligible for rich results on Google Search."*

**Interpretation:** This is a direct, dated contradiction of the "add more schema for GEO" folklore. Keep schema for rich-result eligibility and entity clarity. Do not expect it to buy AI-answer visibility.

---

## 5. JSON-LD vs microdata, `@graph`, and SPA injection

### Format choice
Google's *Understand how structured data works* (Supported formats table): JSON-LD is tagged **(Recommended)**. The table adds, for JSON-LD specifically: *"Google can read JSON-LD data when it is **dynamically injected into the page's contents**, such as by JavaScript code or embedded widgets in your content management system."*

Microdata and RDFa remain **equally supported** — Google states *"all 3 formats are equally fine for Google, as long as the markup is valid."* Microdata is impractical in a Vite SPA because you'd have to render `itemscope`/`itemprop` attributes through every component.

### JS-injected structured data — **confirmed supported**
Dedicated doc *"Generate structured data with JavaScript"* (last updated **2025-12-10**), verbatim:
> *"Either way, **Google Search can understand and process structured data that's available in the DOM when it renders the page.**"*

Google's own example is exactly your pattern — `fetch()` → create `<script type="application/ld+json">` → `document.head.appendChild(script)`.

**The real cost is timing, not capability.** Googlebot uses a two-phase crawl (initial HTML → render queue). Client-injected markup is only seen in phase two, so indexing can be delayed and is more fragile (failed fetch, early timeout, JS error = no markup). Google also advises, for Product markup specifically: *"dynamically-generated markup can make Shopping crawls less frequent and less reliable"* and recommends putting `Product` markup **in the initial HTML**.

### `@graph` vs multiple script tags
**No official Google statement requires or forbids either.** Findings:
- Multiple `<script type="application/ld+json">` blocks are supported — Google's GTM guidance explicitly supports adding separate blocks, and there is no documented limit.
- A single `@graph` array is a **JSON-LD 1.1 construct** (W3C Recommendation, `https://www.w3.org/TR/json-ld11/`) that lets you define multiple nodes in one document and cross-reference them by `@id`.
- **Practical recommendation:** use **one `@graph` per page** with stable `@id` values (`https://orewire.com/#organization`, `…/company/carson-river-ventures#corporation`). It guarantees deduplication (no competing `Organization` nodes) and lets `NewsArticle.publisher`/`about` point at `{"@id": "…"}` references instead of duplicating full objects.

### Placement & limits
- JSON-LD is valid in `<head>` **or** `<body>`. Google does not care. Injecting into `document.head` (Google's own example) is safest.
- **No documented Google limits** on number of script tags, payload size, or `@graph` depth. Practical limit is your own HTML weight.
- **One main entity per page.** Don't emit multiple competing `NewsArticle` nodes for one article. Entities of the same type across *different* pages are fine (one `Corporation` per company page).
- Testing: use the **URL** input of the Rich Results Test, not the code input — Google warns the code input has *"JavaScript limitations… (for example, CORS restrictions)."* Also: *"If you are testing a structured data type that is not supported by the Rich Results test, check the rendered HTML. If the rendered HTML contains the structured data, Google Search will be able to process it."* — This is how you validate semantic-only types like `FinancialProduct`.

---

## 6. Copy-pasteable `@graph` examples

### (a) OreWire homepage — `NewsMediaOrganization` + `WebSite`

Note: **no `potentialAction`/`SearchAction`** (§3.3).

```html
<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "NewsMediaOrganization",
      "@id": "https://orewire.com/#organization",
      "name": "OreWire",
      "alternateName": "OreWire Mining Intelligence",
      "url": "https://orewire.com/",
      "logo": {
        "@type": "ImageObject",
        "@id": "https://orewire.com/#logo",
        "url": "https://orewire.com/logo.png",
        "contentUrl": "https://orewire.com/logo.png",
        "width": 512,
        "height": 512,
        "caption": "OreWire"
      },
      "description": "Mining and junior-exploration market intelligence: company profiles, filings, commodity prices and sector news.",
      "foundingDate": "2024",
      "knowsAbout": [
        "junior mining",
        "mineral exploration",
        "mining equities",
        "NI 43-101 technical reports",
        "commodity prices",
        "mining finance"
      ],
      "publishingPrinciples": "https://orewire.com/editorial-policy",
      "ethicsPolicy": "https://orewire.com/editorial-policy",
      "correctionsPolicy": "https://orewire.com/corrections-policy",
      "actionableFeedbackPolicy": "https://orewire.com/contact",
      "ownershipFundingInfo": "https://orewire.com/about",
      "masthead": "https://orewire.com/about",
      "sameAs": [
        "https://www.wikidata.org/wiki/Q000000000",
        "https://www.linkedin.com/company/orewire",
        "https://x.com/orewire"
      ],
      "contactPoint": {
        "@type": "ContactPoint",
        "contactType": "customer support",
        "email": "hello@orewire.com",
        "availableLanguage": ["en"]
      }
    },
    {
      "@type": "WebSite",
      "@id": "https://orewire.com/#website",
      "url": "https://orewire.com/",
      "name": "OreWire",
      "alternateName": "OreWire",
      "inLanguage": "en",
      "publisher": { "@id": "https://orewire.com/#organization" }
    },
    {
      "@type": "WebPage",
      "@id": "https://orewire.com/#webpage",
      "url": "https://orewire.com/",
      "name": "OreWire — Mining & Junior Exploration Intelligence",
      "isPartOf": { "@id": "https://orewire.com/#website" },
      "about": { "@id": "https://orewire.com/#organization" },
      "inLanguage": "en",
      "primaryImageOfPage": { "@id": "https://orewire.com/#logo" }
    }
  ]
}
</script>
```

### (b) Mining company entity page — `Corporation`

Demonstrates: `tickerSymbol` with **ISO 15022 MIC** format, `iso6523Code` with the `0199:` (LEI) and `0060:` (DUNS) prefixes Google prefers, `identifier` for SEDAR+/exchange IDs, and `sameAs` pointing at SEDAR+, the exchange profile, and Wikidata. `additionalType` is shown (commented) as the mining-extension hook from §2.4.

```html
<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "Corporation",
      "@id": "https://orewire.com/company/carson-river-ventures-corp#corporation",
      "name": "Carson River Ventures Corp.",
      "legalName": "Carson River Ventures Corp.",
      "alternateName": ["Carson River Ventures", "CRV"],
      "url": "https://orewire.com/company/carson-river-ventures-corp",
      "description": "Junior mineral exploration company focused on gold and silver discovery in Nevada, USA.",
      "logo": "https://orewire.com/assets/companies/crv.png",
      "foundingDate": "2011",
      "tickerSymbol": "TSXV: CRV",
      "iso6523Code": [
        "0199:5493001KJTIIGC8Y1R12",
        "0060:123456789"
      ],
      "identifier": [
        {
          "@type": "PropertyValue",
          "propertyID": "SEDAR+",
          "value": "00012345",
          "url": "https://www.sedarplus.ca/csa-party/records/record/00012345"
        },
        {
          "@type": "PropertyValue",
          "propertyID": "TSXV",
          "value": "CRV",
          "url": "https://www.tsx.com/listings/listing-with-us/listed-company-directory"
        },
        {
          "@type": "PropertyValue",
          "propertyID": "CIK",
          "value": "0001234567"
        }
      ],
      "naics": "212220",
      "address": {
        "@type": "PostalAddress",
        "streetAddress": "000 Example Street, Suite 000",
        "addressLocality": "Vancouver",
        "addressRegion": "BC",
        "postalCode": "V6C 0A0",
        "addressCountry": "CA"
      },
      "sameAs": [
        "https://www.wikidata.org/wiki/Q000000001",
        "https://www.sedarplus.ca/csa-party/records/record/00012345",
        "https://www.tsx.com/listings/listing-with-us/listed-company-directory",
        "https://www.linkedin.com/company/carson-river-ventures",
        "https://orewire.com/company/carson-river-ventures-corp"
      ],
      "additionalProperty": [
        {
          "@type": "PropertyValue",
          "name": "Primary commodity",
          "propertyID": "commodity",
          "value": "Gold"
        },
        {
          "@type": "PropertyValue",
          "name": "Project stage",
          "propertyID": "stage",
          "value": "Exploration"
        },
        {
          "@type": "PropertyValue",
          "name": "Flagship project",
          "propertyID": "project",
          "value": "Carson River Project, Nevada, USA"
        }
      ],
      "knowsAbout": ["gold exploration", "silver exploration", "Nevada mining"],
      "parentOrganization": { "@type": "Organization", "name": "Carson River Holdings Ltd." }
    },
    {
      "@type": "BreadcrumbList",
      "@id": "https://orewire.com/company/carson-river-ventures-corp#breadcrumb",
      "itemListElement": [
        {
          "@type": "ListItem",
          "position": 1,
          "name": "Companies",
          "item": "https://orewire.com/companies"
        },
        {
          "@type": "ListItem",
          "position": 2,
          "name": "Carson River Ventures Corp.",
          "item": "https://orewire.com/company/carson-river-ventures-corp"
        }
      ]
    },
    {
      "@type": "WebPage",
      "@id": "https://orewire.com/company/carson-river-ventures-corp#webpage",
      "url": "https://orewire.com/company/carson-river-ventures-corp",
      "name": "Carson River Ventures Corp. (TSXV: CRV)",
      "isPartOf": { "@id": "https://orewire.com/#website" },
      "mainEntity": { "@id": "https://orewire.com/company/carson-river-ventures-corp#corporation" },
      "breadcrumb": { "@id": "https://orewire.com/company/carson-river-ventures-corp#breadcrumb" },
      "inLanguage": "en"
    }
  ]
}
</script>
```

> **Mining gap workaround** — if you want to signal the external geoscience vocabulary explicitly, add inside the `Corporation` node:
> ```json
> "additionalType": "https://vocab.earthresourceml.org/erml/2.0/MiningCompany"
> ```
> Valid schema.org, **no confirmed Google consumption**. Evaluate before shipping.

### (c) News article — `NewsArticle`

```html
<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "NewsArticle",
      "@id": "https://orewire.com/news/carson-river-intersects-12-4-gt-au#article",
      "isPartOf": { "@id": "https://orewire.com/#website" },
      "mainEntityOfPage": { "@id": "https://orewire.com/news/carson-river-intersects-12-4-gt-au#webpage" },
      "headline": "Carson River Ventures Intersects 12.4 g/t Au Over 8.1 m at Carson River Project",
      "alternativeHeadline": "CRV reports high-grade gold intercept in Nevada",
      "description": "Carson River Ventures Corp. reported assay results from its 2026 drill program at the Carson River Project in Nevada.",
      "image": [
        "https://orewire.com/assets/news/crv-2026-drill-16x9.jpg",
        "https://orewire.com/assets/news/crv-2026-drill-4x3.jpg",
        "https://orewire.com/assets/news/crv-2026-drill-1x1.jpg"
      ],
      "datePublished": "2026-06-14T13:05:00-07:00",
      "dateModified": "2026-06-14T16:42:00-07:00",
      "author": [
        {
          "@type": "Person",
          "@id": "https://orewire.com/author/jane-doe#person",
          "name": "Jane Doe",
          "jobTitle": "Senior Mining Analyst",
          "url": "https://orewire.com/author/jane-doe",
          "sameAs": ["https://www.linkedin.com/in/janedoe"]
        }
      ],
      "publisher": { "@id": "https://orewire.com/#organization" },
      "articleSection": "Exploration",
      "inLanguage": "en",
      "isAccessibleForFree": true,
      "about": [
        { "@id": "https://orewire.com/company/carson-river-ventures-corp#corporation" },
        {
          "@type": "Place",
          "name": "Carson River Project, Nevada, USA",
          "address": {
            "@type": "PostalAddress",
            "addressRegion": "NV",
            "addressCountry": "US"
          }
        },
        { "@type": "Thing", "name": "Gold mineralisation" }
      ],
      "mentions": [
        { "@id": "https://orewire.com/company/carson-river-ventures-corp#corporation" },
        { "@type": "Thing", "name": "NI 43-101 technical report" },
        { "@type": "Organization", "name": "TSX Venture Exchange" }
      ],
      "keywords": ["gold", "Nevada", "drill results", "junior mining", "CRV"],
      "speakable": {
        "@type": "SpeakableSpecification",
        "cssSelector": [".article-headline", ".article-summary"]
      }
    },
    {
      "@type": "BreadcrumbList",
      "@id": "https://orewire.com/news/carson-river-intersects-12-4-gt-au#breadcrumb",
      "itemListElement": [
        { "@type": "ListItem", "position": 1, "name": "News", "item": "https://orewire.com/news" },
        { "@type": "ListItem", "position": 2, "name": "Exploration", "item": "https://orewire.com/news/exploration" },
        {
          "@type": "ListItem",
          "position": 3,
          "name": "Carson River Ventures Intersects 12.4 g/t Au Over 8.1 m",
          "item": "https://orewire.com/news/carson-river-intersects-12-4-gt-au"
        }
      ]
    },
    {
      "@type": "WebPage",
      "@id": "https://orewire.com/news/carson-river-intersects-12-4-gt-au#webpage",
      "url": "https://orewire.com/news/carson-river-intersects-12-4-gt-au",
      "isPartOf": { "@id": "https://orewire.com/#website" },
      "breadcrumb": { "@id": "https://orewire.com/news/carson-river-intersects-12-4-gt-au#breadcrumb" },
      "inLanguage": "en"
    }
  ]
}
</script>
```

---

## 7. Actionable implementation plan for the Vite/nginx/Express stack

1. **Move JSON-LD generation server-side.** Add a route-level JSON-LD builder in Express that runs for bot and human traffic alike, and inject it into the Vite `index.html` template **before** the app bundle executes. Cheapest correct option: prerender company and article routes (`vite-plugin-ssr`/`vite-prerender-plugin`, or a Puppeteer prerender behind an nginx `User-Agent`/`Accept` check for `Googlebot`, `Bingbot`, social crawlers).
2. **If you must inject client-side**, do it in a top-level route effect that runs before first paint, use the exact `document.head.appendChild` pattern from Google's doc, and **never** gate it behind an async data fetch that can fail. Verify with the **URL** input of the Rich Results Test **and** with the URL Inspection tool's rendered-HTML view.
3. **Ship one `@graph` per route**, with stable `@id` roots: `https://orewire.com/#organization` and `#website` emitted site-wide (from the nginx/Express shell template), plus route-specific nodes referencing them by `@id`.
4. **Homepage:** `NewsMediaOrganization` + `WebSite` + `WebPage`. Wire `masthead`, `ethicsPolicy`, `correctionsPolicy`, `ownershipFundingInfo` to real pages — these are Trust Project signals and only help if the URLs resolve.
5. **Company pages:** `Corporation` + `BreadcrumbList` + `WebPage(mainEntity → Corporation)`. Populate `tickerSymbol` as `"EXCHANGE MIC: TICKER"`, prefer `iso6523Code` over `leiCode`/`duns`, and `sameAs` → SEDAR+, `wikidata.org`, exchange profile, LinkedIn.
6. **Article pages:** `NewsArticle` + `BreadcrumbList` + `WebPage`, with `author` → `Person` (`@id`), `publisher` → `{ "@id": …/#organization }`, and `about`/`mentions` linking to `Corporation` and `Place` nodes.
7. **Delete** `WebSite.potentialAction` → `SearchAction` and any `nositelinkssearchbox` meta.
8. **Add `Dataset`** on commodity-price and filings/assay data pages — it will not affect Google Search, but it is the only route into **Dataset Search**.
9. **Keep `FAQPage`** for non-Google consumers, but expect nothing from Google. Do not invest further in FAQ markup for SERP purposes.
10. **Monitoring:** note that FAQ/practice-problem rich-result reports are gone from Search Console (June 2026 / January 2026). Validate semantic-only types by inspecting **rendered HTML** rather than the Rich Results Test.
11. **Do not** build an llms.txt or "AI schema" strategy on structured data — Google's own 2026-07-10 guidance says it doesn't use llms.txt and that structured data is not required for generative AI search.

---

*Sources are hyperlinked inline above. Where a fact rests on industry reporting rather than a Google or schema.org primary source, it is explicitly marked. Full source list with authority levels accompanies this digest in the structured output.*
