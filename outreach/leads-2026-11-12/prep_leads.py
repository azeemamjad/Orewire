#!/usr/bin/env python
"""Turn the 2026-11-12 lead CSV into JSON for the enrichment pipeline."""
import json
import re
from pathlib import Path

import pandas as pd

SRC = Path(r"C:\Users\Azeem\Downloads\issuer_leads_new_2026-11-12.csv")
OUT = Path(r"C:\Users\Azeem\Desktop\Orewire\outreach\leads-2026-11-12")


def url_domain(url: str) -> str:
    u = (url or "").strip().lower()
    u = re.sub(r"^https?://", "", u)
    u = re.sub(r"^www\.", "", u)
    u = u.split("/")[0].split("?")[0]
    return u if "." in u else ""


def segment(title: str, notes: str) -> str:
    t = f"{title} {notes}".lower()
    if re.search(r"analyst|research|portfolio|fund manager|investment|\bcio\b|equity|capital markets|institutional|asset management|wealth", t):
        return "research"
    if re.search(r"\bceo\b|chief executive|investor relations|\bir\b|corporate development|founder|managing director|managing partner|vice president|\bvp\b|head of|director|partner|president|general manager|secretary|chair", t):
        return "ir"
    return "other"


df = pd.read_csv(SRC, dtype=str).fillna("")
leads = []
for i, r in df.iterrows():
    website = r["Company Website"].strip()
    leads.append({
        "idx": int(i),
        "first": r["First Name"].strip(),
        "last": r["Last Name"].strip(),
        "title": r["Title"].strip(),
        "company": r["Company"].strip(),
        "ticker": r["Ticker"].strip(),
        "exchange": r["Exchange"].strip(),
        "country": r["Country"].strip(),
        "city": r["City"].strip(),
        "website": website,
        "domain": url_domain(website),
        "existing_email": r["Email"].strip().lower(),
        "generic_email": r["Generic Email"].strip().lower(),
        "phone": r["Phone"].strip(),
        "linkedin": r["LinkedIn"].strip(),
        "segment": segment(r["Title"], r["Notes"]),
        "notes": r["Notes"].strip(),
    })

domains = sorted({l["domain"] for l in leads if l["domain"]})
(OUT / "leads.json").write_text(json.dumps(leads, indent=1), encoding="utf-8")
(OUT / "domains.json").write_text(json.dumps(domains, indent=1), encoding="utf-8")

print(f"leads={len(leads)} with_email={sum(1 for l in leads if l['existing_email'])} domains={len(domains)}")
print("segment mix:", pd.Series([l["segment"] for l in leads]).value_counts().to_dict())
print("exchange mix:", pd.Series([l["exchange"] for l in leads]).value_counts().to_dict())
