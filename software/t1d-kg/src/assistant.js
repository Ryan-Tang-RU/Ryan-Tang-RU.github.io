/* The assistant: retrieval over this graph, and the actions it can take on it.

   Two halves, split along the one line that matters on a static host.

   Retrieval runs entirely here. Every tool below is a call into T1DApi, which is
   the local bridge in one build and DuckDB-WASM over parquet in the other - the
   same method names either way, so this file is shared and neither build has a
   second implementation to drift from.

   Generation needs a key, and a key cannot ship in a public page. So the reader
   supplies their own, it is held in localStorage on their machine, and it is sent
   to api.anthropic.com and nowhere else. Without one the panel still resolves the
   entities in a question and shows what it would have retrieved, which is most of
   the value: the numbers are the answer, the prose is a convenience.

   The system prompt carries what this project measured the hard way. A general
   model asked about a co-mention graph will say "strongly associated" about a pair
   whose count is the corpus growing, and will answer "abatacept" with the gene
   ABAT. Each rule below is there because that failure actually happened here. */
window.T1DAssistant = (function () {
  "use strict";

  const ENDPOINT = "https://api.anthropic.com/v1/messages";
  const MODEL = "claude-sonnet-5";
  const KEY_ITEM = "t1dkg.key";
  const MAX_ROUNDS = 8;          // tool rounds before the loop gives up
  const MAX_TOKENS = 2048;

  // ---- the key ---------------------------------------------------------------
  // localStorage can throw outright in a private window or with site data blocked,
  // so every access is guarded: the panel must render whatever the browser allows.
  function getKey() {
    try { return localStorage.getItem(KEY_ITEM) || ""; } catch (e) { return ""; }
  }
  function setKey(k) {
    try {
      if (k) localStorage.setItem(KEY_ITEM, k);
      else localStorage.removeItem(KEY_ITEM);
      return true;
    } catch (e) { return false; }
  }

  // ---- helpers ---------------------------------------------------------------
  const YEARS = st => ({ y0: st.y0, y1: st.y1 });

  // Timelines are 66 years long and the model does not need every zero. Non-zero
  // years only, with the two shares this project normalises by, because the raw
  // count alone is the trap: the corpus grows about 25-fold across the span, so
  // almost every raw series rises.
  function series(t) {
    if (!t || !t.years) return { years: [], note: "no series" };
    const out = [];
    for (let i = 0; i < t.years.length; i++) {
      if (!t.counts[i]) continue;
      const row = { year: t.years[i], papers: t.counts[i] };
      // The field names are the server's, checked against a live response. An
      // invented one - `share_all` for what is actually `share_corpus` - reads as
      // absent rather than wrong: the denominator simply never appears, and the
      // model answers about a trend from the raw count, which is the one thing the
      // prompt tells it not to do.
      if (t.share_corpus && t.share_corpus[i] != null)
        row.per_1000_papers = Math.round(t.share_corpus[i] * 1e5) / 100;
      if (t.share_cov && t.share_cov[i] != null)
        row.per_1000_annotated = Math.round(t.share_cov[i] * 1e5) / 100;
      out.push(row);
    }
    return {
      years: out,
      total_papers: t.total,
      peak_year: t.peak_year == null ? null : t.peak_year,
      // What the second denominator actually counts, so the model can name it
      // rather than saying "normalised".
      second_denominator_is: t.denom_label || null,
      bursts: t.bursts || null,
      // Where the data stops being trustworthy, in the response rather than only
      // in the prompt.
      complete_to: t.complete_to == null ? null : t.complete_to,
      project_analyses_stop_at: t.core_to == null ? null : t.core_to,
    };
  }

  function short(rows, n) { return (rows || []).slice(0, n); }

  /* A failed request must not arrive at the model as an empty result.

     `(await api.search(x)).rows` is undefined when the call failed, which became
     `{matches: []}` - indistinguishable from "no such entity". The model would then
     report that nothing in the graph is called X, on the strength of a request that
     never completed. Every tool routes its response through this, so a failure is
     labelled as one and the system prompt's rule about saying which tool failed has
     something to act on. */
  function ok(res) {
    if (res && res.error) throw new Error(res.error);
    return res || {};
  }

  // ---- the tools -------------------------------------------------------------
  // `run` receives the parsed input and a context of { api, store }. Anything that
  // changes the canvas is marked `acts`, which the panel shows differently: a
  // reader should be able to see that a question moved their view.
  const TOOLS = [
    {
      name: "find_entity",
      acts: false,
      description:
        "Resolve a name, symbol or abbreviation to entities in this graph. ALWAYS " +
        "call this before any other tool: the other tools take eids, not names, " +
        "and a name does not always mean what it looks like. Returns eid, type, " +
        "paper count, `via` when the match was on a written form rather than the " +
        "name, and `others` when more entities share that name (usually the same " +
        "gene in other species).",
      schema: {
        type: "object",
        properties: { name: { type: "string", description: "name, symbol or abbreviation" } },
        required: ["name"],
      },
      run: async (i, c) => ({ matches: short(ok(await c.api.search(i.name, 6)).rows, 6) }),
    },
    {
      name: "entity_facts",
      acts: false,
      description:
        "Facts about one entity: papers in the current year window and in the whole " +
        "corpus, the years it is active, how many entities it appears with, and the " +
        "strings papers actually write for it. The written forms matter - they are " +
        "how you tell a mislabelled node from a real one.",
      schema: {
        type: "object",
        properties: { eid: { type: "string" } },
        required: ["eid"],
      },
      run: async (i, c) => {
        const r = ok(await c.api.node(i.eid, c.store.state.y0, c.store.state.y1));
        return (r.rows && r.rows[0]) || { not_found: i.eid };
      },
    },
    {
      name: "entity_trend",
      acts: false,
      description:
        "One entity's papers per year, with both denominators: per 1,000 papers of " +
        "the whole corpus, and per 1,000 papers that carry an identified mention of " +
        "that entity type. Use the normalised figures for any claim about rising or " +
        "falling. Also returns burst intervals where the graph detected them.",
      schema: {
        type: "object",
        properties: { eid: { type: "string" } },
        required: ["eid"],
      },
      run: async (i, c) => series(ok(await c.api.timeline({ eid: i.eid }))),
    },
    {
      name: "pair_trend",
      acts: false,
      description:
        "Papers per year that mention both entities. This is the temporal core of " +
        "the graph: use it for when two things began to be studied together, and " +
        "when that peaked.",
      schema: {
        type: "object",
        properties: { a: { type: "string" }, b: { type: "string" } },
        required: ["a", "b"],
      },
      run: async (i, c) => series(ok(await c.api.timeline({ a: i.a, b: i.b }))),
    },
    {
      name: "partners",
      acts: false,
      description:
        "The entities most often co-mentioned with this one, in the current year " +
        "window. `rank` 'relations' orders by how many extracted assertions the " +
        "pair carries, 'papers' by co-mention count. They answer different " +
        "questions: the largest co-mention counts are often pair types that can " +
        "never carry an assertion.",
      schema: {
        type: "object",
        properties: {
          eid: { type: "string" },
          rank: { type: "string", enum: ["relations", "papers"] },
          limit: { type: "integer", description: "1-25, default 15" },
        },
        required: ["eid"],
      },
      run: async (i, c) => {
        const r = ok(await c.api.neighbours(i.eid, c.store.state.y0, c.store.state.y1,
          Math.min(Math.max(i.limit || 15, 1), 25), [], null,
          i.rank === "papers" ? "papers" : "relations"));
        return {
          total_partners: r.total_neighbours,
          rows: short((r.rows || []).map(x => ({
            eid: x.eid, name: x.name, type: x.type,
            co_mention_papers: x.papers,
            assertions: (x.rel_dist && x.rel_dist.total) || 0,
            relation_types: (x.rel_dist && x.rel_dist.types) || [],
          })), 25),
        };
      },
    },
    {
      name: "claims",
      acts: false,
      description:
        "The extracted assertions for a pair, as a distribution over relation types " +
        "with counts. Report these as shares, never as a set of names: a pair can " +
        "carry 3,916 Association, 2,450 Negative_Correlation and 1 " +
        "Positive_Correlation, and listing the three as equals misrepresents it. " +
        "Zero assertions is often structural rather than meaningful - see the notes.",
      schema: {
        type: "object",
        properties: { a: { type: "string" }, b: { type: "string" } },
        required: ["a", "b"],
      },
      run: async (i, c) => {
        const r = ok(await c.api.relations(i.a, i.b,
                                          c.store.state.y0, c.store.state.y1));
        const tot = Number(r.total) || 0;
        // Shares are computed here rather than left to the model, because the
        // whole point of this tool is that a set of type names misrepresents the
        // pair: 3,916 Association beside 1 Positive_Correlation is not two facts.
        const by = (r.summary || []).map(x => ({
          relation_type: x.relation_type, n: x.n,
          share_pct: tot ? Math.round((Number(x.n) / tot) * 1000) / 10 : null,
        }));
        return {
          total_assertions: tot,
          by_type: by,
          pair_type: r.pair_type,
          assertions_for_this_pair_type_corpus_wide: r.pair_type_total,
        };
      },
    },
    {
      name: "sentences",
      acts: false,
      description:
        "Sentences from abstracts that name both entities, with their PMIDs. This " +
        "is the only tool that returns text a human wrote. Quote from it when the " +
        "question is about what the literature says, and cite the PMID.",
      schema: {
        type: "object",
        properties: { a: { type: "string" }, b: { type: "string" } },
        required: ["a", "b"],
      },
      run: async (i, c) => {
        const r = ok(await c.api.evidence(i.a, i.b,
                                         c.store.state.y0, c.store.state.y1, 0));
        return {
          co_mentioning_papers: r.n_papers,
          papers_scanned_for_sentences: r.scanned_papers,
          scan_was_capped: r.scan_capped,
          sentences: short((r.sentences || []).map(s =>
            ({ pmid: s.pmid, year: s.year, sentence: s.sentence })), 6),
        };
      },
    },
    {
      name: "word_in_abstracts",
      acts: false,
      description:
        "How many abstracts contain a word, whether or not anything was tagged " +
        "there. Use this whenever find_entity comes back empty: a drug can be named " +
        "in hundreds of abstracts and have no node at all, and 'no node' is a fact " +
        "about the tagging, not about the literature.",
      schema: {
        type: "object",
        properties: { word: { type: "string" } },
        required: ["word"],
      },
      run: async (i, c) => ({
        rows: ok(await c.api.vocab([String(i.word || "").toLowerCase()])).rows || [],
      }),
    },
    {
      name: "connect",
      acts: false,
      description:
        "The shortest chain of co-mentions between two entities that are not " +
        "directly connected. Routes around the most connected hubs, so the chain " +
        "says something more than 'both appear beside type 1 diabetes'.",
      schema: {
        type: "object",
        properties: { a: { type: "string" }, b: { type: "string" } },
        required: ["a", "b"],
      },
      run: async (i, c) => {
        const r = ok(await c.api.path(i.a, i.b, 4, true));
        return { hops: short(r.rows, 8) };
      },
    },

    // ---- the actions ---------------------------------------------------------
    {
      name: "show_on_canvas",
      acts: true,
      description:
        "Draw the canvas around one entity and select it, exactly as clicking it " +
        "would. Use this when the answer is easier to see than to describe, and say " +
        "in your reply that you have done it.",
      schema: {
        type: "object",
        properties: { eid: { type: "string" } },
        required: ["eid"],
      },
      run: async (i, c) => {
        const row = (ok(await c.api.search(i.eid, 1)).rows || [])[0];
        c.store.commit("upsertNode", {
          eid: i.eid, type: row ? row.type : "Gene",
          id: i.eid.split("|").slice(1).join("|"),
          name: row ? row.name : i.eid,
          total_papers: row ? row.n_papers : null,
        });
        await c.store.dispatch("focusOn", { eid: i.eid });
        return { shown: i.eid };
      },
    },
    {
      name: "set_years",
      acts: true,
      description:
        "Narrow or widen the year window every other tool reads, and reload the " +
        "canvas for it. The corpus runs 1960-2025; MeSH indexing lags about four " +
        "years, so the last three are under-indexed and the project's own analyses " +
        "stop at 2022.",
      schema: {
        type: "object",
        properties: { y0: { type: "integer" }, y1: { type: "integer" } },
        required: ["y0", "y1"],
      },
      run: async (i, c) => {
        c.store.commit("setYears", { y0: i.y0, y1: i.y1 });
        await c.store.dispatch("reloadYears");
        return { window: [c.store.state.y0, c.store.state.y1] };
      },
    },
    {
      name: "open_pair_evidence",
      acts: true,
      description:
        "Open the evidence panel for one pair, so the reader sees the papers and " +
        "sentences themselves. Both entities must already be on the canvas - call " +
        "show_on_canvas first if they are not.",
      schema: {
        type: "object",
        properties: { a: { type: "string" }, b: { type: "string" } },
        required: ["a", "b"],
      },
      run: async (i, c) => {
        const key = [i.a, i.b].slice().sort().join(" ");
        const link = c.store.state.links[key];
        if (!link) return { error: "no edge between those two on the canvas" };
        c.store.commit("select", { kind: "edge", key: key });
        await c.store.dispatch("loadEvidence", link);
        return { opened: key };
      },
    },
  ];

  const byName = {};
  TOOLS.forEach(t => { byName[t.name] = t; });

  // ---- what the model is told -------------------------------------------------
  // Every rule here is a mistake this project actually made and measured. A model
  // without them will say "strongly associated" about a rising raw count, answer
  // "abatacept" with the gene ABAT, and read a missing relation as an absent one.
  const SYSTEM = [
    "You answer questions about a knowledge graph built from 131,511 PubMed records",
    "on type 1 diabetes, 1960-2025. Entities and relations come from PubTator 3.0;",
    "relations are BioRED types with scores.",
    "",
    "How to work:",
    "- Resolve every name with find_entity before using any other tool. Names are",
    "  not what they look like: searching \"abatacept\" returns the gene ABAT,",
    "  because this corpus never tagged the drug at all.",
    "- State no number you did not get from a tool in this conversation. If a tool",
    "  returns nothing, say that, and say which tool.",
    "- If find_entity finds nothing, call word_in_abstracts before concluding",
    "  anything. Drug coverage is uneven: of those tested, 19 of 19 small molecules",
    "  and 11 of 11 monoclonal antibodies are tagged, and 11 of 15 peptide and",
    "  fusion-protein drugs are not - the whole GLP-1 class among them. \"No node\"",
    "  is a fact about the tagging, never about the field.",
    "",
    "What the numbers mean:",
    "- An edge means two entities appear in the same paper. That is co-mention, not",
    "  a claim and never a cause. Say \"appears with\", not \"is linked to\".",
    "- Raw counts per year are almost always misleading: the corpus grows about",
    "  25-fold from 1960 to 2025, so nearly everything rises. Use the normalised",
    "  series for any claim about a trend, and say which denominator you used.",
    "- Zero assertions for a pair is usually structural. Relations exist only among",
    "  Gene, Disease, Chemical and Variant; Species appears in none of 262,510, and",
    "  Disease-Disease is zero by BioRED's design. Check pair_type before reading",
    "  anything into an absence.",
    "- Report relation types as shares of the total, not as a list. One assertion",
    "  and three thousand are not two facts of equal weight.",
    "- MeSH indexing lags about four years, so 2023-2025 are under-indexed. The",
    "  project's own analyses stop at 2022.",
    "",
    "How to answer:",
    "- Short. Lead with the number or the finding, then the evidence.",
    "- Cite PMIDs when you quote a sentence.",
    "- When the answer is easier to see than to read, use show_on_canvas or",
    "  open_pair_evidence and say that you moved the view.",
    "- If the graph cannot answer the question, say so plainly and say what it",
    "  would take. Do not fill the gap from general knowledge; if you add anything",
    "  from outside this corpus, label it as outside it.",
  ].join("\n");

  const schemas = () => TOOLS.map(t => ({
    name: t.name, description: t.description, input_schema: t.schema,
  }));

  // ---- the loop ---------------------------------------------------------------
  async function post(key, body) {
    const res = await fetch(ENDPOINT, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": key,
        "anthropic-version": "2023-06-01",
        // Required for a browser to call the API directly. Without a server there
        // is nowhere else to call it from.
        "anthropic-dangerous-direct-browser-access": "true",
      },
      body: JSON.stringify(body),
    });
    const text = await res.text();
    let json = null;
    try { json = JSON.parse(text); } catch (e) { /* fall through to the raw text */ }
    if (!res.ok) {
      const msg = (json && json.error && json.error.message) || text.slice(0, 300);
      throw new Error(res.status + " " + msg);
    }
    return json;
  }

  /* Run one question to an answer, reporting each step.

     `onEvent` is called with {kind, ...} as the turn progresses, so the panel can
     show the tool calls rather than a spinner. Showing them is the point: this
     project's recurring failure is a confident number with nothing behind it, and
     a reader who can see which query produced a figure can check it. */
  async function ask(question, history, ctx, onEvent) {
    const key = getKey();
    if (!key) throw new Error("no key");
    const messages = (history || []).concat([{ role: "user", content: question }]);
    for (let round = 0; round < MAX_ROUNDS; round++) {
      const reply = await post(key, {
        model: MODEL, max_tokens: MAX_TOKENS, system: SYSTEM,
        tools: schemas(), messages: messages,
      });
      const blocks = reply.content || [];
      const text = blocks.filter(b => b.type === "text").map(b => b.text).join("");
      const calls = blocks.filter(b => b.type === "tool_use");
      if (text) onEvent({ kind: "text", text: text });
      if (!calls.length) return { messages: messages.concat([
        { role: "assistant", content: blocks }]), text: text };

      messages.push({ role: "assistant", content: blocks });
      const results = [];
      for (const call of calls) {
        const tool = byName[call.name];
        onEvent({ kind: "tool", name: call.name, input: call.input,
                  acts: !!(tool && tool.acts) });
        let out;
        try {
          out = tool ? await tool.run(call.input || {}, ctx)
                     : { error: "no such tool: " + call.name };
        } catch (e) {
          // A failed tool is reported to the model as a failure, not swallowed:
          // otherwise it answers from nothing and the answer looks the same.
          out = { error: String((e && e.message) || e) };
        }
        onEvent({ kind: "result", name: call.name, output: out });
        results.push({ type: "tool_result", tool_use_id: call.id,
                       content: JSON.stringify(out) });
      }
      messages.push({ role: "user", content: results });
    }
    return { messages: messages, text: "", capped: true };
  }

  /* What the panel can still answer with no key at all.

     Retrieval is local, so a question without a key is not useless: the entities
     named in it can be resolved and their facts shown. The prose is what needs the
     model, and the prose was never the evidence. */
  async function lookup(question, ctx) {
    const words = String(question || "")
      .replace(/[^A-Za-z0-9\-]+/g, " ").split(" ")
      .filter(w => w.length >= 3);
    const seen = {}, found = [];
    for (const w of words.slice(0, 12)) {
      if (found.length >= 3) break;
      const row = (ok(await ctx.api.search(w, 1)).rows || [])[0];
      if (!row || seen[row.eid]) continue;
      // Only a hit the reader would recognise as the word they typed, so a fuzzy
      // match on a stray preposition does not become "the entity you asked about".
      if (String(row.name).toLowerCase().indexOf(w.toLowerCase()) === -1
          && String(row.id).toLowerCase() !== w.toLowerCase()) continue;
      seen[row.eid] = true;
      const facts = ok(await ctx.api.node(row.eid,
                                          ctx.store.state.y0, ctx.store.state.y1));
      found.push({ row: row, facts: (facts.rows || [])[0] || null });
    }
    return found;
  }

  return { TOOLS: TOOLS, SYSTEM: SYSTEM, MODEL: MODEL,
           ask: ask, lookup: lookup, getKey: getKey, setKey: setKey };
})();
