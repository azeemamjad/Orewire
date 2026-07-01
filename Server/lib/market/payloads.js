const { fetchListQuote } = require('./market-quote');

function normalizePrice(data) {
  return {
    symbol: data.name || null,
    price: data.close ?? null,
    change_pct: data.change ?? null,
    change_abs: data.change_abs ?? null,
    open: data.open ?? null,
    high: data.high ?? null,
    low: data.low ?? null,
    volume: data.volume ?? null,
    sector: data.sector ?? null,
    country: data.country ?? null,
    description: data.description ?? null,
    perf_week: data['Perf.W'] ?? null,
    perf_month: data['Perf.1M'] ?? null,
    perf_ytd: data['Perf.YTD'] ?? null,
    perf_year: data['Perf.Y'] ?? null,
    recommend: data['Recommend.All'] ?? null,
    currency: data.fundamental_currency_code ?? null,
    raw: data,
  };
}

const COMMODITY_SYMBOLS = [
  { key: 'gold',      label: 'Gold',            unit: 'oz',  y: ['GC=F', 'GLD'],        tv: ['COMEX:GC1!', 'TVC:GOLD', 'OANDA:XAUUSD'] },
  { key: 'silver',    label: 'Silver',          unit: 'oz',  y: ['SI=F', 'SLV'],        tv: ['COMEX:SI1!', 'TVC:SILVER', 'OANDA:XAGUSD'] },
  { key: 'copper',    label: 'Copper',          unit: 'lb',  y: ['HG=F', 'CPER'],       tv: ['COMEX:HG1!', 'TVC:COPPER', 'CAPITALCOM:COPPER'] },
  { key: 'uranium',   label: 'Uranium',         unit: 'lb',  y: ['URA'],                tv: ['NYMEX:UX1!', 'AMEX:URA', 'NYSEARCA:URA'] },
  { key: 'lithium',   label: 'Lithium',         unit: 't',   y: ['LIT'],                tv: ['TVC:LITHIUM', 'AMEX:LIT', 'NYSEARCA:LIT'] },
  { key: 'iron_ore',  label: 'Iron Ore',        unit: 't',   y: [],                     tv: ['TVC:IRONORE', 'SGX:FEF1!', 'NYMEX:TIO1!'] },
  { key: 'nickel',    label: 'Nickel',          unit: 't',   y: [],                     tv: ['LME:NI1!', 'SHFE:NI1!', 'NYMEX:LN1!', 'TVC:NICKEL'] },
  { key: 'zinc',      label: 'Zinc',            unit: 't',   y: [],                     tv: ['LME:ZN1!', 'SHFE:ZN1!'] },
  { key: 'brent',     label: 'Brent Crude Oil', unit: 'bbl', y: ['BZ=F'],               tv: ['NYMEX:BB1!', 'TVC:UKOIL', 'ICEEUR:BRN1!'] },
  { key: 'wti',       label: 'WTI Crude Oil',   unit: 'bbl', y: ['CL=F'],               tv: ['NYMEX:CL1!', 'TVC:USOIL', 'CAPITALCOM:OIL_CRUDE'] },
  { key: 'tin',       label: 'Tin',             unit: 't',   y: [],                     tv: ['LME:SN1!'] },
  { key: 'cobalt',    label: 'Cobalt',          unit: 't',   y: [],                     tv: ['LME:CA1!'] },
  { key: 'lead',      label: 'Lead',            unit: 't',   y: [],                     tv: ['LME:PB1!', 'SHFE:PB1!'] },
  { key: 'platinum',  label: 'Platinum',        unit: 'oz',  y: ['PL=F', 'PPLT'],       tv: ['NYMEX:PL1!', 'TVC:PLATINUM', 'OANDA:XPTUSD'] },
  { key: 'palladium', label: 'Palladium',       unit: 'oz',  y: ['PA=F', 'PALL'],       tv: ['NYMEX:PA1!', 'TVC:PALLADIUM', 'OANDA:XPDUSD'] },
];

