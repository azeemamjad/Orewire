'use strict';

/**
 * schema.org JSON-LD builders (https://schema.org, https://json-ld.org).
 *
 * Everything is emitted as a single `@graph` per page so entities can reference
 * each other with stable `@id` values. That graph shape is what search engines
 * and LLM crawlers use to resolve "which organisation, which ticker, which page".
 */

const { siteOrigin, absoluteUrl, slugify, isoDate, isoDay, compactNumber } = require('./util');

const ORG_ID = () => `${siteOrigin()}/#organization`;
const SITE_ID = () => `${siteOrigin()}/#website`;

function organizationNode() {
  return {
    '@type': 'Organization',
    '@id': ORG_ID(),
    name: 'OreWire',
    alternateName: 'OreWire Mining Intelligence',
    url: siteOrigin() + '/',
    description:
      'OreWire publishes stock prices, decoded regulatory filings and news release summaries for mining and resource companies listed on the TSX, TSX-V, CSE and ASX.',
    // The public contact address, taken from the Contact page, Terms, Privacy and
    // the outbound email templates rather than guessed. No `logo` or `sameAs` is
    // set because no first-party asset or verified social profile is referenced
    // anywhere in the codebase, and a broken logo URL is worse than none.
    email: 'hello@orewire.com',
    contactPoint: {
      '@type': 'ContactPoint',
      contactType: 'customer support',
      email: 'hello@orewire.com',
      url: siteOrigin() + '/contact',
    },
    knowsAbout: [
      'mining stocks',
      'mineral exploration',
      'regulatory filings',
      'SEDAR+',
      'junior mining companies',
      'resource investing',
    ],
  };
}

function websiteNode() {
  return {
    '@type': 'WebSite',
    '@id': SITE_ID(),
    url: siteOrigin() + '/',
    name: 'OreWire',
    publisher: { '@id': ORG_ID() },
    inLanguage: 'en',
  };
}

/**
 * Corporation node for a company page. This is the single most useful piece of
 * structured data on the site: it tells an answer engine that this URL is the
 * canonical OreWire page for a named public company and its ticker.
 */
function corporationNode(company) {
  const url = absoluteUrl(`/company/${slugify(company.name)}`);
  const node = {
    '@type': 'Corporation',
    '@id': url + '#corporation',
    name: company.name,
    url,
    tickerSymbol: company.ticker || undefined,
    exchange: company.exchange || undefined,
  };

  if (company.description) {
    node.description = String(company.description).replace(/\s+/g, ' ').trim().slice(0, 500);
  }

  if (company.sector) node.industry = company.sector;

  // sameAs is an entity disambiguation signal: it tells a search or answer
  // engine which other URLs describe the same listed company. Only URLs whose
  // shape is already proven by this codebase are added; an invented URL that
  // 404s is worse than no link at all.
  const sameAs = [];
  if (company.website) sameAs.push(String(company.website));
  if (String(company.exchange || '').toUpperCase() === 'ASX' && company.ticker) {
    // Same pattern the ASX filings scraper uses (lib/scraper/asx/filings-scraper.js).
    sameAs.push(
      `https://www.asx.com.au/markets/trade-our-cash-market/announcements.${String(company.ticker).toLowerCase()}`
    );
  }
  if (sameAs.length) node.sameAs = sameAs;

  if (company.headquarters) {
    node.address = {
      '@type': 'PostalAddress',
      addressLocality: company.headquarters,
    };
  }

  if (company.market_cap || company.shares_outstanding) {
    node.additionalProperty = [];
    const cap = compactNumber(company.market_cap);
    if (cap) {
      node.additionalProperty.push({
        '@type': 'PropertyValue',
        name: 'market capitalisation',
        value: cap,
      });
    }
    const shares = compactNumber(company.shares_outstanding);
    if (shares) {
      node.additionalProperty.push({
        '@type': 'PropertyValue',
        name: 'shares outstanding',
        value: shares,
      });
    }
  }

  // Populated by the caller when the company has aggregated news.
  if (company.subjectOf && company.subjectOf.length) {
    node.subjectOf = company.subjectOf;
  }

  return stripUndefined(node);
}

function breadcrumbNode(items) {
  return {
    '@type': 'BreadcrumbList',
    '@id': absoluteUrl(items[items.length - 1].path) + '#breadcrumb',
    itemListElement: items.map((item, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      name: item.name,
      item: absoluteUrl(item.path),
    })),
  };
}

