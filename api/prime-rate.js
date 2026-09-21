// ── Pencil Your Deal™ — Vercel Node Serverless Function ──
// Returns the current US bank prime rate (the "WSJ Prime Rate") as JSON, so the
// calculator can seed its DSCR rate estimate with a live number.
//
// Why this exists: v6 of the calculator fetched
// `https://fred.stlouisfed.org/graph/fredgraph.csv?id=PRIMRATE` straight from the
// browser. That never worked — FRED serves a 404 bot-protection page to
// non-browser clients and sends no `Access-Control-Allow-Origin` header, so the
// request dies on CORS. Fetching server-side sidesteps CORS entirely, and this
// endpoint is same-origin for the page.
//
// Sources, tried in order:
//   1. FRED's official API — used when FRED_API_KEY is set. Stable, documented
//      JSON. Get a free key at https://fredaccount.stlouisfed.org/apikeys.
//   2. The Federal Reserve's H.15 release page — no key required. Parsed from the
//      published table, so it is the more brittle of the two; it is the fallback
//      precisely so the feature works out of the box with no configuration.
//
// The prime rate changes a handful of times a year at most, so responses are
// cached hard at the CDN and we never hammer either upstream.

// Candidate FRED series for the bank prime loan rate, tried in order.
// NOT "PRIMRATE" — that is the id from the fredgraph URL v6 shipped and it is
// not a real FRED series ("Bad Request. The series does not exist."), which is
// part of why that original call could never have worked.
//   DPRIME — Bank Prime Loan Rate, daily (matches what H.15 publishes)
//   MPRIME — Bank Prime Loan Rate, monthly (steadier; used if daily is absent)
const FRED_SERIES = ['DPRIME', 'MPRIME'];
const H15_URL = 'https://www.federalreserve.gov/releases/h15/';
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36';
// Per-source budget. Two sources are tried, so keep this comfortably under half
// the function's maxDuration (set in vercel.json) or a double timeout outlives
// the invocation and the caller sees a platform error instead of {ok:false}.
const TIMEOUT_MS = 4000;

// Anything outside this band is a parse error, not a rate. US prime has ranged
// roughly 3.25%–21.5% across the whole post-1970 record.
const MIN_RATE = 0.5;
const MAX_RATE = 30;

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

function plausible(n) {
  return typeof n === 'number' && isFinite(n) && n >= MIN_RATE && n <= MAX_RATE;
}

async function fetchWithTimeout(url, headers) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    return await fetch(url, { headers: { 'User-Agent': UA, ...headers }, signal: ctrl.signal });
  } finally {
    clearTimeout(timer);
  }
}

// ── Source 1: FRED official API (needs a free key) ──
async function fromFredSeries(apiKey, seriesId) {
  // Ask for several observations, newest first: daily series carry "." for
  // holidays and weekends, so limit=1 can legitimately return no number.
  const url = 'https://api.stlouisfed.org/fred/series/observations' +
    `?series_id=${encodeURIComponent(seriesId)}&api_key=${encodeURIComponent(apiKey)}` +
    '&file_type=json&sort_order=desc&limit=10';
  const resp = await fetchWithTimeout(url);
  if (!resp.ok) {
    // FRED puts a precise reason in the body ("...api_key is not registered",
    // "...not a 32 character alpha-numeric lower-case string", "The series does
    // not exist"). Surfacing it is the difference between "the key is wrong" and
    // "the key is wrong *how*" — or, as it turned out, "the key is fine".
    let detail = '';
    try {
      const body = await resp.text();
      const m = body.match(/"error_message"\s*:\s*"([^"]+)"/);
      detail = m ? ' — ' + m[1].trim() : ' — ' + body.slice(0, 120).replace(/\s+/g, ' ').trim();
    } catch (_) { /* body unreadable; status alone will have to do */ }
    throw new Error(`FRED API HTTP ${resp.status} [${seriesId}]${detail}`);
  }
  const json = await resp.json();
  const obs = (json && json.observations) || [];
  if (!obs.length) throw new Error(`FRED API [${seriesId}] returned no observations`);
  const hit = obs.find(o => plausible(parseFloat(o.value)));
  if (!hit) throw new Error(`FRED API [${seriesId}] had no usable value in the last ${obs.length}`);
  return {
    prime: parseFloat(hit.value), asOf: hit.date,
    source: `FRED API (series ${seriesId})`,
    sourceUrl: `https://fred.stlouisfed.org/series/${seriesId}`
  };
}

async function fromFredApi(apiKey) {
  const errs = [];
  for (const id of FRED_SERIES) {
    try { return await fromFredSeries(apiKey, id); }
    catch (e) { errs.push((e && e.message) || String(e)); }
  }
  throw new Error(errs.join(' ; '));
}

