# Campaign A â€” Research / Analysts (Week 1 sequence)

**List:** AU Research Analysts (38 leads)
**Merge fields:** `{{ .Subscriber.FirstName }}` Â· `{{ .Subscriber.Attribs.company_name }}` Â· `{{ .Subscriber.Attribs.title }}`

## Subjects (test all 3 â€” use Listmonk's A/B variations on the campaign)
1. Filing noise on the TSX-V
2. Quick question, {{ .Subscriber.FirstName }}
3. Mining filings without the grind

## Step 1 â€” Body variant A (loaded as draft: "A1 - Research - Filing noise on the TSX-V (Step 1A)")
```
Hi {{ .Subscriber.FirstName }},

I work on OreWire. We decode TSX, TSX-V, CSE and ASX mining filings and news for 2,000+ issuers so research teams don't have to dig through SEDAR and ASX each morning.

Curious if {{ .Subscriber.Attribs.company_name }} still pulls filings the hard way, or if a watchlist + alert feed would save your team time?

Happy to send a 2-minute walkthrough if useful.

```

## Step 1 â€” Body variant B
```
Hi {{ .Subscriber.FirstName }},

Quick one for someone covering mining names.

OreWire summarizes regulatory filings and news across TSX/TSX-V/CSE/ASX juniors and producers. Built for analysts and PMs who need the signal without living in SEDAR.

Worth a look for {{ .Subscriber.Attribs.company_name }}, or not a priority right now?

```

## Step 2 (Day 3 â€” follow-up, blank subject to stay in thread)
```
Hi {{ .Subscriber.FirstName }},

One concrete example: OreWire turns a messy material-change or exploration update into a short, readable summary, then pushes it to a watchlist you set.

If your coverage universe is mostly Canadian and Australian listings, that's usually where the time savings show up.

Want me to set a sample watchlist around a few tickers you follow?

```

## Step 3 (Day 7)
```
Hi {{ .Subscriber.FirstName }},

Most research teams I talk to either:
1. skim SEDAR/ASX manually, or
2. wait on a sell-side note that already moved.

OreWire sits in between: same-day filing summaries + alerts, without claiming to replace your model work.

If I should stop pinging you, just say so. Otherwise happy to send a free look.

```

## Step 4 â€” Breakup (Day 12)
```
Hi {{ .Subscriber.FirstName }},

I'll close the loop here. If filing summaries and watchlist alerts ever become useful for {{ .Subscriber.Attribs.company_name }}, reply "interested" and I'll send access.

Either way, good luck with the book.

```

