# Lead enrichment + Listmonk pipeline — batch 2026-11-12

Input: two CSVs the OreWire team dropped in `Downloads`:

| file | rows | with email |
|---|---|---|
| `issuer_leads_new_2026-11-12.csv` | 1150 | 79 |
| `issuer_leads_new_2026-11-12_with_email.csv` | 79 | 79 (subset of the above) |

So 1071 leads had no address. This folder contains everything needed to find
them, mail-safe, and load the result into Listmonk so the existing
Listmonk → console proxy → Postal chain sends at **45/day (5 per mailbox)**.

## Open-source tooling

The tools were cloned to `C:\Users\Azeem\Desktop\email-finder\`:

| tool | repo | role here |
|---|---|---|
| **EmailHarvester** | `maldevel/EmailHarvester` | search-engine email harvest per domain (cloned; tried, but Google/Bing scraping hung from this network, so it is not in the run path) |
| **EmailFinder** | `Josue87/EmailFinder` | same idea, `pip install emailfinder` CLI (cloned for reference) |
| **MailFinder** | `mishakorzik/MailFinder` | name → email + SMTP validator (cloned; its validator needs Tor, we use Reacher instead) |
| **Reacher** | `reacherhq/backend` | **the verifier actually used** — already running inside the email stack on the VPS, reachable through `POST /api/verify-email` on the console because laptop ISPs block port 25 |

The pipeline scripts in this folder are the glue: a focused crawler (issuer
governance/IR pages are where these addresses are published), the name-pattern
matcher, and the Listmonk importer.

## Stages

```
prep_leads.py     CSV -> leads.json / domains.json   (adds domain, segment, drops nothing yet)
enrich_crawl.mjs  569 company sites -> crawl_results.jsonl
                    home + up to 10 pages, priority /contact /board /governance
                    /management /investors, de-obfuscates "[at]", same-site only
enrich_match.mjs  crawl + names -> enriched.json / enriched.csv
                    ladder: published > crawled (exact) > crawled (fuzzy)
                            > verified pattern (Reacher "safe") > company inbox
import_listmonk.mjs  subscribers -> batch lists (AU/CA Leads|Research|IR|Catchall 11-12)
create_campaigns.mjs 4 step-1 campaigns from the October copy, drafts by default
```

Confidence ladder written into `Email Found By` / `Email Confidence`:

| source | meaning |
|---|---|
| `published` | came in the source CSV |
| `crawled` | exact person match on the company's own pages |
| `crawled-fuzzy` | surname + first name/initial found in an address on the site |
| `verified-pattern` | guessed pattern, Reacher confirmed the mailbox exists |
| `generic` / `generic-csv` | company inbox (ir@ > contact@ > info@), one per company |
| `catchall-skip` | domain accepts any mailbox so nothing can be verified — **not mailed** |

## Commands

```powershell
$py = "C:\Users\Azeem\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\python\python.exe"

& $py prep_leads.py
node  enrich_crawl.mjs --concurrency 14
node  enrich_match.mjs --verify --max-probes 1 --concurrency 6 --budget 400 --skip-with-generic
node  import_listmonk.mjs --dry-run
node  import_listmonk.mjs
node  create_campaigns.mjs          # drafts
node  create_campaigns.mjs --start  # or start from the Listmonk UI
```

## Pacing / what happens after a campaign starts

Listmonk sends each message to the console SMTP proxy (`console:2526`); the proxy
rewrites the From header to the next mailbox in rotation, enforces
`5 sends/day/mailbox` (9 mailboxes = 45/day) and re-queues anything above the cap
for the next day. So starting a 600-recipient campaign fills the console queue and
drains it at 45/day; nothing else needs to be scheduled.

Opens/clicks are tracked on `track.<sending-domain>` and appear in the console's
**Sent & opens** table (see `email-stack/DEPLOY.md` §3b for that chain).

## Files (kept out of git: these contain personal data)

`leads.json`, `crawl_results.jsonl`, `enriched.csv`, `enriched.json`,
`verify_cache.json`, `import_report.json`, `campaigns_report.json`,
`listmonk-cookies.json`.
