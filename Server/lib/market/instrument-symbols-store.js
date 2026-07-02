const db = require('../../db');
const { tvSymbolForCompany } = require('./tv-quote');
const {
  COMMODITY_SYMBOLS,
  INDEX_SYMBOLS,
  CURRENCY_SYMBOLS,
} = require('./payloads');

function parseTvSymbol(tvSymbol) {
  const s = String(tvSymbol || '').trim();
  const idx = s.indexOf(':');
  if (idx < 0) return { exchange: null, ticker: s };
  return { exchange: s.slice(0, idx), ticker: s.slice(idx + 1) };
}

function rowToDto(row) {
  if (!row) return null;
  return {
    id: row.id,
    entity_type: row.entity_type,
    entity_id: row.entity_id,
    entity_key: row.entity_key,
    exchange: row.exchange,
    ticker: row.ticker,
    tv_symbol: row.tv_symbol,
    label: row.label,
    is_default: row.is_default,
    sort_order: row.sort_order,
  };
}

async function listSymbols(entityType, { entityId = null, entityKey = null } = {}) {
  if (entityType === 'company') {
    const r = await db.query(
      `SELECT * FROM instrument_symbols
       WHERE entity_type = 'company' AND entity_id = $1
       ORDER BY is_default DESC, sort_order ASC, id ASC`,
      [entityId],
    );
    return r.rows.map(rowToDto);
  }
  const key = String(entityKey || '').toLowerCase();
  const r = await db.query(
    `SELECT * FROM instrument_symbols
     WHERE entity_type = $1 AND LOWER(entity_key) = $2
     ORDER BY is_default DESC, sort_order ASC, id ASC`,
    [entityType, key],
  );
  return r.rows.map(rowToDto);
}

async function getDefaultSymbol(entityType, { entityId = null, entityKey = null } = {}) {
  const rows = await listSymbols(entityType, { entityId, entityKey });
  return rows.find((r) => r.is_default) || rows[0] || null;
}

async function getDefaultTvSymbolForCompany(company) {
  const def = await getDefaultSymbol('company', { entityId: company.id });
  if (def?.tv_symbol) return def.tv_symbol;
  if (company?.exchange && company?.ticker) {
    return tvSymbolForCompany(company.exchange, company.ticker);
  }
  return null;
}

async function setCompanyDefaultFromSymbol(companyId, symbolId) {
  await db.query(
    `UPDATE instrument_symbols SET is_default = FALSE
     WHERE entity_type = 'company' AND entity_id = $1`,
    [companyId],
  );
  const r = await db.query(
    `UPDATE instrument_symbols SET is_default = TRUE
     WHERE id = $1 AND entity_type = 'company' AND entity_id = $2
     RETURNING *`,
    [symbolId, companyId],
  );
  const row = r.rows[0];
  if (!row) return null;
  await db.query(
    `UPDATE companies SET exchange = $2, ticker = $3, updated_at = NOW()
     WHERE id = $1`,
    [companyId, row.exchange, row.ticker],
  );
  return rowToDto(row);
}

async function createSymbol(data) {
  const {
    entity_type,
    entity_id = null,
    entity_key = null,
    exchange = null,
    ticker,
    tv_symbol,
    label = null,
    is_default = false,
    sort_order = 0,
  } = data;

  if (is_default && entity_type === 'company' && entity_id) {
    await db.query(
      `UPDATE instrument_symbols SET is_default = FALSE
       WHERE entity_type = 'company' AND entity_id = $1`,
      [entity_id],
    );
  }
  if (is_default && entity_key) {
    await db.query(
      `UPDATE instrument_symbols SET is_default = FALSE
       WHERE entity_type = $1 AND LOWER(entity_key) = LOWER($2)`,
      [entity_type, entity_key],
    );
  }

  const r = await db.query(
    `INSERT INTO instrument_symbols (
       entity_type, entity_id, entity_key, exchange, ticker, tv_symbol, label, is_default, sort_order
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     RETURNING *`,
    [
      entity_type,
      entity_id,
      entity_key ? String(entity_key).toLowerCase() : null,
      exchange,
      ticker,
      tv_symbol,
      label,
      !!is_default,
      sort_order,
    ],
  );

  const row = rowToDto(r.rows[0]);
  if (is_default && entity_type === 'company' && entity_id) {
    await db.query(
      `UPDATE companies SET exchange = $2, ticker = $3, updated_at = NOW() WHERE id = $1`,
      [entity_id, exchange, ticker],
    );
  }
  return row;
}