const INDEX_SYMBOLS = [
  { key: 'GDXJ', label: 'Junior Gold Miners ETF',   y: ['GDXJ'],            tv: ['AMEX:GDXJ', 'NYSEARCA:GDXJ'],              about: 'Junior gold miners ETF — small and mid-cap gold producers and explorers.' },
  { key: 'TSXV', label: 'TSX Venture Composite',    y: ['^SPCDNX'],         tv: ['TSX:JX', 'TSX:TSXV', 'INDEX:JX'],          about: 'Composite benchmark of TSX Venture Exchange listings — heavily weighted to junior mining and exploration issuers in Canada.' },
  { key: 'XMM',  label: 'ASX 300 Metals & Mining',  y: ['^AXMM', 'MVR.AX'], tv: ['ASX:XMM', 'INDEX:XMM', 'ASX:MVR'],         about: 'S&P/ASX 300 Metals & Mining Index — Australian-listed mining and metals producers. Proxied via MVR (VanEck Australian Resources ETF) when the index is unavailable.' },
  { key: 'GDX',  label: 'Gold Miners ETF',          y: ['GDX'],             tv: ['AMEX:GDX', 'NYSEARCA:GDX'],                about: 'Large-cap gold miners ETF — tracks NYSE Arca Gold Miners Index.' },
  { key: 'XGD',  label: 'S&P/TSX Gold Index',       y: ['XGD.TO'],          tv: ['TSX:XGD', 'INDEX:XGD'],                    about: 'S&P/TSX Gold Index — Canadian-listed gold producers. Proxied via the iShares S&P/TSX Global Gold ETF (XGD).' },
  { key: 'URA',  label: 'Uranium Miners ETF',       y: ['URA'],             tv: ['AMEX:URA', 'NYSEARCA:URA'],                about: 'Uranium miners and nuclear fuel ETF.' },
  { key: 'COPX', label: 'Copper Miners ETF',        y: ['COPX'],            tv: ['AMEX:COPX', 'NYSEARCA:COPX'],              about: 'Global copper miners ETF — pure-play exposure to copper producers worldwide.' },
  { key: 'SIL',  label: 'Silver Miners ETF',        y: ['SIL'],             tv: ['AMEX:SIL', 'NYSEARCA:SIL'],                about: 'Global X Silver Miners ETF — primary-silver producers worldwide.' },
  { key: 'LIT',  label: 'Lithium & Battery ETF',    y: ['LIT'],             tv: ['AMEX:LIT', 'NYSEARCA:LIT'],                about: 'Lithium miners and battery manufacturers ETF.' },
  { key: 'PICK', label: 'Metal & Mining SPDR ETF',  y: ['PICK'],            tv: ['CBOE:PICK', 'AMEX:PICK', 'NYSEARCA:PICK'], about: 'iShares MSCI Global Metals & Mining Producers ETF.' },
  { key: 'TSX',  label: 'S&P/TSX Composite',        y: ['^GSPTSE'],         tv: ['TSX:TSX', 'INDEX:TSX'],                    about: 'S&P/TSX Composite Index — the benchmark for the Toronto Stock Exchange covering large-cap Canadian equities.' },
  { key: 'XJO',  label: 'ASX 200',                  y: ['^AXJO'],           tv: ['ASX:XJO', 'INDEX:XJO'],                    about: 'S&P/ASX 200 — Australian large-cap benchmark.' },
  { key: 'SPX',  label: 'S&P 500',                  y: ['^GSPC'],           tv: ['SP:SPX', 'TVC:SPX', 'INDEX:SPX'],          about: 'S&P 500 — US large-cap benchmark.' },
  { key: 'VIX',  label: 'Volatility Index',         y: ['^VIX'],            tv: ['TVC:VIX', 'CBOE:VIX', 'INDEX:VIX'],        about: 'CBOE Volatility Index — implied 30-day S&P 500 volatility.' },
];

const CURRENCY_SYMBOLS = [
  { key: 'AUDCAD', label: 'AUD / CAD', y: ['AUDCAD=X'],          tv: ['FX:AUDCAD', 'FX_IDC:AUDCAD', 'OANDA:AUDCAD'] },
  { key: 'USDCAD', label: 'USD / CAD', y: ['USDCAD=X'],          tv: ['FX:USDCAD', 'FX_IDC:USDCAD', 'OANDA:USDCAD'] },
  { key: 'AUDUSD', label: 'AUD / USD', y: ['AUDUSD=X'],          tv: ['FX:AUDUSD', 'FX_IDC:AUDUSD', 'OANDA:AUDUSD'] },
  { key: 'DXY',    label: 'DXY',       y: ['DX-Y.NYB', 'DX=F'],  tv: ['TVC:DXY', 'INDEX:DXY'], subtitle: 'US Dollar Index' },
];

