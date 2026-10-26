-- OreWire outreach - Week 1 Step 1 campaigns (DRAFTS - do not set running from local dev)
-- Merge syntax: {{ .Subscriber.FirstName }}, {{ .Subscriber.Attribs.company_name }}, {{ .Subscriber.Attribs.title }}

-- Campaign A: Research / Analysts
INSERT INTO campaigns (uuid, name, subject, from_email, body, content_type, status, type, messenger)
VALUES (
  gen_random_uuid(),
  'A1 - Research - Filing noise on the TSX-V (Step 1A)',
  'Filing noise on the TSX-V',
  'Azeem Amjad <hello@getorewire.co>',
  E'<p>Hi {{ .Subscriber.FirstName }},</p>\n<p>I work on OreWire. We decode TSX, TSX-V, CSE and ASX mining filings and news for 2,000+ issuers so research teams don''t have to dig through SEDAR and ASX each morning.</p>\n<p>Curious if {{ .Subscriber.Attribs.company_name }} still pulls filings the hard way, or if a watchlist + alert feed would save your team time?</p>\n<p>Happy to send a 2-minute walkthrough if useful.</p>\n<p>-- Azeem Amjad<br>OreWire</p>',
  'html', 'draft', 'regular', 'email'
);

INSERT INTO campaign_lists (campaign_id, list_id)
SELECT c.id, l.id FROM campaigns c, lists l
WHERE c.name = 'A1 - Research - Filing noise on the TSX-V (Step 1A)' AND l.name = 'AU Research Analysts';

-- Campaign B: Company IR
INSERT INTO campaigns (uuid, name, subject, from_email, body, content_type, status, type, messenger)
VALUES (
  gen_random_uuid(),
  'B1 - Company IR - Peer filings without the chase (Step 1A)',
  'Peer filings without the chase',
  'Azeem Amjad <hello@getorewire.co>',
  E'<p>Hi {{ .Subscriber.FirstName }},</p>\n<p>I work on OreWire. We publish decoded filings and news summaries for 2,000+ mining companies on the TSX, TSX-V, CSE and ASX.</p>\n<p>For IR and corp-dev teams, the useful part is a peer watchlist: see what comparable issuers filed or released, without refreshing SEDAR all day.</p>\n<p>Would a peer-alert feed be useful at {{ .Subscriber.Attribs.company_name }}?</p>\n<p>-- Azeem Amjad<br>OreWire</p>',
  'html', 'draft', 'regular', 'email'
);

INSERT INTO campaign_lists (campaign_id, list_id)
SELECT c.id, l.id FROM campaigns c, lists l
WHERE c.name = 'B1 - Company IR - Peer filings without the chase (Step 1A)' AND l.name = 'AU Company IR';
