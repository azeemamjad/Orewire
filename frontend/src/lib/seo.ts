import { useEffect } from "react";

/**
 * Client side head management for the OreWire SPA.
 *
 * Two audiences are served here:
 *
 *   1. Crawlers that DO execute JavaScript. Their HTML is whatever the SPA
 *      renders, so the title, canonical and structured data have to be correct
 *      after hydration, not just in the served shell.
 *   2. Real users, for whom a correct tab title and share preview matter.
 *
 * Crawlers that do NOT execute JavaScript never reach this code. They are served
 * fully rendered HTML by the backend instead; see Server/lib/seo/.
 *
 * Everything this module writes is tagged with data-orewire-seo so the next page
 * can clear it and pages never accumulate stale tags.
 */

export const SITE_ORIGIN = "https://www.orewire.com";

const MANAGED = "data-orewire-seo";

export type JsonLdNode = Record<string, unknown>;

export interface SeoConfig {
  title: string;
  description?: string | null;
  /** Site relative path, e.g. `/company/carson-river-ventures-corp`. */
  canonicalPath?: string | null;
  /** Absolute URL for og:image. */
  image?: string | null;
  ogType?: "website" | "article" | "profile";
  robots?: string;
  jsonLd?: JsonLdNode[];
}

/**
 * News items whose summary is shorter than this are treated as thin.
 *
 * Mirrors THIN_SUMMARY_CHARS in Server/lib/seo/util.js — keep the two equal, or
 * the crawler and SPA views will disagree about whether a page is indexable.
 * Verified in production: six of six sampled news rows had a summary that was a
 * bare date or the title plus the publisher name, and there are ~131,000 of them.
 */
export const THIN_SUMMARY_CHARS = 200;

/** The same length test as hasSubstantiveSummarySql() on the backend. */
export function hasSubstantiveSummary(
  item: { summary?: string | null; description?: string | null } | null | undefined,
): boolean {
  if (!item) return false;
  const text = String(item.summary || item.description || "").trim();
  return text.length >= THIN_SUMMARY_CHARS;
}

