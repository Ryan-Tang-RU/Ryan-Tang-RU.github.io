/* Vuex store, mirroring the PanKbase stack so this lifts into that app unchanged.
   All graph state lives here; components stay presentational. */
Vue.use(Vuex);

const FOCUS_TOP = 30;     // neighbours loaded when an entity becomes the focus
// One fixed batch, clicked as many times as the reader wants. A 20/40/80 picker
// asked for an arbitrary number before anything had been seen, and named a figure
// the click could not keep: the focus had already loaded the top 30, so "Add 80"
// added 50. The batch is exact now, because the server is told what to skip.
const EXPAND_BATCH = 20;   // also exposed as state.expandBatch, for the panel

// An edge carries a relation when the extractor asserted something for that pair in
// some paper. Defined once: the canvas, the rail and the inspector all ask.
const hasRel = l => ((l && l.relation_types) || []).filter(Boolean).length > 0;

// The ring marks the batch Undo would take back - the top of the stack, nothing
// else. "What did that do" is answered by showing which nodes arrived.
function markFresh(s) {
  const top = s.expandStack[s.expandStack.length - 1];
  const fresh = {};
  (top ? top.added : []).forEach(e => { fresh[e] = true; });
  Object.keys(s.nodes).forEach(e => { s.nodes[e].justAdded = !!fresh[e]; });
  s.version++;
}
const SUBGRAPH_MAX = 600; // nodes we still derive all cross-edges for

const pairKey = (a, b) => (a < b ? a + " " + b : b + " " + a);