function newsArticleNode(item) {
  const url = absoluteUrl(`/news/${slugify(item.title)}-${item.id}`);
  const node = {
    '@type': 'NewsArticle',
    '@id': url + '#article',
    headline: item.title,
    url,
    datePublished: isoDate(item.pub_date || item.created_at),
    dateModified: isoDate(item.created_at || item.pub_date),
    articleSection: item.category || undefined,
    description: item.summary || item.description || undefined,
    publisher: { '@id': ORG_ID() },
    isPartOf: { '@id': SITE_ID() },
    inLanguage: 'en',
    mainEntityOfPage: url,
  };
  if (item.source) {
    node.sourceOrganization = { '@type': 'Organization', name: item.source };
  }
  if (item.link) {
    node.sameAs = [item.link];
  }
  if (item.company_name) {
    node.about = {
      '@type': 'Corporation',
      name: item.company_name,
      ...(item.ticker ? { tickerSymbol: item.ticker } : {}),
    };
  }
  return stripUndefined(node);
}

/**
 * FAQPage markup. Google retired FAQ *rich results* for most sites in 2023, but
 * the markup is still parsed and is one of the cleanest ways to hand an answer
 * engine a question/answer pair, so it is kept for AEO rather than rich results.
 */
function faqNode(qas) {
  if (!qas || !qas.length) return null;
  return {
    '@type': 'FAQPage',
    mainEntity: qas.map((qa) => ({
      '@type': 'Question',
      name: qa.question,
      acceptedAnswer: { '@type': 'Answer', text: qa.answer },
    })),
  };
}

/**
 * Filing page node.
 *
 * The original regulatory document is the authoritative source, so it is
 * attached as sameAs and isBasedOn. That does two things: it lets an answer
 * engine verify the claim against the primary source, and it credits SEDAR+ or
 * ASX rather than appearing to compete with them.
 */
function filingNode(filing) {
  const url = absoluteUrl(`/filings/${filing.id}`);
  const companyName = filing.company_canonical_name || filing.company_name;
  const label = `${companyName || ''} ${filing.filing_type || filing.commodity || 'filing'}`.trim();

  const node = {
    '@type': 'DigitalDocument',
    '@id': url + '#document',
    name: label,
    url,
    datePublished: isoDate(filing.created_at),
    description: filing.summary || undefined,
    publisher: { '@id': ORG_ID() },
    about: companyName
      ? {
          '@type': 'Corporation',
          name: companyName,
          ...(filing.company_ticker ? { tickerSymbol: filing.company_ticker } : {}),
          ...(filing.company_exchange ? { exchange: filing.company_exchange } : {}),
        }
      : undefined,
    inLanguage: 'en',
  };

  if (filing.source_url && /^https?:\/\//i.test(String(filing.source_url))) {
    node.sameAs = [String(filing.source_url)];
    node.isBasedOn = String(filing.source_url);
  }

  return stripUndefined(node);
}

function datasetNode({ name, description, path, temporalCoverage, keywords }) {
  return stripUndefined({
    '@type': 'Dataset',
    '@id': absoluteUrl(path) + '#dataset',
    name,
    description,
    url: absoluteUrl(path),
    creator: { '@id': ORG_ID() },
    isAccessibleForFree: true,
    temporalCoverage,
    keywords,
  });
}

function stripUndefined(node) {
  if (Array.isArray(node)) return node.map(stripUndefined);
  if (node && typeof node === 'object') {
    const out = {};
    for (const [key, value] of Object.entries(node)) {
      if (value === undefined || value === null) continue;
      if (Array.isArray(value) && value.length === 0) continue;
      out[key] = stripUndefined(value);
    }
    return out;
  }
  return node;
}

/** Serialise a list of nodes as one `@graph` script tag. */
function graphScript(nodes) {
  const graph = nodes.filter(Boolean);
  if (!graph.length) return '';
  const payload = JSON.stringify({ '@context': 'https://schema.org', '@graph': graph });
  return `<script type="application/ld+json">${payload
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026')}</script>`;
}

module.exports = {
  ORG_ID,
  SITE_ID,
  organizationNode,
  websiteNode,
  corporationNode,
  breadcrumbNode,
  newsArticleNode,
  filingNode,
  faqNode,
  datasetNode,
  graphScript,
  stripUndefined,
};
