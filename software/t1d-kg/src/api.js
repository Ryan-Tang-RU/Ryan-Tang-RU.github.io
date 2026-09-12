/* The same eleven operations, answered in the browser.

   There is no server here. DuckDB-WASM runs the queries in publish/src/sql.js
   against parquet files fetched over HTTP range requests, so any static host will
   do - verified on the target host, which answers `HTTP/2 206` with
   `accept-ranges: bytes`.

   The response shapes are the local bridge's, field for field, because everything
   above this file - the store, the canvas, the panels - is unchanged. A missing
   field reads as `undefined` in JavaScript and renders as a blank panel rather
   than an error, so the contract is checked in tests/test_publish_sql.py against
   the running bridge rather than trusted.

   Parameters are bound positionally: duckdb-wasm's named-parameter and array
   binding are not dependable, so `$name` placeholders are rewritten to `?` in
   order of appearance and lists are passed as one SEP-separated string. */
const DUCKDB = "https://cdn.jsdelivr.net/npm/@duckdb/duckdb-wasm@1.29.0/";
const SEP = String.fromCharCode(31);       // chr(31), split back into a list inside the SQL
const MINC = 3;          // an edge needs three papers in one year: Step 7's rule
const HUBS = 12;         // nodes a path can be told to route around
const REL_CAP = 200;     // assertions listed per pair; the count is separate
const PAPER_PAGE = 60;
const PAPER_SCAN = 400;  // newest co-mentioning papers scanned for sentences
const SENT_PAGE = 8;
const SENT_RE = /[^.!?]*[.!?]+(?:\s|$)|[^.!?]+$/g;

const TABLES = ["entities", "entity_year", "pair_year", "corpus_year", "papers",
                "passages", "mentions", "relations", "search", "coverage", "vocab"];

let conn = null;
let manifest = null;
let onStatus = () => {};
const prepared = new Map();

const paramNames = sql => {
  const out = [];
  sql.replace(/\$(\w+)/g, (_, n) => { out.push(n); return "?"; });
  return out;
};
const positional = sql => sql.replace(/\$(\w+)/g, "?");
const flat = v => (Array.isArray(v) ? v.join(SEP) : v);

// Arrow's own types do not survive contact with the rest of the app. An int64
// column arrives as BigInt, and `Math.log10(bigint + 1)` throws rather than
// coercing - which is how the node radius took the whole canvas down while the
// panels around it kept working. A list column arrives as an Arrow vector, and
// `.filter(Boolean)` on it throws too. Both failures happened inside store
// actions, where nothing caught them, so the graph simply never appeared.
function plain(v) {
  if (v === null || v === undefined) return null;
  if (typeof v === "bigint") return Number(v);
  if (typeof v === "string" || typeof v === "number" ||
      typeof v === "boolean") return v;
  if (typeof v === "object") {
    // A 128-bit integer arrives as four 32-bit words. Turning that into a JS array
    // is how a paper count became "73,0,0,0"; the SQL casts to BIGINT so this
    // should not arise, and if it does the number is reconstructed rather than
    // silently reshaped into a list.
    if (v instanceof Uint32Array || v instanceof Int32Array) {
      // Plain arithmetic rather than BigInt literals: these are paper counts, far
      // inside 2^53, and `0n` is ES2020 syntax the syntax checker cannot parse -
      // which would mean weakening the check to keep the code.
      let out = 0;
      for (let i = v.length - 1; i >= 0; i--) out = out * 4294967296 + (v[i] >>> 0);
      return out;
    }
    if (typeof v.toArray === "function") return Array.from(v.toArray(), plain);
    if (typeof v[Symbol.iterator] === "function") return Array.from(v, plain);
    return String(v);
  }
  return v;
}

function rows(table) {
  const fields = table.schema.fields.map(f => f.name);
  const out = [];
  for (const row of table) {
    const o = {};
    for (let i = 0; i < fields.length; i++) o[fields[i]] = plain(row[fields[i]]);
    out.push(o);
  }
  return out;
}

