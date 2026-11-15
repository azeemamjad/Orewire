#!/usr/bin/env python
"""Profile the two 2026-11-12 issuer lead CSVs before enrichment."""
import json
import re
import sys
from pathlib import Path

import pandas as pd

WITH = Path(r"C:\Users\Azeem\Downloads\issuer_leads_new_2026-11-12_with_email.csv")
WITHOUT = Path(r"C:\Users\Azeem\Downloads\issuer_leads_new_2026-11-12.csv")
OUT = Path(r"C:\Users\Azeem\Desktop\Orewire\outreach\leads-2026-11-12")
OUT.mkdir(parents=True, exist_ok=True)

a = pd.read_csv(WITH, dtype=str).fillna("")
b = pd.read_csv(WITHOUT, dtype=str).fillna("")
for name, df in (("with_email", a), ("full", b)):
    print(f"== {name}: {len(df)} rows, cols={len(df.columns)}")

def has_email(df):
    return df["Email"].str.strip().str.contains("@", na=False)

print(f"with_email file: {has_email(a).sum()} rows with email")
print(f"full file: {has_email(b).sum()} rows with email / {(~has_email(b)).sum()} without")

key = ["First Name", "Last Name", "Company"]
a_keys = set(map(tuple, a[key].values))
b_keys = set(map(tuple, b[key].values))
print(f"with_email rows present in full file: {len(a_keys & b_keys)} / {len(a_keys)}")

missing = b[~has_email(b)].copy()
print(f"\nmissing-email rows: {len(missing)}")
print(f"  with Company Website: {(missing['Company Website'].str.strip() != '').sum()}")
print(f"  with Pattern Email (unverified): {(missing['Pattern Email (unverified)'].str.contains('@')).sum()}")
print(f"  with Generic Email: {(missing['Generic Email'].str.contains('@')).sum()}")
print(f"  distinct companies: {missing['Company'].nunique()}")

print("\nmissing by exchange:")
print(missing["Exchange"].value_counts().to_string())
print("\nmissing by country:")
print(missing["Country"].value_counts().to_string())
print("\nmissing sample:")
cols = ["First Name", "Last Name", "Title", "Company", "Ticker", "Exchange", "Company Website"]
print(missing[cols].head(12).to_string(index=False))

# Learn surname/pattern style from the rows that do have published emails.
known = b[has_email(b)].copy()
def local_part(e):
    return (e.split("@")[0] or "").strip().lower()

known["local"] = known["Email"].map(local_part)
def klass(row):
    f = re.sub(r"[^a-z]", "", row["First Name"].lower())
    l = re.sub(r"[^a-z]", "", row["Last Name"].lower())
    lp = row["local"]
    pats = {
        "first.last": f"{f}.{l}",
        "flast": f"{f[0]}{l}",
        "firstlast": f"{f}{l}",
        "first": f,
        "f.last": f"{f[0]}.{l}",
        "last": l,
        "first_last": f"{f}_{l}",
        "last.first": f"{l}.{f}",
    }
    for k, v in pats.items():
        if lp == v:
            return k
    return "other"
known["pattern"] = known.apply(klass, axis=1)
print("\nlocal-part pattern distribution (rows with published email):")
print(known["pattern"].value_counts().to_string())

# Domain from website
def dom(url):
    u = url.strip().lower()
    u = re.sub(r"^https?://", "", u)
    u = re.sub(r"^www\.", "", u)
    return u.split("/")[0]
b["domain"] = b["Company Website"].map(dom)
have_domain = b[b["domain"].str.contains(r"\.", na=False)]
print(f"\nrows with a website domain: {len(have_domain)} of {len(b)}")
print(f"missing-email rows with domain: {(missing['Company Website'].map(dom).str.contains(r'\.')).sum()}")

stats = {
    "full_rows": int(len(b)),
    "with_email": int(has_email(b).sum()),
    "missing_email": int(len(missing)),
    "missing_with_domain": int(missing["Company Website"].map(dom).str.contains(r"\.").sum()),
    "missing_with_pattern": int(missing["Pattern Email (unverified)"].str.contains("@").sum()),
    "missing_with_generic": int(missing["Generic Email"].str.contains("@").sum()),
    "missing_companies": int(missing["Company"].nunique()),
    "with_email_file_rows": int(len(a)),
    "pattern_dist": known["pattern"].value_counts().to_dict(),
}
(OUT / "profile.json").write_text(json.dumps(stats, indent=2), encoding="utf-8")
missing.to_csv(OUT / "missing_email_rows.csv", index=False)
print(f"\nwrote {OUT / 'profile.json'} and {OUT / 'missing_email_rows.csv'}")
