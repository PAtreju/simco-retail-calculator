// Local server for the retail calculator: serves the page and refreshes exchange prices on request.
//
//   node serve.mjs   (from this folder)   then open http://localhost:8765
//
// Sim Companies allows ONE API request per five minutes; going faster risks a captcha and the
// account. So "refresh" never fetches immediately: it puts products in a queue and this process
// fetches one every 5 min 5 s, remembering the last request time on disk so a restart can't break
// the floor. Run only one copy, and don't run other Sim Companies tools at the same time.
// Only public market data is fetched — no login, no cookie. Listens on 127.0.0.1 only.
import { createServer } from "node:http";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const DIR = dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT ?? 8765);
const REALM = Number(process.env.SIMCO_REALM ?? 0);
const MIN_GAP_MS = 305_000;
const PRICES_FILE = join(DIR, "retail-prices.js");
const STATE_FILE = join(DIR, ".refresh-state.json");
const BASE = "https://www.simcompanies.com";

// ---------- persisted state ----------
const loadPrices = () => {
  try {
    const src = readFileSync(PRICES_FILE, "utf8");
    return JSON.parse(src.slice(src.indexOf("{"), src.lastIndexOf("}") + 1));
  } catch { return { books: {}, retail: {}, ticker: {} }; }
};
let prices = loadPrices();
const savePrices = () => {
  prices.builtAt = new Date().toISOString();
  writeFileSync(PRICES_FILE, `window.SIMCO_PRICES = ${JSON.stringify(prices)};\n`);
};
const state = existsSync(STATE_FILE) ? JSON.parse(readFileSync(STATE_FILE, "utf8")) : { lastRequestAt: 0, queue: [] };
const saveState = () => writeFileSync(STATE_FILE, JSON.stringify(state));
const log = [];
const note = (msg) => { log.unshift(`${new Date().toISOString().slice(11, 19)} ${msg}`); log.length = Math.min(log.length, 20); console.log(msg); };

// ---------- queue: items are "ticker", "retail" or "book:<id>" ----------
// `front` puts a user's button press ahead of the background fill, keeping the order it was given.
const enqueue = (keys, front) => {
  const valid = keys.filter((k) => /^(ticker|retail|book:\d{1,4})$/.test(k));
  const added = valid.filter((k) => !state.queue.includes(k)).length;
  state.queue = front ? [...new Set([...valid, ...state.queue])] : [...new Set([...state.queue, ...valid])];
  saveState();
  return added;
};
const pathFor = (k) => k === "ticker" ? `/api/v3/market-ticker/${REALM}/`
  : k === "retail" ? `/api/v4/${REALM}/resources-retail-info/`
  : `/api/v3/market/${REALM}/${k.slice(5)}/`;

function absorb(k, body, at) {
  if (k === "ticker") {
    prices.ticker = {};
    for (const e of Array.isArray(body) ? body : Object.values(body)) {
      const id = e.kind ?? e.resource ?? e.dbLetter ?? e.id, price = e.price ?? e.lowestPrice;
      if (id != null && price > 0) prices.ticker[id] = price;
    }
    prices.tickerAt = at;
  } else if (k === "retail") {
    for (const e of body) {
      if (e.quality != null) continue;
      const last = [...(e.retailData ?? [])].reverse().find((d) => d.averagePrice > 0);
      if (last) prices.retail[e.dbLetter] = { avg: +last.averagePrice.toFixed(2), sat: +(e.saturation ?? last.saturation).toFixed(4) };
    }
    prices.retailAt = at;
  } else {
    // cost[q] = cheapest ask at quality q or better: buying above the quality you sell is allowed.
    const cheapestAt = {};
    for (const o of body) if (o.price > 0 && (cheapestAt[o.quality] ?? Infinity) > o.price) cheapestAt[o.quality] = o.price;
    const cost = {};
    let run = Infinity;
    for (let q = 12; q >= 0; q--) { run = Math.min(run, cheapestAt[q] ?? Infinity); if (run < Infinity) cost[q] = run; }
    prices.books[k.slice(5)] = { at, cost };
  }
  savePrices();
}

let busy = false;
async function tick() {
  if (busy || state.queue.length === 0 || Date.now() - state.lastRequestAt < MIN_GAP_MS) return;
  busy = true;
  const k = state.queue[0];
  // Stamp before the request: a crash mid-request must still count against the floor.
  state.lastRequestAt = Date.now();
  saveState();
  try {
    const res = await fetch(BASE + pathFor(k), { headers: { Accept: "application/json", "User-Agent": "simco-retail-calculator/1.0 (read-only)" } });
    if (res.status === 429 || res.status === 403) {
      // The game is pushing back: stop entirely rather than retry into a captcha.
      note(`${k}: HTTP ${res.status} — the game is rate limiting; queue paused. Restart later.`);
      state.paused = true;
    } else if (!res.ok) {
      note(`${k}: HTTP ${res.status}, skipped`);
      state.queue.shift();
    } else {
      const j = await res.json();
      absorb(k, j.body ?? j, new Date().toISOString());
      state.queue.shift();
      note(`${k}: updated`);
    }
  } catch (e) {
    note(`${k}: ${e.name}, will retry after the next 5-minute window`);
  }
  saveState();
  busy = false;
}
setInterval(() => { if (!state.paused) tick(); }, 5_000);

// ---------- http ----------
const send = (res, code, type, body) => { res.writeHead(code, { "Content-Type": type, "Cache-Control": "no-store" }); res.end(body); };
const status = () => ({
  queue: state.queue,
  paused: !!state.paused,
  busy,
  nextRequestInS: state.queue.length ? Math.max(0, Math.ceil((state.lastRequestAt + MIN_GAP_MS - Date.now()) / 1000)) : null,
  gapS: MIN_GAP_MS / 1000,
  builtAt: prices.builtAt,
  log,
});

createServer((req, res) => {
  const url = new URL(req.url, "http://localhost");
  if (req.method === "GET" && (url.pathname === "/" || url.pathname === "/retail-calculator.html"))
    return send(res, 200, "text/html; charset=utf-8", readFileSync(join(DIR, "retail-calculator.html")));
  if (req.method === "GET" && url.pathname === "/retail-prices.js")
    return send(res, 200, "text/javascript; charset=utf-8", `window.SIMCO_PRICES = ${JSON.stringify(prices)};\n`);
  if (req.method === "GET" && url.pathname === "/api/prices") return send(res, 200, "application/json", JSON.stringify(prices));
  if (req.method === "GET" && url.pathname === "/api/status") return send(res, 200, "application/json", JSON.stringify(status()));
  if (req.method === "POST" && url.pathname === "/api/refresh") {
    let raw = "";
    req.on("data", (c) => { raw += c; if (raw.length > 10_000) req.destroy(); });
    req.on("end", () => {
      try {
        const { keys, front } = JSON.parse(raw);
        if (!Array.isArray(keys)) throw new Error("keys must be an array");
        const added = enqueue(keys.map(String), front === true);
        state.paused = false;
        send(res, 200, "application/json", JSON.stringify({ added, ...status() }));
      } catch (e) { send(res, 400, "application/json", JSON.stringify({ error: e.message })); }
    });
    return;
  }
  if (req.method === "POST" && url.pathname === "/api/clear") {
    state.queue = []; saveState();
    return send(res, 200, "application/json", JSON.stringify(status()));
  }
  send(res, 404, "text/plain", "not found");
}).listen(PORT, "127.0.0.1", () => console.log(`Retail calculator: http://localhost:${PORT}  (queue: ${state.queue.length})`));