export function absoluteUrl(pathname?: string | null): string {
  if (!pathname) return `${SITE_ORIGIN}/`;
  if (/^https?:\/\//i.test(pathname)) return pathname;
  return `${SITE_ORIGIN}${pathname.startsWith("/") ? "" : "/"}${pathname}`;
}

/** Mirrors Server/lib/seo/util.js slugify so links and canonicals agree. */
export function slugify(value: string | null | undefined): string {
  return String(value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** Canonical company path. The name is in the URL on purpose (see the backend). */
export function companyPath(name: string | null | undefined, fallback?: string | null): string {
  const slug = slugify(name);
  if (slug) return `/company/${slug}`;
  return `/company/${fallback || "unknown"}`;
}

/** Shape accepted by the news URL helpers. */
export interface NewsSlugInput {
  id?: number | null;
  title?: string | null;
  link?: string | null;
}

/**
 * Canonical news slug: `<title-slug>-<id>`.
 *
 * Replaces the old `encodeURIComponent(link || title)` form, which produced
 * URLs like `/news/https%3A%2F%2F...` that carry no keywords and cannot be used
 * as a citation target. Mirrors newsUrl() in Server/lib/seo/util.js.
 */
export function newsSlug(item: NewsSlugInput): string {
  const titleSlug = slugify(item.title);
  const id = item.id != null ? String(item.id) : "";
  if (id && titleSlug) return `${titleSlug}-${id}`;
  if (id) return id;
  if (titleSlug) return titleSlug;
  return item.link ? encodeURIComponent(item.link) : "";
}

export function newsPath(item: NewsSlugInput): string {
  const slug = newsSlug(item);
  return slug ? `/news/${slug}` : "/news";
}

/**
 * Split a `/news/:slug` param into an id (when the slug ends in `-<digits>`) and
 * the legacy link-or-title value, so previously shared links keep resolving.
 */
export function parseNewsSlug(raw: string | null | undefined): { id: number | null; legacy: string } {
  const slug = String(raw ?? "");
  const match = /-(\d+)$/.exec(slug);
  if (match) return { id: Number(match[1]), legacy: slug };
  // newsSlug() emits a bare id when an item has an id but no usable title, so a
  // purely numeric slug has to be read as an id or that URL resolves to nothing.
  if (/^\d+$/.test(slug)) return { id: Number(slug), legacy: slug };
  return { id: null, legacy: slug };
}

export function truncate(value: string | null | undefined, max = 155): string {
  const clean = String(value ?? "")
    .replace(/\s+/g, " ")
    .trim();
  if (clean.length <= max) return clean;
  const cut = clean.slice(0, max);
  const lastSpace = cut.lastIndexOf(" ");
  return `${(lastSpace > max * 0.6 ? cut.slice(0, lastSpace) : cut).replace(/[,;:.\-]$/, "")}…`;
}

function clearManaged() {
  document.head.querySelectorAll(`[${MANAGED}]`).forEach((el) => el.remove());
}

function upsertMeta(attr: "name" | "property", key: string, content?: string | null) {
  if (!content) return;
  let el = document.head.querySelector<HTMLMetaElement>(`meta[${attr}="${key}"]`);
  if (!el) {
    el = document.createElement("meta");
    el.setAttribute(attr, key);
    el.setAttribute(MANAGED, "1");
    document.head.appendChild(el);
  }
  el.setAttribute("content", content);
}

function upsertCanonical(href: string) {
  let el = document.head.querySelector<HTMLLinkElement>('link[rel="canonical"]');
  if (!el) {
    el = document.createElement("link");
    el.setAttribute("rel", "canonical");
    el.setAttribute(MANAGED, "1");
    document.head.appendChild(el);
  }
  el.setAttribute("href", href);
}

function writeJsonLd(nodes: JsonLdNode[]) {
  document.head
    .querySelectorAll(`script[type="application/ld+json"][${MANAGED}]`)
    .forEach((el) => el.remove());
  if (!nodes.length) return;
  const script = document.createElement("script");
  script.type = "application/ld+json";
  script.setAttribute(MANAGED, "1");
  script.textContent = JSON.stringify({ "@context": "https://schema.org", "@graph": nodes });
  document.head.appendChild(script);
}

/** Apply a full head configuration. Safe to call on every render. */
export function applySeo(config: SeoConfig) {
  if (typeof document === "undefined") return;
  const {
    title,
    description,
    canonicalPath,
    image,
    ogType = "website",
    robots = "index, follow, max-image-preview:large, max-snippet:-1",
    jsonLd = [],
  } = config;

  clearManaged();
  document.title = title;

  const url = absoluteUrl(canonicalPath);
  upsertCanonical(url);

  upsertMeta("name", "robots", robots);
  upsertMeta("name", "description", description || undefined);

  upsertMeta("property", "og:type", ogType);
  upsertMeta("property", "og:site_name", "OreWire");
  upsertMeta("property", "og:title", title);
  upsertMeta("property", "og:description", description || undefined);
  upsertMeta("property", "og:url", url);

  upsertMeta("name", "twitter:card", image ? "summary_large_image" : "summary");
  upsertMeta("name", "twitter:title", title);
  upsertMeta("name", "twitter:description", description || undefined);

  if (image) {
    upsertMeta("property", "og:image", image);
    upsertMeta("name", "twitter:image", image);
  }

  writeJsonLd(jsonLd);
}

/** React hook wrapper. Re-applies whenever the serialised config changes. */
export function useSeo(config: SeoConfig, deps: unknown[] = []) {
  const key = JSON.stringify({
    t: config.title,
    d: config.description,
    c: config.canonicalPath,
    r: config.robots,
  });
  useEffect(() => {
    applySeo(config);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, ...deps]);
}

// ---------------------------------------------------------------------------
// Structured data builders (mirror Server/lib/seo/schema.js)
// ---------------------------------------------------------------------------

export const ORG_ID = `${SITE_ORIGIN}/#organization`;
export const SITE_ID = `${SITE_ORIGIN}/#website`;

export function organizationLd(): JsonLdNode {
  return {
    "@type": "Organization",
    "@id": ORG_ID,
    name: "OreWire",
    url: `${SITE_ORIGIN}/`,
    // Mirrors the backend node in Server/lib/seo/schema.js. Keep the two in step.
    email: "hello@orewire.com",
    contactPoint: {
      "@type": "ContactPoint",
      contactType: "customer support",
      email: "hello@orewire.com",
      url: `${SITE_ORIGIN}/contact`,
    },
  };
}

export function websiteLd(): JsonLdNode {
  return { "@type": "WebSite", "@id": SITE_ID, url: `${SITE_ORIGIN}/`, name: "OreWire", publisher: { "@id": ORG_ID } };
}

export function breadcrumbLd(items: { name: string; path: string }[]): JsonLdNode {
  return {
    "@type": "BreadcrumbList",
    itemListElement: items.map((item, i) => ({
      "@type": "ListItem",
      position: i + 1,
      name: item.name,
      item: absoluteUrl(item.path),
    })),
  };
}

export function corporationLd(company: {
  name: string;
  ticker?: string | null;
  exchange?: string | null;
  description?: string | null;
  sector?: string | null;
  headquarters?: string | null;
  website?: string | null;
}): JsonLdNode {
  const url = absoluteUrl(companyPath(company.name));
  const node: JsonLdNode = {
    "@type": "Corporation",
    "@id": `${url}#corporation`,
    name: company.name,
    url,
  };
  if (company.ticker) node.tickerSymbol = company.ticker;
  if (company.exchange) node.exchange = company.exchange;
  if (company.description) node.description = truncate(company.description, 500);
  if (company.sector) node.industry = company.sector;
  if (company.headquarters) node.address = { "@type": "PostalAddress", addressLocality: company.headquarters };
  if (company.website) node.sameAs = [company.website];
  return node;
}

export function faqLd(items: { question: string; answer: string }[]): JsonLdNode | null {
  if (!items.length) return null;
  return {
    "@type": "FAQPage",
    mainEntity: items.map((qa) => ({
      "@type": "Question",
      name: qa.question,
      acceptedAnswer: { "@type": "Answer", text: qa.answer },
    })),
  };
}

export function newsArticleLd(item: {
  id?: number | null;
  title: string;
  pub_date?: string | null;
  created_at?: string | null;
  summary?: string | null;
  description?: string | null;
  source?: string | null;
  link?: string | null;
  company_name?: string | null;
}): JsonLdNode {
  const url = absoluteUrl(newsPath({ id: item.id, title: item.title, link: item.link }));
  const node: JsonLdNode = {
    "@type": "NewsArticle",
    "@id": `${url}#article`,
    headline: item.title,
    url,
    mainEntityOfPage: url,
    publisher: { "@id": ORG_ID },
    isPartOf: { "@id": SITE_ID },
    inLanguage: "en",
  };
  const published = item.pub_date || item.created_at;
  if (published) node.datePublished = new Date(published).toISOString();
  const modified = item.created_at || item.pub_date;
  if (modified) node.dateModified = new Date(modified).toISOString();
  const body = item.summary || item.description;
  if (body) node.description = truncate(body, 300);
  if (item.source) node.sourceOrganization = { "@type": "Organization", name: item.source };
  if (item.link) node.sameAs = [item.link];
  if (item.company_name) node.about = { "@type": "Corporation", name: item.company_name };
  return node;
}
