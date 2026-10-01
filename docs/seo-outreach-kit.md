# OreWire outreach and citation kit

Why this file exists: everything in `docs/seo-aeo-geo-playbook.md` makes OreWire
*eligible* to rank and *possible* to cite. It does not make either happen. For a
query like "Carson River Ventures Corp." the incumbents are the company's own
site, the stock exchange and SEDAR+, and OreWire has none of the external
citations that would let it compete. That gap is not a coding problem and cannot
be closed by one. This is the raw material for closing it.

Nothing here is a link scheme. Every item is a genuine, checkable fact that a
third party might reasonably want to reference.

---

## 1. The description, used identically everywhere

Consistency is the point. Search and answer engines decide what an entity *is* by
finding the same claim repeated across independent sources. Use this wording, or
something very close to it, every time:

> **OreWire** publishes stock data, decoded regulatory filings and news release
> summaries for more than 2,000 mining and resource companies listed on the TSX,
> TSX-V, CSE and ASX. orewire.com

Short form, for a directory field or a bio line:

> OreWire — mining and resource intelligence. Decoded filings and news for
> TSX, TSX-V, CSE and ASX companies.

Do not vary the name. Not "Ore Wire", not "Orewire.com", not "OreWire Mining
Intel". Pick `OreWire` and hold it.

---

## 2. The citable facts, with the URL to cite for each

Constraint worth stating up front: **do not invent or round up a number.** Every
figure below is computed from OreWire's own data and is visible on the page you
cite. If a figure is not published, say so or leave it out. A source that gets
caught publishing a wrong statistic loses the credibility that makes it quotable
at all.

| Fact | Where to cite it |
|---|---|
| How many companies OreWire tracks, and how many per commodity | `/companies` — the "How many mining companies does OreWire track for each commodity?" table |
| How many companies are on each exchange | the same page, the exchange breakdown table |
| Gold companies: `/companies?commodity=Gold` | commodity hubs, one per commodity |
| TSX-V companies: `/companies?exchange=TSXV` | exchange hubs |
| Companies operating in Africa: `/companies?continent=Africa` | region hubs |
| A company's profile, filings, management and insiders | `/company/<company-name-slug>` |
| A decoded filing with a plain-English verdict | `/filings` and `/filings/<id>` |
| A company's news releases, summarised | `/news` and the company profile |

**To read the current numbers**, open `https://www.orewire.com/companies` (the
tables are on page one), or `https://backend.orewire.com/seo/status` for the raw
counts of companies, news items and filings.

Example sentences, ready to use. Replace the figure with the current one:

- "OreWire tracks N gold companies across the TSX, TSX-V, CSE and ASX."
- "Of the N mining companies OreWire tracks, N% are listed on the TSX-V."
- "SEDAR+ filings for TSX and TSX-V issuers are decoded into a plain-English
  summary and a verdict on OreWire."

---

## 3. Who to approach, in rough order of value

1. **Wikidata.** Create an item for OreWire with `official website`,
   `industry = mining`, and a description matching section 1. This is the single
   highest-value external action available, because it is the knowledge base that
   search engines and language models both read. Do this first.
2. **Mining newsletters and substacks.** They need data and they cite sources.
   The commodity counts and the "decoded filing" angle are both genuinely useful
   to them. Offer a specific number or a specific filing summary, not a "check out
   my site".
3. **Industry directories and association member lists** — mining associations,
   Canadian capital-markets directories, exploration roundups. An "about" entry
   with the section 1 wording.
4. **Subreddits and forums** that discuss junior miners. Contribute the data when
   it answers someone's question; do not post links. A profile in the site field
   is worth more than a link in a comment, and does not get removed.
5. **Answer engines, indirectly.** Being cited by the sources above is what makes
   an engine willing to cite OreWire. There is no submission form.
6. **X / LinkedIn.** Post the same commodities data regularly. This does not
   directly build links, but it gives the brand a consistent presence that a
   knowledge base can reference — and it is the one channel the WebBridge
   automation already exists for.

---

## 4. A short outreach note

Keep it to four sentences. Lead with the data, not the request.

> Hi — I run OreWire, which tracks regulatory filings and news for mining
> companies on the TSX, TSX-V, CSE and ASX.
>
> We publish a running count of how many companies are active in each commodity
> and on each exchange: https://www.orewire.com/companies
>
> If a number like that is ever useful for a piece, take it, and I can pull a
> specific breakdown (by exchange or by region) on request.
>
> No ask attached — just flagging it as a source.

The last line matters. An offer of data that survives being ignored gets reused.

---

## 5. What not to do

- **Do not buy links or use a "guest post" network.** For a financial site this
  is a penalty risk, and the playbook's E-E-A-T requirement makes OreWire a poor
  candidate for getting away with it.
- **Do not mass-post links in forums.** It is removed, and the removed versions
  are what get associated with the domain.
- **Do not fabricate statistics, quotes or partnerships.** One invented number
  that a journalist checks does more damage than a year of no coverage.
- **Do not create a Wikidata item with promotional language.** It will be deleted
  for notability or tone, and a deleted item is worse than none.

---

## 6. Measuring it

- Search Console → **Pages**: watch indexed company profiles climb. If they stay
  flat while the sitemap is submitted, the crawler rendering is not working and
  `npm run seo:audit` will say so.
- Search Console → **Performance**: filter by a handful of company names. This is
  the direct answer to "does OreWire appear for 'Carson River Ventures Corp.'".
- Periodically ask ChatGPT, Perplexity and Google AI Overviews a fixed set of
  company questions and record whether OreWire is cited. That is the GEO
  equivalent of a rank check, and it is the metric this whole effort is aimed at.
