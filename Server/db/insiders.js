// Persists AI-extracted insider data into the insider_ownership and
// insider_transactions tables. Called from every site that writes ai_output.
// No-op when the company is unknown or the filing carried no insider data.

function txLabel(t) {
  const verb =
    t.transaction_type === 'sale' || t.transaction_type === 'disposition' ? 'Sold'
    : t.transaction_type === 'grant' ? 'Granted'
    : t.transaction_type === 'exercise' ? 'Exercised'
    : 'Bought';
  return t.shares ? `${verb} ${Number(t.shares).toLocaleString()}` : verb;
}

async function upsertInsiderData(client, companyId, filingId, ext) {
  if (!companyId || !ext) return;

  const transactions = Array.isArray(ext.insider_transactions) ? ext.insider_transactions : [];
  for (const t of transactions) {
    const name = (t.insider_name || '').trim();
    if (!name) continue;
    await client.query(
      `INSERT INTO insider_transactions
         (company_id, filing_id, insider_name, title, transaction_type, shares, price, transaction_date, total_holdings_after)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       ON CONFLICT (company_id, insider_name, transaction_date, shares, transaction_type) DO NOTHING`,
      [companyId, filingId || null, name, t.title || null, t.transaction_type || null,
       t.shares ?? null, t.price ?? null, t.transaction_date || null, t.total_holdings_after ?? null],
    );
  }

  // Ownership: prefer explicit insider_ownership; fall back to the holdings snapshot.
  const ownership = Array.isArray(ext.insider_ownership) && ext.insider_ownership.length
    ? ext.insider_ownership.map((o) => ({ name: o.insider_name, title: o.title, shares: o.total_shares, pct: o.percent_ownership }))
    : Array.isArray(ext.insider_holdings)
      ? ext.insider_holdings.map((o) => ({ name: o.name, title: o.title, shares: o.shares, pct: null }))
      : [];

  for (const o of ownership) {
    const name = (o.name || '').trim();
    if (!name) continue;
    await client.query(
      `INSERT INTO insider_ownership
         (company_id, insider_name, title, total_shares, percent_ownership, last_updated_from_filing, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, NOW())
       ON CONFLICT (company_id, insider_name) DO UPDATE SET
         title = COALESCE(EXCLUDED.title, insider_ownership.title),
         total_shares = COALESCE(EXCLUDED.total_shares, insider_ownership.total_shares),
         percent_ownership = COALESCE(EXCLUDED.percent_ownership, insider_ownership.percent_ownership),
         last_updated_from_filing = EXCLUDED.last_updated_from_filing,
         updated_at = NOW()`,
      [companyId, name, o.title || null, o.shares ?? null, o.pct ?? null, filingId || null],
    );
  }

  // Stamp each insider's most-recent transaction onto the ownership row.
  for (const t of transactions) {
    const name = (t.insider_name || '').trim();
    if (!name || !t.transaction_date) continue;
    await client.query(
      `UPDATE insider_ownership SET last_transaction = $3, last_transaction_date = $4::date
       WHERE company_id = $1 AND insider_name = $2
         AND (last_transaction_date IS NULL OR last_transaction_date <= $4::date)`,
      [companyId, name, txLabel(t), t.transaction_date],
    );
  }
}

module.exports = { upsertInsiderData };