async function updateSymbol(id, patch) {
  const existing = await db.query(`SELECT * FROM instrument_symbols WHERE id = $1`, [id]);
  const row = existing.rows[0];
  if (!row) return null;

  const exchange = patch.exchange !== undefined ? patch.exchange : row.exchange;
  const ticker = patch.ticker !== undefined ? patch.ticker : row.ticker;
  const tv_symbol = patch.tv_symbol !== undefined ? patch.tv_symbol : row.tv_symbol;
  const label = patch.label !== undefined ? patch.label : row.label;
  const sort_order = patch.sort_order !== undefined ? patch.sort_order : row.sort_order;
  const is_default = patch.is_default !== undefined ? !!patch.is_default : row.is_default;

  if (is_default && !row.is_default) {
    if (row.entity_type === 'company') {
      await db.query(
        `UPDATE instrument_symbols SET is_default = FALSE
         WHERE entity_type = 'company' AND entity_id = $1`,
        [row.entity_id],
      );
    } else {
      await db.query(
        `UPDATE instrument_symbols SET is_default = FALSE
         WHERE entity_type = $1 AND entity_key = $2`,
        [row.entity_type, row.entity_key],
      );
    }
  }

  const r = await db.query(
    `UPDATE instrument_symbols SET
       exchange = $2, ticker = $3, tv_symbol = $4, label = $5, is_default = $6, sort_order = $7
     WHERE id = $1 RETURNING *`,
    [id, exchange, ticker, tv_symbol, label, is_default, sort_order],
  );
  const updated = rowToDto(r.rows[0]);
  if (is_default && row.entity_type === 'company' && row.entity_id) {
    await db.query(
      `UPDATE companies SET exchange = $2, ticker = $3, updated_at = NOW() WHERE id = $1`,
      [row.entity_id, exchange, ticker],
    );
  }
  return updated;
}

async function deleteSymbol(id) {
  const r = await db.query(`DELETE FROM instrument_symbols WHERE id = $1 RETURNING *`, [id]);
  const row = r.rows[0];
  if (!row) return null;
  if (row.is_default) {
    const next = await db.query(
      `SELECT id FROM instrument_symbols
       WHERE entity_type = $1
         AND (($2::int IS NOT NULL AND entity_id = $2) OR ($3::text IS NOT NULL AND entity_key = $3))
       ORDER BY sort_order ASC, id ASC LIMIT 1`,
      [row.entity_type, row.entity_id, row.entity_key],
    );
    if (next.rows[0]) {
      await updateSymbol(next.rows[0].id, { is_default: true });
    }
  }
  return rowToDto(row);
}

async function seedInstrumentSymbolsIfEmpty() {
  const count = await db.query(`SELECT COUNT(*)::int AS n FROM instrument_symbols`);
  if ((count.rows[0]?.n || 0) > 0) return { seeded: false };

  const companies = await db.query(
    `SELECT id, exchange, ticker, sedar_ticker FROM companies
     WHERE ticker IS NOT NULL AND ticker <> ''`,
  );
  for (const c of companies.rows) {
    const tv = tvSymbolForCompany(c.exchange, c.ticker);
    if (!tv) continue;
    const { exchange, ticker } = parseTvSymbol(tv);
    await createSymbol({
      entity_type: 'company',
      entity_id: c.id,
      exchange: c.exchange || exchange,
      ticker: c.ticker,
      tv_symbol: tv,
      label: 'Primary',
      is_default: true,
      sort_order: 0,
    });
    if (c.sedar_ticker) {
      const otcTv = `OTC:${c.sedar_ticker}`;
      await createSymbol({
        entity_type: 'company',
        entity_id: c.id,
        exchange: 'OTCQB',
        ticker: c.sedar_ticker,
        tv_symbol: otcTv,
        label: 'OTCQB',
        is_default: false,
        sort_order: 1,
      }).catch(() => {});
    }
  }

  async function seedMarketList(entityType, list) {
    for (const item of list) {
      const key = String(item.key).toLowerCase();
      const tvList = item.tv || [];
      for (let i = 0; i < tvList.length; i++) {
        const tv = tvList[i];
        const { exchange, ticker } = parseTvSymbol(tv);
        await createSymbol({
          entity_type: entityType,
          entity_key: key,
          exchange,
          ticker,
          tv_symbol: tv,
          label: i === 0 ? 'Primary' : exchange || `Alt ${i}`,
          is_default: i === 0,
          sort_order: i,
        }).catch(() => {});
      }
    }
  }

  await seedMarketList('commodity', COMMODITY_SYMBOLS);
  await seedMarketList('currency', CURRENCY_SYMBOLS);
  await seedMarketList('index', INDEX_SYMBOLS);

  console.log('[DB] Seeded instrument_symbols from companies and market payloads');
  return { seeded: true };
}

module.exports = {
  parseTvSymbol,
  listSymbols,
  getDefaultSymbol,
  getDefaultTvSymbolForCompany,
  setCompanyDefaultFromSymbol,
  createSymbol,
  updateSymbol,
  deleteSymbol,
  seedInstrumentSymbolsIfEmpty,
};
