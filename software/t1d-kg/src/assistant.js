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
  const MAX_ROUNDS = 12;         // tool rounds before tools are withdrawn
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
        "The shortest chain of co-mentions between two entities. Use it whenever a " +
        "pair turns out to have no direct co-mention: that is not an answer to " +
        "\"how are these related\", it is the reason to ask this tool. Routes " +
        "around the most connected hubs, so the chain says something more than " +
        "'both appear beside type 1 diabetes'.",
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

    {
      name: "surges_in_window",
      acts: false,
      description:
        "Which entities surged during a stretch of years, largest first, with the " +
        "intervals themselves. This is the one temporal question a single entity's " +
        "series cannot answer - what rose in the 1990s - and the intervals come " +
        "from a two-state Kleinberg model over each normalised series, not from a " +
        "threshold. An interval overlapping the window counts, so a surge that " +
        "began earlier and ran into it is included.",
      schema: {
        type: "object",
        properties: {
          y0: { type: "integer" }, y1: { type: "integer" },
          limit: { type: "integer", description: "1-60, default 25" },
        },
        required: ["y0", "y1"],
      },
      run: async (i, c) => ({
        window: [i.y0, i.y1],
        rows: short(ok(await c.api.bursts(i.y0, i.y1, i.limit || 25)).rows, 60),
      }),
    },
    {
      name: "canvas_state",
      acts: false,
      description:
        "What the reader is currently looking at: the year window, the focused " +
        "entity, what is on the canvas, and what is selected. Call this first for " +
        "any question phrased about the present view - \"this edge\", \"these " +
        "nodes\", \"what am I looking at\" - because none of the other tools can " +
        "see the screen.",
      schema: { type: "object", properties: {} },
      run: async (i, c) => {
        const st = c.store.state;
        const nodes = Object.keys(st.nodes).map(k => st.nodes[k]);
        const sel = st.selection;
        let selected = null;
        if (sel && sel.kind === "node" && st.nodes[sel.eid]) {
          selected = { kind: "entity", eid: sel.eid, name: st.nodes[sel.eid].name };
        } else if (sel && sel.kind === "edge" && st.links[sel.key]) {
          const l = st.links[sel.key];
          selected = {
            kind: "pair", a: l.a, b: l.b,
            a_name: (st.nodes[l.a] || {}).name, b_name: (st.nodes[l.b] || {}).name,
            co_mention_papers: l.comention_papers,
            assertions: (l.rel_dist && l.rel_dist.total) || 0,
          };
        }
        return {
          year_window: [st.y0, st.y1],
          focus: st.focus
            ? { eid: st.focus, name: (st.nodes[st.focus] || {}).name } : null,
          selected: selected,
          nodes_on_canvas: nodes.length,
          // Capped: a full canvas holds 150 and the model needs to know what is
          // there, not every field of every node.
          canvas: short(nodes.map(n => ({ eid: n.eid, name: n.name, type: n.type })),
                        60),
          hidden_types: (st.hiddenTypes || []).slice(),
          path_ends: [st.pathA ? st.pathA.name : null,
                      st.pathB ? st.pathB.name : null],
        };
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
        // The store's own key function, not a second copy of the rule. This line
        // built the key itself and joined with a NUL byte where the store joins
        // with a space, so the lookup could never match and the tool answered
        // every request with "no edge between those two on the canvas" - a tidy
        // error that reads as a deliberate answer. It is syntactically valid and
        // parses, so only running it could find it.
        const key = window.T1DPairKey(i.a, i.b);
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
    "- If the question is about the present view - \"this edge\", \"these nodes\",",
    "  \"what am I looking at\" - call canvas_state first. No other tool can see",
    "  the screen, and the year window it reports is the window every other tool",
    "  reads.",
    "- Resolve every name with find_entity before using any other tool. Names are",
    "  not what they look like: searching \"abatacept\" returns the gene ABAT,",
    "  because this corpus never tagged the drug at all.",
    "- State no number you did not get from a tool in this conversation. If a tool",
    "  returns nothing, say that, and say which tool.",
    "- If a pair has no co-mentions, no assertions and no sentences, call connect",
    "  before saying they are unrelated. Two entities with nothing between them",
    "  directly are exactly the case the path search exists for, and \"they do not",
    "  connect\" is a different claim from \"they do not connect directly\".",
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
    "- An assertion count is not a paper count. `claims` returns assertions; the",
    "  number of papers mentioning both is `co_mentioning_papers` from `sentences`,",
    "  or the summed series from `pair_trend`. They differ by a lot - Glucose and",
    "  type 1 diabetes carry 1,932 assertions across 17,576 co-mentioning papers -",
    "  and reporting one as the other is the commonest way to be confidently wrong",
    "  here. If you are asked how many papers, fetch the paper count.",
    "- MeSH indexing lags about four years, so 2023-2025 are under-indexed. The",
    "  project's own analyses stop at 2022.",
    "",
    "The shape of an answer, by what is being asked:",
    "",
    "About one entity - what is X, tell me about X:",
    "  find_entity, then entity_facts, then partners. Say what kind of thing it",
    "  is and how much literature stands behind it, what it sits beside most, and",
    "  over what years it was active. The written forms are worth a line when they",
    "  differ from the name, because that is how a mislabelled node shows itself.",
    "",
    "About two things - how are X and Y related:",
    "  find_entity twice, then claims, then sentences. Lead with the direction and",
    "  its share, not with a list of relation types, and quote one sentence with",
    "  its PMID. If claims and sentences both come back empty, call connect before",
    "  concluding anything: no direct co-mention is not no relationship.",
    "",
    "About change over time - has X grown, when did X and Y start:",
    "  entity_trend or pair_trend. Give the first year, the peak year, and the",
    "  direction, and say which denominator you read it from. A raw count rising",
    "  is not a finding on its own. Mention that the last three years are",
    "  under-indexed if they carry your conclusion.",
    "",
    "About a ranking - which genes carry the most, what is strongest:",
    "  partners, and say which order you asked for. By assertions and by papers",
    "  give different lists and the difference is usually the point: the largest",
    "  co-mention counts are often pair types that can carry no assertion at all.",
    "",
    "About a period - what surged in the 1990s:",
    "  surges_in_window. These are burst intervals from a model over the",
    "  normalised series, so they already account for the corpus growing; say so,",
    "  because that is the first thing a reader will doubt.",
    "",
    "About whether something is here at all:",
    "  find_entity, and if that is empty, word_in_abstracts. Answer in two parts:",
    "  whether the graph has a node, and whether the literature has the word. They",
    "  are different facts and only the first is about this graph.",
    "",
    "About the view - what am I looking at, this edge, these nodes:",
    "  canvas_state first, then whatever it points at.",
    "",
    "When asked to do something - show me X, narrow the years:",
    "  do it, then say what changed in one line. Never move the view silently.",
    "",
    "Open questions - what are the main hypotheses, summarise the HLA story,",
    "what is interesting here, what should I look at:",
    "  These have no slot to fall into and they are where a model is most tempted",
    "  to answer from what it already knows. Work in four steps and show the first",
    "  one.",
    "",
    "  1. Decompose, out loud. Name the two to five entities or pairs you are",
    "     going to look at and why those. \"For aetiology I looked at enterovirus,",
    "     vitamin D, HLA-DQB1 and the hygiene hypothesis\" lets the reader see what",
    "     you left out, which is the part they can correct.",
    "  2. Retrieve each one. find_entity, then whichever of claims, sentences,",
    "     partners or the trends the sub-question needs. An open question needs",
    "     several retrievals; one is not an answer to it.",
    "  3. Answer only from what came back, with the numbers attached.",
    "  4. End with one sentence naming what this graph cannot tell you about",
    "     this question. It is the last thing you write, and it is a limit, not",
    "     an offer of further work - \"I can also compare X\" is not that sentence",
    "     and does not replace it. A co-mention graph shows what was written",
    "     about together: not what is true, not what is causal, not what was",
    "     tried and not published, and nothing at all about anything untagged.",
    "",
    "  If your decomposition finds nothing - the entities are untagged, or the",
    "  pairs are empty - say that, and name a different decomposition the reader",
    "  could ask for. Do not substitute what you know about the subject. An answer",
    "  assembled from your own training is the one failure this whole interface is",
    "  built to prevent, and it is indistinguishable from a good one until someone",
    "  checks a number.",
    "",
    "When the question fits none of these, retrieve what it plainly needs and say",
    "what you could not reach. A partial answer with its gaps named is worth more",
    "than a complete-sounding one.",
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
  async function ask(question, history, ctx, onEvent, shouldStop) {
    const key = getKey();
    if (!key) throw new Error("no key");
    const stop = shouldStop || function () { return false; };
    const messages = (history || []).concat([{ role: "user", content: question }]);
    for (let round = 0; round < MAX_ROUNDS; round++) {
      // Checked between rounds, which is where the waiting happens: a question
      // that needs eight tool calls leaves the reader with nothing to do but
      // watch. The transcript keeps whatever was gathered, so stopping is not
      // the same as losing the turn.
      if (stop()) return { messages: messages, text: "", stopped: true };
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
    // Out of rounds, with a transcript full of evidence and nothing said. Asking
    // once more without tools forces an answer from what was already gathered,
    // which is the whole point of having gathered it: a question that ran eight
    // steps deep - four resolutions, a path search, claims and sentences - used
    // to end with "stopped after too many steps" and no answer at all.
    const last = await post(key, {
      model: MODEL, max_tokens: MAX_TOKENS,
      system: SYSTEM + "\n\nYou are out of tool calls. Answer now from what the "
              + "tools already returned, and say which part of the question you "
              + "could not reach.",
      messages: messages,
    });
    const tail = (last.content || []).filter(b => b.type === "text")
      .map(b => b.text).join("");
    if (tail) onEvent({ kind: "text", text: tail });
    return { messages: messages.concat([{ role: "assistant",
                                          content: last.content || [] }]),
             text: tail, capped: true };
  }

  // Words that are never the subject of a question. Without this list the
  // no-key path answered "what does the graph say about vitamin D" with Graphite
  // and Say Meyer syndrome, and "is liraglutide in this graph" with Micrognathism:
  // every one of them a real entity whose name contains a function word.
  const STOP = ("a about above after again against all also am an and any are as " +
    "at be because been before being below between both but by can cannot could " +
    "did do does doing down during each few for from further had has have having " +
    "he her here hers him his how i if in into is it its itself just me more most " +
    "much must my no nor not now of off on once only or other our out over own " +
    "same she should so some such than that the their them then there these they " +
    "this those through to too under until up very was we were what when where " +
    "which while who whom why will with would you your " +
    // asked of this tool constantly, and none of them is the subject
    "graph graphs data dataset show tell say says said give list find search " +
    "many much often when time times year years paper papers study studies " +
    "know anything something between related relation relationship link linked " +
    // structural in this domain and never the subject: "type 1", "type 2",
    // "type I hypersensitivity". Left in, "type" resolved to Hypersensitivity
    // Immediate beside the Diabetes Mellitus that "diabetes" had already found.
    "type types level levels risk rate effect effects role patient patients " +
    // the verbs and comparatives a question is framed in. "connect" was reported
    // as a word with 74 abstracts and no node, which is true of every English
    // verb and is not what the reader asked.
    "connect connects connected relate relates related affect affects cause " +
    "causes compare compares mention mentions appear appears associate " +
    "associates link links find finds tell explain describe list rank " +
    "strong strongest stronger most more less best better main major common " +
    "important different same other studied happen happens work works"
    ).split(" ");

  // Alphanumeric pieces of a string, lowercased. Compared as sets rather than by
  // substring: "graph" is inside "graphite" and is not that entity, while
  // "HLA-DQB1" and "hla dqb1" are the same name written two ways.
  function pieces(t) {
    return String(t || "").toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
  }
  // No RegExp built from the reader's text: a name in this corpus can carry a
  // backslash ("C57BL\\6", "type \\1 diabetes") and compiling one as a pattern
  // throws on an invalid escape.
  function names_match(word, row) {
    const w = pieces(word);
    if (!w.length) return false;
    const inside = set => w.every(x => set.indexOf(x) !== -1);
    // `via` is the server saying which string it matched on, so a hit there is a
    // hit by definition. It is also the only one that works for a variant: the
    // node for rs2476601 is named c.1858C>T and its id is the raw composite
    // "tmVar:p|SUB|R|620|W;HGVS:p.R620W;...;RS#:2476601;...", which contains
    // "2476601" but never "rs2476601" - so asking about it was answered with
    // "no node", about a node that is right there.
    // The eid's own tail is the canonical key, which for a variant is the rs
    // number itself.
    return inside(pieces(row.name)) || inside(pieces(row.id))
      || (row.via && inside(pieces(row.via)))
      || inside(pieces(String(row.eid).split("|").slice(1).join("|")));
  }

  /* What the panel can still answer with no key at all.

     Retrieval is local, so a question without a key is not useless: the entities
     named in it can be resolved and their facts shown, and a word that names no
     entity can still be counted in the abstracts - which for a drug is the whole
     answer. The prose is what needs the model, and the prose was never the
     evidence. */
  async function lookup(question, ctx) {
    /* Phrases first, longest first, and only then the words inside them.

       Searching word by word answered "what does Diabetic Nephropathies connect
       to most strongly?" with Diabetes Mellitus and Kidney Diseases - one from
       "diabetic", one from "nephropathies" - while Diabetic Nephropathies, which
       is a node with 4,802 papers, was never searched at all. Most entity names
       in this corpus are two or three words, so the phrase is the thing to try. */
    const kept = pieces(question).map(
      w => (w.length >= 3 && STOP.indexOf(w) === -1) ? w : null);
    const words = [];
    for (let n = 4; n >= 2; n--) {
      for (let i = 0; i + n <= kept.length; i++) {
        const run = kept.slice(i, i + n);
        if (run.some(x => x === null)) continue;   // a stop word breaks a phrase
        words.push(run.join(" "));
      }
    }
    kept.forEach(w => {
      if (w && w.length >= 4 && words.indexOf(w) === -1) words.push(w);
    });
    // Names carrying a hyphen, a dot or a slash survive as one token too, so
    // "HLA-DQB1", "rs2476601" and "C57BL/6" are looked up whole rather than only as
    // their pieces. The slash matters: split on it, "C57BL" ranked C57BL/KsJ - 50
    // papers - above the C57BL/6 with 546 that was actually asked about.
    String(question || "").split(/[^A-Za-z0-9./\-]+/).forEach(w => {
      if (w.length >= 4 && /[-./]/.test(w) && words.indexOf(w) === -1)
        words.unshift(w);
    });

    const seen = {}, found = [], unmatched = [], claimed = {};
    for (const w of words.slice(0, 14)) {
      if (found.length >= 3) break;
      // Already explained by something found. "C-peptide" resolves, and then its
      // piece "peptide" was searched separately and landed on the generic Peptides
      // node - two answers to one phrase, the second of them noise.
      if (pieces(w).every(x => claimed[x])) continue;
      const row = (ok(await ctx.api.search(w, 1)).rows || [])[0];
      if (!row || seen[row.eid] || !names_match(w, row)) {
        unmatched.push(w.toLowerCase());
        continue;
      }
      seen[row.eid] = true;
      pieces(row.name).forEach(x => { claimed[x] = true; });
      pieces(w).forEach(x => { claimed[x] = true; });
      const facts = ok(await ctx.api.node(row.eid,
                                          ctx.store.state.y0, ctx.store.state.y1));
      found.push({ row: row, facts: (facts.rows || [])[0] || null });
    }

    // A word that resolved to nothing may still be all over the abstracts. This is
    // the tagging gap, and for a drug it is the answer: liraglutide is written in
    // 159 abstracts here and was never tagged, so "no entity" is a fact about the
    // labelling and not about the field.
    //
    // Two filters, both from measurement rather than taste.
    //
    // A word already accounted for by something that did resolve is dropped:
    // "peptide" out of C-Peptide and "dqb1" out of HLA-DQB1 were being reported as
    // having no node, next to the node they came from.
    //
    // And an upper bound on how common the word is. Every untagged entity this
    // project found is rare - insulin degludec 285 abstracts, pramlintide 169,
    // liraglutide 159, semaglutide 87 - because anything more central than that
    // was tagged. The function words that slip through the stop list are an order
    // of magnitude commoner: "start" 1,075, "together" 3,012, "peptide" 7,271. A
    // ceiling separates them on that evidence, where frequency alone would have
    // cut liraglutide and kept "together".
    found.forEach(f => pieces(f.row.id).forEach(x => { claimed[x] = true; }));
    const candidates = unmatched.filter(w => !pieces(w).every(x => claimed[x]));
    let untagged = [];
    if (candidates.length) {
      const rows = ok(await ctx.api.vocab(candidates.slice(0, 8))).rows || [];
      // No inflected English word is an entity name. "appearing" slips past both
      // the stop list and the ceiling at 138 abstracts; no drug, gene or disease
      // in this corpus ends in -ing, -ed, -ly or -est.
      const inflected = w => /(ing|ed|ly|est)$/.test(w);
      untagged = rows
        .filter(r => r.n_papers >= 5 && r.n_papers <= 600 && !inflected(r.tok))
        .sort((a, b) => a.n_papers - b.n_papers)   // rarest first: the likeliest term
        .slice(0, 2);
    }
    return { found: found, untagged: untagged };
  }

  return { TOOLS: TOOLS, SYSTEM: SYSTEM, MODEL: MODEL,
           ask: ask, lookup: lookup, getKey: getKey, setKey: setKey };
})();