async function run(name, params) {
  const sql = window.T1DSQL[name];
  if (!sql) throw new Error("no such query: " + name);
  let stmt = prepared.get(name);
  if (!stmt) {
    stmt = await conn.prepare(positional(sql));
    prepared.set(name, stmt);
  }
  return rows(await stmt.query(...paramNames(sql).map(n => flat(params[n]))));
}

async function boot(progress) {
  const duckdb = await import(DUCKDB + "+esm");
  progress("starting the query engine");
  const bundle = await duckdb.selectBundle({
    mvp: { mainModule: DUCKDB + "dist/duckdb-mvp.wasm",
           mainWorker: DUCKDB + "dist/duckdb-browser-mvp.worker.js" },
    eh: { mainModule: DUCKDB + "dist/duckdb-eh.wasm",
          mainWorker: DUCKDB + "dist/duckdb-browser-eh.worker.js" },
  });
  // The worker script is cross-origin, which `new Worker(url)` refuses; this
  // helper fetches it and starts it from a blob instead.
  const worker = await duckdb.createWorker(bundle.mainWorker);
  const db = new duckdb.AsyncDuckDB(new duckdb.VoidLogger(), worker);
  await db.instantiate(bundle.mainModule, bundle.pthreadWorker);
  conn = await db.connect();

  progress("reading the tables");
  manifest = await (await fetch("manifest.json")).json();
  for (const t of TABLES) {
    const file = t + ".parquet";
    // Registered as a URL, not downloaded: DuckDB then reads only the row groups a
    // query needs. `mentions` is sorted by entity, so one entity costs about
    // 350 KB of a 10 MB file rather than the whole file.
    await db.registerFileURL(file, new URL("data/" + file, location.href).href,
                             duckdb.DuckDBDataProtocol.HTTP, false);
    await conn.query("CREATE OR REPLACE VIEW " + t
                     + " AS SELECT * FROM read_parquet('" + file + "')");
  }
  return manifest;
}

const norm = s => String(s || "").toLowerCase()
  .replace(/[^a-z0-9]+/g, " ").replace(/ +/g, " ").trim();

async function timed(label, fn) {
  const t0 = performance.now();
  onStatus("running");
  try {
    const out = await fn();
    onStatus(Math.round(performance.now() - t0) + " ms");
    return out;
  } catch (e) {
    onStatus("error");
    console.warn("[api]", label, e);
    return { error: String((e && e.message) || e) };
  }
}

