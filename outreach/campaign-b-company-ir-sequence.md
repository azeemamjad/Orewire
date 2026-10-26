# Campaign B â€” Company IR (Week 1 sequence)

**List:** AU Company IR (195 leads)
**Merge fields:** `{{ .Subscriber.FirstName }}` Â· `{{ .Subscriber.Attribs.company_name }}` Â· `{{ .Subscriber.Attribs.title }}`

## Subjects (test all 3 â€” use Listmonk's A/B variations on the campaign)
1. Peer filings without the chase
2. {{ .Subscriber.FirstName }}, a watchlist for your IR desk
3. How peers are announcing this week

## Step 1 â€” Body variant A (loaded as draft: "B1 - Company IR - Peer filings without the chase (Step 1A)")
```
Hi {{ .Subscriber.FirstName }},

I work on OreWire. We publish decoded filings and news summaries for 2,000+ mining companies on the TSX, TSX-V, CSE and ASX.

For IR and corp-dev teams, the useful part is a peer watchlist: see what comparable issuers filed or released, without refreshing SEDAR all day.

Would a peer-alert feed be useful at {{ .Subscriber.Attribs.company_name }}?

```

## Step 1 â€” Body variant B
```
Hi {{ .Subscriber.FirstName }},

When a peer drops a resource update or financing, most IR desks hear about it late.

OreWire tracks filings and news across Canadian and Australian mining listings and pushes short summaries to a watchlist you choose.

Worth 2 minutes for {{ .Subscriber.Attribs.company_name }}, or should I leave you alone?
```

## Step 2 (Day 3 â€” follow-up, blank subject to stay in thread)
```
Hi {{ .Subscriber.FirstName }},

Typical setup for a junior IR lead:
- your own issuer on a private watchlist
- 10-20 peers on the same board / commodity
- alerts when they file or news-release

Happy to build a sample peer list around {{ .Subscriber.Attribs.company_name }} if you share a few tickers you already track.

```

## Step 3 (Day 7)
```
Hi {{ .Subscriber.FirstName }},

Not pitching a press-release wire or an IR agency. OreWire is market intelligence: filings + news summaries so you stay current on peers and your own market.

If timing is bad, no worries. If useful, reply and I'll send a free look.

```

## Step 4 â€” Breakup (Day 12)
```
Hi {{ .Subscriber.FirstName }},

Last note from me. If peer filings and alerts would help the IR desk at {{ .Subscriber.Attribs.company_name }}, reply "interested" and I'll set you up.

Otherwise I'll assume it's a pass. Thanks for reading.

```