// ── Source 2: Federal Reserve H.15 release (no key) ──
// The row we want looks like:
//   <th ... class="stub">Bank prime loan <a class="foot" ...>2</a> ...</th>
//   <td class="data" headers="idXXXX col1" ...>&nbsp;6.75&nbsp;</td>   (one per date)
// Footnote markers live in <a> tags inside the <th>, so stripping tags from the
// <td class="data"> cells only ever leaves the numbers.
async function fromH15() {
  const resp = await fetchWithTimeout(H15_URL, { Accept: 'text/html' });
  if (!resp.ok) throw new Error(`H.15 HTTP ${resp.status}`);
  const html = await resp.text();

  const rowMatch = html.match(
    /<tr[^>]*>\s*<th[^>]*class="stub"[^>]*>\s*Bank prime loan[\s\S]*?<\/tr>/i
  );
  if (!rowMatch) throw new Error('H.15: "Bank prime loan" row not found');
  const row = rowMatch[0];

  // Collect the data cells with their column ids so we can date the last one.
  const cells = [];
  const cellRe = /<td[^>]*class="data"[^>]*headers="[^"]*?\b(col\d+)\b[^"]*"[^>]*>([\s\S]*?)<\/td>/gi;
  let m;
  while ((m = cellRe.exec(row)) !== null) {
    const text = m[2].replace(/<[^>]*>/g, '').replace(/&nbsp;| /g, ' ').trim();
    const value = parseFloat(text);
    if (plausible(value)) cells.push({ col: m[1], value });
  }
  if (!cells.length) throw new Error('H.15: no numeric cells in the prime loan row');

  const last = cells[cells.length - 1];

  // Date the column from the table header: <th id="col5" ...>2026<br>Jul<br>28</th>
  // Assembled as a string rather than via `new Date(...).toISOString()` — that
  // parses as local midnight and then shifts the calendar day in any timezone
  // ahead of UTC, reporting the rate as one day older than it is.
  let asOf = null;
  const hdr = html.match(new RegExp(`<th[^>]*id="${last.col}"[^>]*>([\\s\\S]*?)<\\/th>`, 'i'));
  if (hdr) {
    const parts = hdr[1].replace(/<[^>]*>/g, '|').split('|').map(s => s.trim()).filter(Boolean);
    if (parts.length >= 3) {
      const year = parts[0];
      const mon = MONTHS.indexOf(parts[1].slice(0, 3).toLowerCase()) + 1;
      const day = parseInt(parts[2], 10);
      if (/^\d{4}$/.test(year) && mon > 0 && day >= 1 && day <= 31) {
        asOf = `${year}-${String(mon).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
      }
    }
  }
  return { prime: last.value, asOf, source: 'Federal Reserve H.15', sourceUrl: H15_URL };
}

module.exports = async (req, res) => {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.setHeader('Allow', 'GET, HEAD');
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  }

  // Trimmed because pasting into a dashboard env-var field very often carries a
  // trailing newline or space, which percent-encodes into the query and makes
  // FRED reject an otherwise valid key.
  const key = (process.env.FRED_API_KEY || '').trim();

  // Never let the key itself reach the response, even via an upstream error
  // string that happened to echo the request URL back.
  const scrub = (s) => (key ? String(s).split(key).join('«FRED_API_KEY»') : String(s));

  // Reported so a misconfigured key is diagnosable from the response alone.
  // Without this the fallback to H.15 is silent and indistinguishable from
  // "no key set" — which is exactly what a forgotten redeploy looks like.
  // FRED keys are exactly 32 lower-case alphanumeric characters. Reporting only
  // whether the shape matches (never the value) turns "why was my key rejected"
  // into a one-request answer.
  const diag = { keyConfigured: !!key };
  if (key) diag.keyFormatOk = /^[a-z0-9]{32}$/.test(key);

  const attempts = [];
  const sources = [];
  if (key) sources.push(() => fromFredApi(key));
  sources.push(fromH15);

  for (const get of sources) {
    try {
      const out = await get();
      // Fresh for 6h at the CDN, then serve stale for up to a day while
      // revalidating — a stale prime rate beats no prime rate.
      res.setHeader('Cache-Control', 'public, s-maxage=21600, stale-while-revalidate=86400');
      if (attempts.length) diag.fallbackReason = attempts[0];
      return res.status(200).json({ ok: true, ...out, ...diag, fetchedAt: new Date().toISOString() });
    } catch (err) {
      attempts.push(scrub((err && err.message) || err));
    }
  }

  // Every source failed. Tell the client plainly so it keeps its own default
  // rather than rendering a bogus rate. Cache briefly so an upstream outage
  // doesn't turn into a request storm.
  console.error('prime-rate: all sources failed —', attempts.join(' | '));
  res.setHeader('Cache-Control', 'public, s-maxage=300');
  return res.status(200).json({ ok: false, error: 'prime rate unavailable', ...diag, attempts });
};