window.T1DApi = {
  onStatus(fn) { onStatus = fn; },
  manifest: () => manifest,

  search: (q, limit) => timed("search", async () => {
    const n = norm(q);
    if (n.length < 2) return { fields: [], rows: [] };
    // `raw` is the query as typed. The SQL prefers an exact spelling only when
    // the reader used a capital, which is the signal that the case was deliberate:
    // "CD4" is the human gene and "Cd4" the mouse one. Leaving it unbound did not
    // raise - it bound NULL, the comparison was never true, and the published
    // build quietly answered "CD4" with the mouse gene while the bridge answered
    // with the human one.
    return { fields: ["eid", "type", "id", "name", "n_papers", "species", "via"],
             rows: await run("search", { q: n, toks: n.split(" "), raw: q,
                                         limit: limit || 25 }) };
  }),

  // What the abstracts say, for a query the entity index could not answer.
  vocab: toks => timed("vocab", async () => ({
    rows: await run("vocab", { toks: toks }),
  })),

  neighbours: (eid, y0, y1, limit, exclude, types, rank) =>
    timed("neighbours", async () => {
      const p = { eid: eid, y0: y0, y1: y1, minc: MINC, limit: limit || 30,
                  ex: exclude && exclude.length ? exclude : [""],
                  types: types && types.length ? types.join(SEP) : null,
                  rank: rank === "relations" ? "relations" : "papers" };
      const rows = await run("neighbours", p);
      const tot = await run("neighbours_total", p);
      const rem = await run("neighbours_remaining", p);
      const dist = {};
      (await run("neighbours_dist", p)).forEach(r => {
        dist[r.other] = { types: r.types, counts: r.counts,
                          total: Number(r.total) };
      });
      rows.forEach(r => { r.rel_dist = dist[r.eid] || null; });
      const byType = {};
      // Minus what this response is delivering. `exclude` is the canvas as it was
      // before the call, so counting only against it kept the batch just returned
      // inside "remaining" and the button promised one whole batch too many.
      const shown = {};
      rows.forEach(r => { shown[r.type] = (shown[r.type] || 0) + 1; });
      let remaining = 0;
      rem.forEach(r => {
        const left = Number(r.n) - (shown[r.type] || 0);
        if (left > 0) { byType[r.type] = left; remaining += left; }
      });
      return { fields: Object.keys(rows[0] || {}), rows: rows,
               total_neighbours: Number((tot[0] || {}).total || 0),
               remaining: remaining, remaining_by_type: byType };
    }),

  subgraph: (eids, y0, y1) => timed("subgraph", async () => {
    const p = { eids: eids, y0: y0, y1: y1, minc: MINC };
    const rows = await run("subgraph", p);
    const dist = {};
    (await run("subgraph_dist", p)).forEach(r => {
      dist[r.a + "\u0000" + r.b] = { types: r.types, counts: r.counts,
                                      total: Number(r.total) };
    });
    rows.forEach(r => { r.rel_dist = dist[r.a + "\u0000" + r.b] || null; });
    return { rows: rows };
  }),

  // Cypher has shortestPath; this walks the frontier one hop at a time instead,
  // which is four small queries for a four-hop search and keeps hub avoidance
  // explicit.
  path: (a, b, hops, avoid) => timed("path", async () => {
    const hubs = avoid
      ? (await run("hubs", { minc: MINC, limit: HUBS }))
          .map(r => r.eid).filter(e => e !== a && e !== b)
      : [];
    let frontier = [a];
    const seen = new Set([a]);
    const from = new Map();
    const depth = Math.max(1, Math.min(hops || 4, 5));
    for (let d = 0; d < depth; d++) {
      const step = await run("bfs_step", {
        frontier: frontier, seen: Array.from(seen),
        avoid: hubs.length ? hubs : [""],
        y0: manifest.year_min, y1: manifest.year_max, minc: MINC });
      if (!step.length) break;
      step.forEach(r => {
        if (!seen.has(r.next)) { seen.add(r.next); from.set(r.next, r.from_eid); }
      });
      if (seen.has(b)) break;
      frontier = step.map(r => r.next);
    }
    if (!from.has(b)) return { rows: [] };
    const chain = [b];
    while (chain[0] !== a) chain.unshift(from.get(chain[0]));
    const meta = {};
    (await run("entities_by_ids", { eids: chain }))
      .forEach(r => { meta[r.eid] = r; });
    return { rows: [{ eids: chain,
                      names: chain.map(e => (meta[e] || {}).name || e),
                      types: chain.map(e => e.split("|")[0]),
                      hops: chain.length - 1 }] };
  }),

  relations: (a, b, y0, y1) => timed("relations", async () => {
    const pair = [a, b].slice().sort();
    const rows = await run("relations", { a: pair[0], b: pair[1], y0: y0, y1: y1,
                                          cap: REL_CAP });
    const tot = Number((await run("relations_total",
      { a: pair[0], b: pair[1], y0: y0, y1: y1 }))[0].total || 0);
    const summary = await run("relation_summary",
      { a: pair[0], b: pair[1], y0: y0, y1: y1 });
    const ta = a.split("|")[0], tb = b.split("|")[0];
    const key = [ta, tb].slice().sort().join("|");
    let pairTotal = 0, all = 0;
    (await run("pair_type_totals", {})).forEach(r => {
      all += Number(r.n);
      if ([r.t1, r.t2].slice().sort().join("|") === key) pairTotal += Number(r.n);
    });
    return { rows: rows, summary: summary, total: tot,
             truncated: rows.length < tot,
             pair_type: ta + "-" + tb, pair_type_total: pairTotal,
             relation_types_total: all };
  }),

  node: (eid, y0, y1) => timed("node", async () => {
    const base = (await run("node", { eid: eid }))[0];
    const win = (await run("node_window", { eid: eid, y0: y0, y1: y1 }))[0];
    const par = (await run("node_partners", { eid: eid, y0: y0, y1: y1 }))[0];
    const forms = await run("node_forms", { eid: eid });
    const ident = eid.split("|").slice(1).join("|");
    return { fields: ["eid"], rows: [{
      eid: eid, type: eid.split("|")[0], id: ident,
      name: (base && base.name) || ident,
      top_forms: forms.map(f => ({ text: f.text, n: Number(f.n) })),
      n_papers_corpus: Number((base && base.n_papers) || 0),
      n_papers_in_window: Number((win && win.n) || 0),
      species: base ? base.species : null,
      first_year: base ? base.first_year : null,
      last_year: base ? base.last_year : null,
      partners_all: Number((par && par.n) || 0),
    }] };
  }),

  timeline: (ctx) => timed("timeline", async () => {
    const c = ctx || {};
    const corpus = await run("corpus", { y0: manifest.year_min,
                                         y1: manifest.year_max });
    const years = corpus.map(r => Number(r.year));
    const total = {};
    corpus.forEach(r => { total[Number(r.year)] = Number(r.n_papers); });

    const counts = {}, cov = {};
    let label = "", denomLabel = "", pol = null, bursts = [];
    if (c.a && c.b) {
      const pair = [c.a, c.b].slice().sort();
      (await run("pair_series", { a: pair[0], b: pair[1] }))
        .forEach(r => { counts[Number(r.year)] = Number(r.n); });
      label = "co-mentions";
      const ta = c.a.split("|")[0], tb = c.b.split("|")[0];
      (await run("cov_pair", { ta: ta, tb: tb, y0: manifest.year_min,
                               y1: manifest.year_max }))
        .forEach(r => { cov[Number(r.year)] = Number(r.n); });
      denomLabel = ta === tb ? "papers annotated with " + ta
        : "papers annotated with both " + ta + " and " + tb;
      const rows = await run("pair_polarity", { a: pair[0], b: pair[1] });
      if (rows.length) {
        const m = {};
        rows.forEach(r => { m[Number(r.year)] = r; });
        pol = { pos: years.map(y => Number((m[y] || {}).pos || 0)),
                neg: years.map(y => Number((m[y] || {}).neg || 0)),
                total: years.map(y => Number((m[y] || {}).n || 0)) };
      }
    } else if (c.eid) {
      (await run("entity_series", { eid: c.eid }))
        .forEach(r => { counts[Number(r.year)] = Number(r.n); });
      label = "papers";
      const t = c.eid.split("|")[0];
      (await run("cov_entity", { type: t }))
        .forEach(r => { cov[Number(r.year)] = Number(r.n); });
      denomLabel = "papers annotated with " + t;
      bursts = manifest.bursts[c.eid] || [];
    }
    const series = years.map(y => counts[y] || 0);
    const denom = years.map(y => total[y] || 0);
    const dcov = years.map(y => cov[y] || 0);
    const peak = series.length ? Math.max.apply(null, series) : 0;
    const r6 = x => Math.round(x * 1e6) / 1e6;
    return {
      years: years, counts: series, corpus: denom, denom_cov: dcov,
      share_cov: series.map((v, i) => (dcov[i] ? r6(v / dcov[i]) : 0)),
      share_corpus: series.map((v, i) => (denom[i] ? r6(v / denom[i]) : 0)),
      label: label, denom_label: denomLabel,
      peak: peak, total: series.reduce((s, x) => s + x, 0),
      peak_year: peak ? years[series.indexOf(peak)] : null,
      bursts: bursts, polarity: pol,
      core_to: manifest.core_to, complete_to: manifest.year_max,
    };
  }),

  // Which pair types carry relations at all, so an empty Relations tab and a
  // faint edge can be explained rather than just shown.
  pairTypes: () => timed("pair_types", async () => ({
    rows: await run("pair_type_totals", {}),
  })),

  degree: (y0, y1, etype, limit) => timed("degree", async () => ({
    rows: await run("degree", { y0: y0, y1: y1, minc: MINC,
                                etype: etype || null, limit: limit || 30 }),
  })),

  hubs: () => timed("hubs", async () => ({
    rows: await run("hubs", { minc: MINC, limit: HUBS }),
  })),

  evidence: (a, b, y0, y1, offset) => timed("evidence", async () => {
    const pair = [a, b].slice().sort();
    const nPapers = Number((await run("evidence_count",
      { a: pair[0], b: pair[1], y0: y0, y1: y1 }))[0].n || 0);
    const rows = await run("evidence_sentences",
                           { a: a, b: b, y0: y0, y1: y1, scan: PAPER_SCAN });
    const sents = [], seen = new Set(), hit = new Set();
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      const ra = Number(r.oa) - Number(r.po), rb = Number(r.ob) - Number(r.po);
      const text = String(r.ptext);
      SENT_RE.lastIndex = 0;
      let m;
      while ((m = SENT_RE.exec(text)) !== null) {
        if (m[0].length === 0) break;      // a zero-width match would not advance
        const s0 = m.index, e0 = s0 + m[0].length;
        if (s0 <= ra && ra < e0 && s0 <= rb && rb < e0) {
          const key = r.pmid + ":" + s0;
          if (seen.has(key)) break;
          seen.add(key);
          const raw = text.slice(s0, e0);
          const lead = raw.length - raw.replace(/^\s+/, "").length;
          const spans = [[ra, Number(r.la)], [rb, Number(r.lb)]]
            .sort((x, y) => x[0] - y[0])
            .map(p => [p[0] - s0 - lead, p[0] - s0 - lead + p[1]]);
          sents.push({ pmid: Number(r.pmid), year: Number(r.year),
                       sentence: raw.trim(), spans: spans });
          hit.add(String(r.pmid));
          break;
        }
      }
    }
    const plist = offset ? [] : await run("evidence_papers",
      { a: a, b: b, y0: y0, y1: y1, limit: PAPER_PAGE });
    const papers = plist.map(p => ({
      pmid: Number(p.pmid), year: Number(p.year), title: p.title,
      same_sentence: hit.has(String(p.pmid)),
    })).sort((x, y) => (y.same_sentence - x.same_sentence) || (y.year - x.year));
    const off = offset || 0;
    return { sentences: sents.slice(off, off + SENT_PAGE),
             n_sentences: sents.length, offset: off,
             papers: papers, n_papers: nPapers,
             scanned_papers: Math.min(nPapers, PAPER_SCAN),
             scanned_rows: rows.length,
             scan_capped: nPapers > PAPER_SCAN };
  }),

  // The Cypher drawer becomes a SQL drawer: there is no Neo4j here, and the query
  // behind a view is now the query that actually ran.
  raw: (statement) => timed("raw", async () => {
    const s = String(statement || "").trim().replace(/;+$/, "");
    const bare = s.replace(/\/\*[\s\S]*?\*\//g, " ")
      .replace(/--[^\n]*/g, " ")
      .replace(/'(?:[^'\\]|\\.)*'/g, " ");
    if (/\b(CREATE|INSERT|UPDATE|DELETE|DROP|ALTER|ATTACH|COPY|INSTALL|LOAD)\b/i
        .test(bare)) {
      return { error: "read-only: this drawer runs SELECT only" };
    }
    const t = await conn.query(/\bLIMIT\b/i.test(bare) ? s : s + "\nLIMIT 200");
    return { fields: t.schema.fields.map(f => f.name), rows: rows(t) };
  }),
};

window.T1DBootDuck = boot;