window.T1DStore = new Vuex.Store({
  state: {
    nodes: {},            // eid -> node (d3 mutates x/y/fx/fy in place)
    links: {},            // pairKey -> link
    focus: null,
    selection: null,      // {kind:'node', eid} | {kind:'edge', key}
    history: [],
    y0: 1960, y1: 2025,
    hiddenTypes: [],
    pathA: null, pathB: null, pathEids: [], avoidHubs: true,
    hubs: [],
    evidence: null,
    // Hover lives here, not inside the canvas, because two views point at the same
    // thing: running down the connection list should light up the matching node and
    // edge in the graph, which is impossible while the canvas owns the state.
    hoverEid: null,
    hoverKey: null,
    returnTo: null,
    // A stack, not one slot. Show-more is meant to be clicked repeatedly, so undo
    // has to walk back the same way: one batch per press, newest first.
    expandStack: [],
    lastRemoved: null,   // the node and edges Undo would put back
    // What is still not shown for a node, and how it breaks down by type. Both are
    // computed server-side with the canvas contents excluded, which is what lets a
    // button state an exact number instead of an upper bound.
    neighbourRemaining: {},
    // all | emphasise | only. The default emphasises rather than hides, because
    // 12,460 of the graph's 16,106 relation-less edges are pair types that can
    // never carry one - Disease-Disease by BioRED's design, anything with Species
    // because Species appears in none of the 262,510 relations. Hiding them filters
    // the extractor's vocabulary and calls it filtering the literature: it would
    // take type 1 diabetes' edges to Diabetes Mellitus and to type 2 out of the
    // graph, which are among the most substantive links in this corpus.
    edgeMode: "emphasise",
    // What "strongest partner" means, and the default. By co-mentions the top of
    // the list is the pair types that can never carry a relation - ten of type 1
    // diabetes' first thirty partners have anything to open. By relations it is
    // thirty of thirty, so that is the default: a reader clicking an edge should
    // find something behind it. Co-mention order is one click away, and it is still
    // what the edge thickness means.
    rankBy: "relations",
    expandBatch: EXPAND_BATCH,
    pairTypes: null,
    relations: null,
    relationsTotal: null,
    relationsSummary: null,
    relationsPairType: null,
    relationsPairTotal: null,
    relationsCorpusTotal: null,
    neighbourTotals: {},
    nodeFacts: {},
    cypher: "",
    status: "ready",
    lastError: null,
    retry: null,
    // Bumped whenever the graph shape changes. The canvas watches this instead of
    // the node/link arrays: Object.values() returns a fresh array on every read, so
    // array watchers fired on unrelated state changes, re-ran the d3 join and
    // restarted the simulation mid-gesture - which swallowed double-clicks.
    version: 0
  },
  getters: {
    visibleNodes: s => Object.values(s.nodes)
      .filter(n => s.hiddenTypes.indexOf(n.type) === -1),
    visibleLinks: (s, g) => {
      const ok = {};
      g.visibleNodes.forEach(n => { ok[n.eid] = true; });
      const here = Object.values(s.links).filter(l => ok[l.a] && ok[l.b]);
      return s.edgeMode === "only" ? here.filter(hasRel) : here;
    },
    // What the "only relations" setting is doing, in numbers, so it can say so.
    edgeStats: (s, g) => {
      const ok = {};
      g.visibleNodes.forEach(n => { ok[n.eid] = true; });
      const here = Object.values(s.links).filter(l => ok[l.a] && ok[l.b]);
      let withRel = 0, impossible = 0;
      here.forEach(l => {
        if (hasRel(l)) { withRel++; return; }
        const a = s.nodes[l.a], b = s.nodes[l.b];
        if (!a || !b || !s.pairTypes) return;
        const key = [a.type, b.type].slice().sort().join("|");
        if (!(key in s.pairTypes)) impossible++;
      });
      return { total: here.length, withRel: withRel,
               hidden: here.length - withRel, impossible: impossible };
    },
    focusNode: s => (s.focus ? s.nodes[s.focus] : null),
    selectedNode: s => (s.selection && s.selection.kind === "node"
      ? s.nodes[s.selection.eid] : null),
    selectedLink: s => (s.selection && s.selection.kind === "edge"
      ? s.links[s.selection.key] : null),
    degreeOf: s => eid => Object.values(s.links)
      .filter(l => l.a === eid || l.b === eid).length,
    orphaned: (s, g) => eid => g.degreeOf(eid) === 0 && Object.keys(s.links).length > 0,
    onCanvas: s => eid => !!s.nodes[eid],
    onPath: s => link =>
      s.pathEids.indexOf(link.a) !== -1 && s.pathEids.indexOf(link.b) !== -1
  },
  mutations: {
    upsertNode(s, node) {
      const cur = s.nodes[node.eid];
      if (cur) { Object.keys(node).forEach(k => { cur[k] = node[k]; }); }
      // Both flags are seeded here because Vue 2 cannot observe a property added to
      // an object later. `pinned` is set by the canvas's drag handler, so without
      // the seed the badge appeared and disappeared only when something else
      // happened to re-render the panel: clicking it cleared the value and left the
      // badge on screen. (The old seed was `papers: 0`, a leftover from when the
      // radius read `papers` and meant one thing for the focus and another for its
      // neighbours; nothing reads it now.)
      else {
        Vue.set(s.nodes, node.eid, Object.assign({
          justAdded: false, pinned: false,
          name: null, type: null, id: null, total_papers: 0,
        }, node));
      }
      s.version++;
    },
    // The full shape is seeded at creation and the version bumps on every write.
    // Vue 2 cannot observe a property added to an object later, and `version` was
    // only bumped for new links, so a field that arrived on a second pass - the
    // relation distribution, which comes from the neighbour query while the link
    // may already exist from a subgraph fill - was written and never rendered. The
    // list said "co-mention only" for partners with hundreds of assertions. Third
    // time today for this trap: `pinned` and `justAdded` were the other two.
    upsertLink(s, link) {
      const k = pairKey(link.a, link.b);
      const cur = s.links[k];
      if (cur) {
        Object.keys(link).forEach(x => { cur[x] = link[x]; });
      } else {
        Vue.set(s.links, k, Object.assign({
          key: k, comention_papers: null, y_first: null, y_last: null,
          relation_types: [], n_relations: 0, rel_score_max: null, rel_dist: null,
        }, link));
      }
      s.version++;
    },
    /* Removing is the one action on the canvas that could not be taken back.
       Everything else has a way home - expand has Undo, focus has the trail, the
       year strip has Reset - so a misplaced click here meant searching for the
       entity again and rebuilding what it was attached to. The node and its edges
       are kept so both come back, not just the dot. */
    removeNode(s, eid) {
      const node = s.nodes[eid];
      if (!node) return;
      const edges = Object.keys(s.links)
        .filter(k => s.links[k].a === eid || s.links[k].b === eid)
        .map(k => s.links[k]);
      s.lastRemoved = { node: node, links: edges, name: node.name,
                        focus: s.focus === eid };
      Vue.delete(s.nodes, eid);
      Object.keys(s.links).forEach(k => {
        const l = s.links[k];
        if (l.a === eid || l.b === eid) Vue.delete(s.links, k);
      });
      if (s.focus === eid) s.focus = null;
      if (s.selection && s.selection.eid === eid) s.selection = null;
      if (s.pathA && s.pathA.eid === eid) s.pathA = null;
      if (s.pathB && s.pathB.eid === eid) s.pathB = null;
      s.version++;
    },
    restoreRemoved(s) {
      const r = s.lastRemoved;
      if (!r) return;
      Vue.set(s.nodes, r.node.eid, r.node);
      r.links.forEach(l => { Vue.set(s.links, l.key, l); });
      if (r.focus) s.focus = r.node.eid;
      s.lastRemoved = null;
      s.version++;
    },
    forgetRemoved(s) { s.lastRemoved = null; },
    // The ring the canvas already draws for a freshly expanded batch, for one
    // node. The assistant loading an entity moved the view with nothing saying
    // which of the nodes on it was the new one.
    flashNode(s, eid) {
      Object.keys(s.nodes).forEach(e => { s.nodes[e].justAdded = e === eid; });
      s.version++;
    },
    setNeighbourTotal(s, p) { Vue.set(s.neighbourTotals, p.eid, p.total); },
    clearNeighbourTotals(s) { s.neighbourTotals = {}; },
    setNodeFacts(s, f) { Vue.set(s.nodeFacts, f.eid, f); },
    clearNodeFacts(s) { s.nodeFacts = {}; },
    setFocus(s, eid) {
      if (s.focus && s.focus !== eid) s.history.push(s.focus);
      s.focus = eid;
    },
    popHistory(s) { s.focus = s.history.pop() || s.focus; },
    // A path is a kind of selection, not a mode. Making it a mode meant the
    // inspector stayed locked on the result and clicking a node did nothing visible,
    // with no way back except reloading. Selecting anything else now clears it, which
    // is the behaviour every other selection already had.
    select(s, sel) {
      s.returnTo = null;                 // an ordinary selection abandons the trail
      s.selection = sel;
      if (!sel || sel.kind !== "path") s.pathEids = [];
    },
    // Opening an edge from a list is not leaving that list. `returnTo` remembers
    // what to come back to, whether that was a path result that took four hops to
    // find or the node whose connections were being read. Selecting anything else
    // still clears it, as every other selection does.
    selectEdgeFrom(s, p) {
      s.returnTo = p.back || null;
      s.selection = { kind: "edge", key: p.key };
    },
    goBack(s) {
      if (!s.returnTo) return;
      s.selection = s.returnTo;
      s.returnTo = null;
    },
    // Ordered and inside the corpus, always. Typing 2025 in "from" and 1960 in
    // "to" is an easy slip, and every query then matched nothing: an empty canvas,
    // an empty inspector and no hint that the window, not the data, was the reason.
    setYears(s, p) {
      const lo = Math.max(1960, Math.min(2025, Math.round(+p.y0 || 1960)));
      const hi = Math.max(1960, Math.min(2025, Math.round(+p.y1 || 2025)));
      s.y0 = Math.min(lo, hi);
      s.y1 = Math.max(lo, hi);
    },
    toggleType(s, t) {
      const i = s.hiddenTypes.indexOf(t);
      if (i === -1) s.hiddenTypes.push(t); else s.hiddenTypes.splice(i, 1);
      s.version++;
    },
    setEndpoint(s, p) { s[p.which === "A" ? "pathA" : "pathB"] = p.node; },
    setPath(s, p) {
      const eids = (p && p.eids) || (Array.isArray(p) ? p : []);
      s.pathEids = eids;
      s.selection = eids.length ? { kind: "path", row: p.row || null } : null;
    },
    clearEndpoints(s) { s.pathA = null; s.pathB = null; s.pathEids = [];
      if (s.selection && s.selection.kind === "path") s.selection = null; },
    setAvoidHubs(s, v) { s.avoidHubs = v; },
    setHubs(s, h) { s.hubs = h; },
    setEdgeMode(s, m) { s.edgeMode = m; s.version++; },
    setRankBy(s, r) { s.rankBy = r; },
    setPairTypes(s, rows) {
      const m = {};
      (rows || []).forEach(r => {
        m[[r.t1, r.t2].slice().sort().join("|")] = Number(r.n);
      });
      s.pairTypes = m;               // absent means zero: the table has no such row
    },
    setNeighbourRemaining(s, p) {
      Vue.set(s.neighbourRemaining, p.eid,
              { total: p.total, byType: p.byType || {} });
    },
    clearNeighbourRemaining(s) { s.neighbourRemaining = {}; },
    // Dragging pins a node, and the only way out was a toolbar button that released
    // every pin at once - so fixing one node's position meant losing all of them to
    // undo it.
    unpinNode(s, eid) {
      const n = s.nodes[eid];
      if (!n) return;
      n.fx = null; n.fy = null; n.pinned = false;
      s.version++;
    },
    setHover(s, h) {
      s.hoverEid = (h && h.eid) || null;
      s.hoverKey = (h && h.key) || null;
    },
    pushExpand(s, e) {
      s.expandStack.push(e);
      s.expandStack = s.expandStack.slice(-12);   // deep enough to walk back
      markFresh(s);
    },
    popExpand(s) {
      s.expandStack.pop();
      markFresh(s);
    },
    clearExpands(s) {
      s.expandStack = [];
      markFresh(s);
    },
    setEvidence(s, e) {
      s.evidence = e;
      if (e === null) {
        s.relations = null; s.relationsTotal = null; s.relationsSummary = null;
      }
    },
    // The list is capped at 200, the total is not: keep them apart, or the tab badge
    // reports the cap as the number of assertions that exist.
    setRelations(s, r) {
      s.relations = r.rows;
      s.relationsTotal = r.total;
      s.relationsPairType = r.pair_type || null;
      s.relationsPairTotal = r.pair_type_total == null ? null : r.pair_type_total;
      s.relationsCorpusTotal = r.relation_types_total || null;
      // The distribution comes from the server, counted over the whole pair.
      // Counting types in `rows` counted the 200 highest-scoring assertions: for
      // INS - type 1 diabetes that reads "Association 100%" where the truth is
      // 3,916 Association, 2,450 Negative_Correlation and 1 Positive_Correlation.
      s.relationsSummary = r.summary || null;
    },
    setCypher(s, c) { s.cypher = c; },
    setStatus(s, v) { s.status = v; },
    // An operation that fails has to say so somewhere the user is looking. Returning
    // early left the canvas exactly as it was, with a four-letter status in a corner
    // as the only sign that Neo4j had stopped answering.
    setError(s, e) { s.lastError = e; },
    clearError(s) { s.lastError = null; s.retry = null; },
    setRetry(s, fn) { s.retry = fn; },
    unpinAll(s) {
      Object.values(s.nodes).forEach(n => { n.pinned = false; n.fx = null; n.fy = null; });
    },
    appendEvidence(s, more) {
      if (!s.evidence) { s.evidence = more; return; }
      /* Everything the first page carried, with the new page merged in.
         Enumerating four fields dropped the rest, and two of them are read by the
         panel: `scan_capped` and `scanned_papers`. So the notice saying the
         sentence list came from the newest 400 papers rather than from all of
         them disappeared the moment a reader asked for more sentences - exactly
         when they were digging further into a list whose limit had stopped being
         stated. */
      s.evidence = Object.assign({}, s.evidence, more, {
        sentences: (s.evidence.sentences || []).concat(more.sentences || []),
        // The paper list is fetched once, on the first page; a later page returns
        // none and must not blank it.
        papers: (more.papers && more.papers.length) ? more.papers : s.evidence.papers,
      });
    }
  },
  actions: {
    async focusOn({ state, commit, dispatch }, p) {
      const eid = p.eid;
      // The focus loads a fixed top slice by co-mention; Show-more adds the next
      // batch. Both numbers are disclosed in the inspector rather than being the
      // reason a neighbourhood silently looks smaller than it is.
      const res = await T1DApi.neighbours(eid, state.y0, state.y1, FOCUS_TOP,
                                          null, null, state.rankBy);
      if (res.error) {
        commit("setError", { op: "neighbours", message: res.error });
        commit("setRetry", { action: "focusOn", payload: p });
        return;
      }
      commit("clearError");
      // A focus reload replaces the neighbourhood wholesale, so the batches Undo
      // would walk back no longer describe anything the user can see.
      commit("clearExpands");
      commit("setCypher", window.T1DCypher.neighbours(eid, state.y0, state.y1));
      commit("setNeighbourTotal", { eid: eid, total: res.total_neighbours });
      commit("setNeighbourRemaining", { eid: eid, total: res.remaining,
                                        byType: res.remaining_by_type });
      if (p.pushHistory !== false) commit("setFocus", eid); else state.focus = eid;
      const f = state.nodes[eid];
      if (f) { f.fx = null; f.fy = null; }
      res.rows.forEach(n => {
        // n.papers is the pair's co-mention count, not the entity's size. Writing
        // it onto the node made the radius mean different things for the focus and
        // its neighbours, so the same entity changed size depending on what you had
        // focused. It belongs on the edge.
        commit("upsertNode", {
          eid: n.eid, type: n.type, name: n.name,
          id: n.eid.split("|").slice(1).join("|"),
          total_papers: n.total_papers
        });
        commit("upsertLink", {
          a: eid, b: n.eid, comention_papers: n.papers, y_first: n.y_first,
          y_last: n.y_last,
          relation_types: (n.relation_types || []).filter(Boolean),
          // Everything the panels read off an edge has to be carried here. The
          // distribution was returned by the query, dropped at this line, and the
          // list then showed "co-mention only" for every partner - the failure
          // looked like an absence of relations rather than a lost field.
          n_relations: n.n_relations, rel_score_max: n.rel_score_max,
          rel_dist: n.rel_dist
        });
      });
      // The facts are fetched before the selection changes, not after it. The
      // counts already were - setNeighbourTotal and setNeighbourRemaining are
      // committed above - so leaving only nodeFacts to the panel's own watcher
      // meant switching entity drew the panel once without them and again a round
      // trip later, which is the page that flashed past. In parallel with the
      // subgraph, so this costs no extra wait. The watcher still covers the other
      // way in, clicking a node on the canvas, where nothing has been fetched yet.
      await Promise.all([dispatch("fillSubgraph"),
                         dispatch("loadNodeFacts", eid)]);
      commit("select", { kind: "node", eid: eid });
    },
    // `p` is an eid, or {eid, types} to add one type at a time - the faceted
    // pattern, using the breakdown the server already returns.
    async expand({ state, commit, dispatch }, p) {
      const eid = (p && p.eid) ? p.eid : p;
      const types = (p && p.types) || null;
      // Everything on the canvas is excluded, so every row that comes back is new
      // and the number the button promised is the number it delivers.
      const res = await T1DApi.neighbours(eid, state.y0, state.y1, EXPAND_BATCH,
                                          Object.keys(state.nodes), types,
                                          state.rankBy);
      if (res.error) {
        commit("setError", { op: "expand", message: res.error });
        commit("setRetry", { action: "expand", payload: p });
        return 0;
      }
      commit("clearError");
      commit("setNeighbourTotal", { eid: eid, total: res.total_neighbours });
      const before = Object.keys(state.nodes).length;
      // Which nodes this click is about to add. Expand used to be irreversible and
      // invisible: twelve nodes appeared somewhere in a canvas of a hundred, with
      // nothing saying which twelve and no way back short of reloading.
      const added = res.rows.map(n => n.eid).filter(e => !state.nodes[e]);
      res.rows.forEach(n => {
        commit("upsertNode", {
          eid: n.eid, type: n.type, name: n.name,
          id: n.eid.split("|").slice(1).join("|"),
          total_papers: n.total_papers
        });
        commit("upsertLink", {
          a: eid, b: n.eid, comention_papers: n.papers, y_first: n.y_first,
          y_last: n.y_last,
          relation_types: (n.relation_types || []).filter(Boolean),
          // Everything the panels read off an edge has to be carried here. The
          // distribution was returned by the query, dropped at this line, and the
          // list then showed "co-mention only" for every partner - the failure
          // looked like an absence of relations rather than a lost field.
          n_relations: n.n_relations, rel_score_max: n.rel_score_max,
          rel_dist: n.rel_dist
        });
      });
      await dispatch("fillSubgraph");
      commit("pushExpand", { eid: eid, types: types, added: added });
      dispatch("refreshRemaining", eid);   // what is left, now that these are in
      return Object.keys(state.nodes).length - before;
    },
    async refreshRemaining({ state, commit }, eid) {
      const r = await T1DApi.neighbours(eid, state.y0, state.y1, 1,
                                        Object.keys(state.nodes));
      if (r.error) return;
      commit("setNeighbourTotal", { eid: eid, total: r.total_neighbours });
      commit("setNeighbourRemaining", { eid: eid, total: r.remaining,
                                        byType: r.remaining_by_type });
    },
    // Undo is a mutation plus a redraw; kept as an action so the canvas refits the
    // smaller graph the same way it fits a larger one.
    undoExpand({ state, commit, dispatch }) {
      const top = state.expandStack[state.expandStack.length - 1];
      if (!top) return 0;
      top.added.forEach(e => commit("removeNode", e));
      commit("popExpand");
      dispatch("refreshRemaining", top.eid);
      return top.added.length;
    },
    async fillSubgraph({ state, commit }) {
      const eids = Object.keys(state.nodes);
      if (eids.length < 2) return;
      // The cap was 260 and it returned silently: past that the cross-edges simply
      // stopped being derived, so the graph looked sparser than it is with nothing
      // saying why - and one Expand of 80 crosses it easily. Measured, the query
      // costs the same at 500 nodes as at 260 (463ms against 403ms), so the limit
      // is high enough to be a guard rather than a behaviour, and it reports.
      if (eids.length > SUBGRAPH_MAX) {
        commit("setError", { op: "subgraph", message:
          "The canvas holds " + eids.length + " nodes, past the " + SUBGRAPH_MAX +
          " this view derives edges for. Edges between the newest nodes are not " +
          "drawn. Remove a few nodes, or narrow the years." });
        return;
      }
      const res = await T1DApi.subgraph(eids, state.y0, state.y1);
      if (res.error) {
        commit("setError", { op: "subgraph", message: res.error });
        commit("setRetry", { action: "fillSubgraph" });
        return;
      }
      res.rows.forEach(e => commit("upsertLink", {
        a: e.a, b: e.b, comention_papers: e.papers, y_first: e.y_first,
        y_last: e.y_last,
        relation_types: (e.relation_types || []).filter(Boolean),
        n_relations: e.n_relations, rel_score_max: e.rel_score_max,
        rel_dist: e.rel_dist
      }));
    },
    async reloadYears({ state, commit, dispatch }) {
      if (!state.focus) return;
      // Keep the node set the user has assembled and re-derive only the edges for the
      // new window. Wiping the canvas on a year change threw away an exploration that
      // may have taken a dozen clicks to build, with no warning and no undo.
      Object.keys(state.links).forEach(k => Vue.delete(state.links, k));
      commit("clearNodeFacts");     // every fact below is window-relative
      // The edges kept for Undo belong to the window that has just gone. Putting
      // them back after a year change would restore links this window does not
      // have, which is a worse outcome than losing the undo.
      commit("forgetRemoved");
      // The neighbour totals are window-relative as well, and survived a year
      // change: selecting a node that was not the focus showed "18 of 762 graph
      // neighbours" with 762 measured in the previous window.
      commit("clearNeighbourTotals");
      commit("clearNeighbourRemaining");
      state.version++;
      await dispatch("focusOn", { eid: state.focus, pushHistory: false });
      await dispatch("fillSubgraph");
    },
    // The first load, as an action so the error bar's Retry has something real to
    // dispatch. App.onSeed delegates here rather than keeping a second copy.
    async seedAgain({ commit, dispatch }, name) {
      const r = await T1DApi.search(name, 1);
      if (r.error) {
        commit("setError", { op: "search", message: r.error });
        commit("setRetry", { action: "seedAgain", payload: name });
        return false;
      }
      if (!r.rows || !r.rows.length) {
        commit("setError", { op: "search",
          message: "Could not find a starting entity named " + name });
        return false;
      }
      const row = r.rows[0];
      commit("clearError");
      commit("upsertNode", { eid: row.eid, type: row.type, id: row.id,
                             name: row.name, total_papers: row.n_papers });
      await dispatch("focusOn", { eid: row.eid });
      return row;
    },
    async loadPairTypes({ commit }) {
      const r = await T1DApi.pairTypes();
      if (r.error) return;            // the hint is optional, the graph is not
      commit("setPairTypes", r.rows);
    },
    async loadHubs({ commit }) {
      const r = await T1DApi.hubs();
      // Without hubs the path search silently stops avoiding them, and every answer
      // becomes a two-hop trip through Homo sapiens.
      if (r.error) {
        commit("setError", { op: "hubs", message: r.error });
        commit("setRetry", { action: "loadHubs" });
        return;
      }
      if (r.rows) commit("setHubs", r.rows);
    },
    // An edge opened from a list, with the way back recorded.
    async openEdgeFrom({ state, commit, dispatch }, p) {
      const back = p.back || (state.selection && state.selection.kind === "path"
        ? { kind: "path", row: state.selection.row || null }
        : null);
      commit("selectEdgeFrom", { key: p.link.key, back: back });
      await dispatch("loadEvidence", p.link);
    },
    // Cheapest possible call: one row, for the total only. Without it a node that
    // has never been the focus has no neighbour count, so the inspector cannot say
    // how much of its neighbourhood is on screen and Expand cannot say how many it
    // would add.
    async loadNeighbourTotal({ state, commit }, eid) {
      if (state.neighbourTotals[eid] != null) return;
      const r = await T1DApi.neighbours(eid, state.y0, state.y1, 1,
                                        Object.keys(state.nodes));
      if (r.error) return;                    // the count is optional, not the view
      commit("setNeighbourTotal", { eid: eid, total: r.total_neighbours });
      commit("setNeighbourRemaining", { eid: eid, total: r.remaining,
                                        byType: r.remaining_by_type });
    },
    async loadNodeFacts({ state, commit }, eid) {
      const r = await T1DApi.node(eid, state.y0, state.y1);
      // Silent on failure meant the inspector kept the previous entity's facts under
      // the new entity's name, which is worse than showing nothing.
      if (r.error) {
        commit("setError", { op: "node", message: r.error });
        commit("setRetry", { action: "loadNodeFacts", payload: eid });
        return;
      }
      if (r.rows && r.rows.length) commit("setNodeFacts", r.rows[0]);
    },
    async loadEvidence({ state, commit }, p) {
      const link = p.link || p;
      const offset = p.offset || 0;
      if (!offset) commit("setEvidence", null);
      const a = state.nodes[link.a], b = state.nodes[link.b];
      const res = await T1DApi.evidence(link.a, link.b, state.y0, state.y1, offset);
      // A failed request used to land here as {error} and the panel read its missing
      // fields as zeros: "0 papers mention both", under an edge labelled 60. Say it
      // failed, in the panel and in the error bar.
      if (res.error) { commit("setError", { op: "evidence", message: res.error });
        commit("setRetry", { action: "loadEvidence", payload: p }); }
      else commit("clearError");
      if (offset) commit("appendEvidence", res); else commit("setEvidence", res);
      commit("setCypher", window.T1DCypher.evidence(a, b, state.y0, state.y1));
      if (!offset) {
        const rel = await T1DApi.relations(link.a, link.b, state.y0, state.y1);
        if (rel.error) {
          commit("setError", { op: "relations", message: rel.error });
          // The relations come with the evidence, so retrying means reopening the
          // edge - six of ten error paths offered no way back at all, and a
          // transient failure on any of them meant reloading the page.
          commit("setRetry", { action: "loadEvidence", payload: p });
        }
        commit("setRelations", Object.assign({}, rel, {
          rows: rel.rows || [],
          total: rel.total != null ? rel.total : (rel.rows || []).length }));
      }
    },
    async findPath({ state, commit, dispatch }) {
      if (!state.pathA || !state.pathB) return null;
      const res = await T1DApi.path(state.pathA.eid, state.pathB.eid, 4,
        state.avoidHubs);
      commit("setCypher", window.T1DCypher.path(state.pathA.eid, state.pathB.eid,
        4, state.avoidHubs));
      if (res.error || !res.rows.length) {
        commit("setPath", { eids: [], row: null });
        commit("select", { kind: "pathfail" });
        return null;
      }
      const row = res.rows[0];
      row.eids.forEach((eid, i) => commit("upsertNode", {
        eid: eid, type: row.types[i], name: row.names[i],
        id: eid.split("|").slice(1).join("|")
      }));
      for (let i = 0; i < row.eids.length - 1; i++) {
        // No weight yet - fillSubgraph fetches the real one a moment later. A
        // placeholder 1 rendered as "1 co-mentioning papers", which is a number the
        // user has no way to tell from a measurement.
        commit("upsertLink", { a: row.eids[i], b: row.eids[i + 1],
          comention_papers: null, y_first: state.y0, y_last: state.y1 });
      }
      await dispatch("fillSubgraph");
      commit("setPath", { eids: row.eids, row: row });
      return row;
    }
  }
});
window.T1DPairKey = pairKey;
window.T1DFocusTop = FOCUS_TOP;