function commodityConfig(key) {
  const k = String(key || '').toLowerCase();
  return COMMODITY_SYMBOLS.find((c) => c.key === k) || null;
}

async function buildCommodityItem(c, { preferTv = false } = {}) {
  const r = await fetchListQuote(c.y, c.tv, { preferTv });
  if (!r) {
    return {
      key: c.key,
      label: c.label,
      unit: c.unit,
      price: null,
      change_pct: null,
      change_abs: null,
      open: null,
      high: null,
      low: null,
      volume: null,
      currency: null,
      source: null,
      provider: null,
      history_symbol: c.y[0] || null,
    };
  }
  const norm = normalizePrice(r.quote);
  return {
    key: c.key,
    label: c.label,
    unit: c.unit,
    price: norm.price,
    change_pct: norm.change_pct,
    change_abs: norm.change_abs,
    open: norm.open,
    high: norm.high,
    low: norm.low,
    volume: norm.volume,
    currency: norm.currency,
    source: r.symbol,
    provider: r.provider,
    history_symbol: c.y[0] || r.symbol,
  };
}

const COMMODITY_CACHE_TTL_MS = 30 * 60 * 1000;
let commoditiesCache = null;
let commoditiesCacheTs = 0;

async function getCommoditiesPayload() {
  if (commoditiesCache && Date.now() - commoditiesCacheTs < COMMODITY_CACHE_TTL_MS) {
    return commoditiesCache;
  }
  const items = await Promise.all(COMMODITY_SYMBOLS.map((c) => buildCommodityItem(c)));
  const payload = { updatedAt: new Date().toISOString(), items };
  commoditiesCache = payload;
  commoditiesCacheTs = Date.now();
  return payload;
}

let indexesCache = null;
let indexesCacheTs = 0;

async function getIndexesPayload() {
  if (indexesCache && Date.now() - indexesCacheTs < COMMODITY_CACHE_TTL_MS) {
    return indexesCache;
  }
  const items = await Promise.all(INDEX_SYMBOLS.map(async (c) => {
    const r = await fetchListQuote(c.y, c.tv);
    if (!r) return { key: c.key, label: c.label, about: c.about, price: null, change_pct: null, currency: null };
    const norm = normalizePrice(r.quote);
    return { key: c.key, label: c.label, about: c.about, price: norm.price, change_pct: norm.change_pct, currency: norm.currency };
  }));
  const payload = { updatedAt: new Date().toISOString(), items };
  indexesCache = payload;
  indexesCacheTs = Date.now();
  return payload;
}

let currenciesCache = null;
let currenciesCacheTs = 0;

async function getCurrenciesPayload() {
  if (currenciesCache && Date.now() - currenciesCacheTs < COMMODITY_CACHE_TTL_MS) {
    return currenciesCache;
  }
  const items = await Promise.all(CURRENCY_SYMBOLS.map(async (c) => {
    const r = await fetchListQuote(c.y, c.tv);
    if (!r) return { key: c.key, label: c.label, subtitle: c.subtitle || null, price: null, change_pct: null };
    const norm = normalizePrice(r.quote);
    return {
      key: c.key,
      label: c.label,
      subtitle: c.subtitle || null,
      price: norm.price,
      change_pct: norm.change_pct,
    };
  }));
  const payload = { updatedAt: new Date().toISOString(), items };
  currenciesCache = payload;
  currenciesCacheTs = Date.now();
  return payload;
}

module.exports = {
  normalizePrice,
  COMMODITY_SYMBOLS,
  INDEX_SYMBOLS,
  CURRENCY_SYMBOLS,
  commodityConfig,
  buildCommodityItem,
  getCommoditiesPayload,
  getIndexesPayload,
  getCurrenciesPayload,
};
