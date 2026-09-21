/* Right-hand inspector. Shows whichever object is selected, with the identifier
   and its outbound links first - that is what a curator reaches for. */
Vue.component("inspector-panel", {
  // The filter is per-panel state, not app state: it is a way of looking at the
  // list, and it should not survive selecting a different node.
  data: () => ({ connFilter: "" }),
  computed: {
    sel() { return this.$store.state.selection || {}; },
    pathRow() { return this.sel.kind === "path" ? this.sel.row : null; },
    pathFailed() { return this.sel.kind === "pathfail"; },
    avoidHubs() { return this.$store.state.avoidHubs; },
    node() { return this.$store.getters.selectedNode; },
    nTotal() {
      return this.node ? this.$store.state.neighbourTotals[this.node.eid] : null;
    },
    facts() {
      return this.node ? this.$store.state.nodeFacts[this.node.eid] : null;
    },
    forms() { return (this.facts && this.facts.top_forms) || []; },
    returnTo() { return this.$store.state.returnTo; },
    // Name the destination. "Back" alone leaves the reader to guess whether it
    // returns to the path result or to the node whose connections they were reading.
    // Both directions: pointing at the canvas lights the row, pointing at the row
    // lights the canvas. One shared hover makes the two views one view.
    hoverEid() { return this.$store.state.hoverEid; },
    hoverKey() { return this.$store.state.hoverKey; },
    backLabel() {
      const r = this.returnTo;
      if (!r) return "";
      if (r.kind === "path") return "the path";
      const n = this.$store.state.nodes[r.eid];
      return (n && n.name) || "the entity";
    },
    isFocus() { return !!this.node && this.node.eid === this.$store.state.focus; },
    // Only offer Undo for the node the expand actually came from, so the button
    // always refers to something the reader can see on screen.
    // The batch Undo would take back, if it belongs to the node being read.
    expanded() {
      const top = this.stack[this.stack.length - 1];
      return (top && this.node && top.eid === this.node.eid && top.added.length)
        ? top : null;
    },
    // A path's useful unit is the hop, not the node: the hop is what carries the
    // relations and the sentences. Listing the hops as rows also removes the need to
    // hit a one-pixel line on the canvas to read one.
    hops() {
      const r = this.pathRow;
      if (!r) return [];
      const S = this.$store.state, out = [];
      for (let i = 0; i < r.eids.length - 1; i++) {
        const key = window.T1DPairKey(r.eids[i], r.eids[i + 1]);
        out.push({ key: key,
                   link: S.links[key] || { a: r.eids[i], b: r.eids[i + 1], key: key },
                   a: r.names[i], b: r.names[i + 1],
                   ta: r.types[i], tb: r.types[i + 1] });
      }
      return out;
    },
    // Measured, not asserted: "the extractor covers eight pair types, and
    // disease-disease has none" was shown for every relation-less edge, including
    // CD8A - Homo sapiens, where the real reason is that Species is in none of the
    // 262,510 relations at all.
    pairType() { return this.$store.state.relationsPairType || "this"; },
    pairTotal() { return this.$store.state.relationsPairTotal; },
    // No automatic mismatch warning. Measured on the 260 largest entities, a
    // dominant-form-unlike-the-name rule fires on 40 of them, and about four fifths
    // are ordinary synonyms - DKA, ROS, ATP, glucagon, GAD65. A warning that cries
    // wolf four times out of five teaches the reader to skip the one time it is
    // right, so the forms are simply shown and the reader judges.
    // Exact, because the server excludes what the canvas already holds. The old
    // estimate subtracted the visible connections from the total, which was an
    // upper bound: "Add 80" then added 50.
    // From the store, not a second copy of the number. Declaring
    // `const EXPAND_BATCH` here as well was a redeclaration in the shared global
    // scope of two plain scripts, which stopped this whole file from loading - the
    // inspector simply never rendered, with nothing on screen to say why.
    batch() { return this.$store.state.expandBatch; },
    rem() {
      const r = this.node && this.$store.state.neighbourRemaining[this.node.eid];
      return r || null;
    },
    nextBatch() {
      if (!this.rem) return null;
      return Math.min(this.batch, this.rem.total);
    },
    // True when the button would add everything that is left. Without saying so,
    // "Show 18 more partners" reads as an arbitrary step - which is exactly what
    // the number used to be - rather than as "18 is all there is".
    lastBatch() { return !!this.rem && this.rem.total <= this.batch; },
    remTypes() {
      if (!this.rem) return [];
      return Object.keys(this.rem.byType)
        .filter(t => this.$store.state.hiddenTypes.indexOf(t) === -1)
        .map(t => ({ type: t, n: this.rem.byType[t] }))
        .sort((a, b) => b.n - a.n);
    },
    stack() { return this.$store.state.expandStack; },
    hiddenPartners() {
      if (!this.facts || this.nTotal == null) return null;
      return Math.max(0, this.facts.partners_all - this.nTotal);
    },
    canvasSize() { return Object.keys(this.$store.state.nodes).length; },
    crowded() { return this.canvasSize >= 120; },
    link() { return this.$store.getters.selectedLink; },
    links() { return this.node ? T1DLinks(this.node) : []; },
    rel() { return this.link ? (this.link.relation_types || []).filter(Boolean) : []; },
    ends() {
      if (!this.link) return [null, null];
      const S = this.$store.state;
      return [S.nodes[this.link.a], S.nodes[this.link.b]];
    },
    connections() {
      if (!this.node) return [];
      const S = this.$store.state, eid = this.node.eid;
      // No slice. Cutting this to 25 and then printing `connections.length` as the
      // heading meant a node with more connections than that reported 25 as its
      // total - the same shape as the evidence panel reporting 577 papers out of
      // 17,576 - and Expand computed what it would add from the cut number too.
      // The list scrolls instead.
      // Hidden types are off the canvas, so they do not belong in a list headed
      // "connections on canvas": hiding Species left Homo sapiens in the list with
      // no node to point at, and the count disagreed with the picture.
      const hid = S.hiddenTypes;
      // Ordered the way the rail is set, so one notion of "strongest" holds across
      // the app. Relations first by default: a list headed by the pair types that
      // can never carry one sends every early click onto an empty Relations tab.
      const nrel = l => ((l.relation_types || []).filter(Boolean).length
                         ? (l.n_relations || 1) : 0);
      const byRel = S.rankBy === "relations";
      return Object.values(S.links)
        .filter(l => l.a === eid || l.b === eid)
        .filter(l => {
          const o = S.nodes[l.a === eid ? l.b : l.a];
          return o && hid.indexOf(o.type) === -1;
        })
        .sort((x, y) => (byRel ? nrel(y) - nrel(x) : 0)
                     || (y.comention_papers || 0) - (x.comention_papers || 0))
        .map(l => ({ link: l, other: S.nodes[l.a === eid ? l.b : l.a] }))
        .filter(x => x.other);
    },
    // Eighty rows are as hard to pick from as the region they stand in for.
    // Filtering by name is the point of the list: it is how an edge is reached
    // when the canvas is too dense to click one.
    shownConnections() {
      const q = (this.connFilter || "").trim().toLowerCase();
      if (!q) return this.connections;
      return this.connections.filter(c =>
        (c.other.name || "").toLowerCase().indexOf(q) !== -1);
    },
    years() { return this.$store.state.y0 + "\u2013" + this.$store.state.y1; }
  },
  watch: {
    node: { immediate: true, handler(n) {
      if (!n) return;
      if (!this.$store.state.nodeFacts[n.eid])
        this.$store.dispatch("loadNodeFacts", n.eid);
      this.$store.dispatch("loadNeighbourTotal", n.eid);
      // Selecting a node is the step before opening one of its edges, and the
      // reader spends a few seconds on this panel. The files an evidence click
      // needs are fetched during them rather than after the click.
      if (T1DApi.warm) T1DApi.warm();
    } }
  },
  methods: {
    // Which path end this entity currently is, if any. Read by the two tags so a
    // node already chosen looks chosen.
    isEnd(which) {
      const e = this.$store.state[which === "A" ? "pathA" : "pathB"];
      return !!(e && this.node && e.eid === this.node.eid);
    },
    // A toggle, not a set: pressing the tag of an end this node already holds
    // clears it, which is the only way to undo the choice from here. The left-hand
    // panel's own × commits exactly the same thing.
    toggleEnd(which) {
      this.$store.commit("setEndpoint",
        { which: which, node: this.isEnd(which) ? null : this.node });
    },
    glyph: (t, r) => T1DGlyphs.path(t, r),
    color: t => T1DGlyphs.color(t),
    hasRel: l => (l.relation_types || []).filter(Boolean).length > 0,
    openHop(h) {
      this.$store.dispatch("openEdgeFrom", { link: h.link });
    },
    // Reading a list and finding the thing on the canvas were two separate acts.
    openConnection(c) {
      this.$store.dispatch("openEdgeFrom", {
        link: c.link,
        back: { kind: "node", eid: this.node.eid }
      });
    },
    hoverOn(p) { this.$store.commit("setHover", p); },
    // Escape has always deselected. Nobody found it: the first outside reader asked
    // how to clear a selection, so the keystroke has a visible twin. It is called
    // Deselect, not Clear: Clear reads as "remove every node", which it never does.
    clearSel() {
      this.$store.commit("select", null);
      this.$store.commit("setPath", []);
    },
    hoverOff() { this.$store.commit("setHover", null); },
    relsOf(h) { return ((h.link || {}).relation_types || []).filter(Boolean); },
    relsOfLink(l) { return ((l || {}).relation_types || []).filter(Boolean); },
    // Shares, and only the ones worth reading. A bare set of type names gave one
    // assertion in 6,367 the same chip as 3,916 of them, which is what made a
    // large edge look as if the literature contradicted itself.
    dist(l) {
      const d = l && l.rel_dist;
      if (!d || !d.total) return [];
      const out = [];
      for (let i = 0; i < (d.types || []).length; i++) {
        const pct = Math.round((Number(d.counts[i]) / d.total) * 100);
        if (pct < 5) continue;            // a 0.03% tail is noise, not a finding
        out.push({ type: d.types[i], pct: pct,
                   short: String(d.types[i]).replace("_Correlation", "") });
      }
      return out;
    },
    // "co-mention only" was jargon, and it also flattened two different facts into
    // one phrase. Whether a relation is missing because the extractor never covers
    // this pair type - Species is in 0 of 262,510 relations, disease-disease in 0 by
    // BioRED's design - or because nothing was asserted in these particular papers
    // is the distinction the reader needs.
    coveredPair(l) {
      const m = this.$store.state.pairTypes;
      const a = this.$store.state.nodes[l.a], b = this.$store.state.nodes[l.b];
      if (!m || !a || !b) return null;
      return [a.type, b.type].slice().sort().join("|") in m;
    },
    noRelText(l) {
      return this.coveredPair(l) === false
        ? "no relations for this pair of types"
        : "papers only, nothing asserted";
    },
    noRelWhy(l) {
      return this.coveredPair(l) === false
        ? "The extractor emits relations only among Gene, Disease, Chemical and "
          + "Variant, and never for two diseases. A pair like this one cannot carry "
          + "an assertion, so its absence says nothing about the literature."
        : "These two are asserted to be related elsewhere in the corpus, but not in "
          + "the papers that mention both of them here.";
    },
    // The same three-way colouring the evidence panel uses, so a direction reads
    // the same everywhere.
    polarity(t) {
      if (t === "Positive_Correlation") return "pos";
      if (t === "Negative_Correlation") return "neg";
      return "neutral";
    }
  },
  template: `
  <aside class="inspector">
    <div v-if="pathRow">
      <h2 class="ih2">Shortest path,
        {{ pathRow.hops }} hops</h2>
      <p class="hint" class="hint gap" v-if="avoidHubs">The most connected nodes were kept out of the middle, so this is not simply a detour through
        <em>Homo sapiens</em>.</p>
      <p class="hint" class="hint gap" v-else>Hubs were allowed. This route may
        pass through a node connected to almost everything.</p>
      <ol class="pathlist">
        <li v-for="(n,i) in pathRow.names" :key="i">
          <svg width="12" height="12" viewBox="-6 -6 12 12" aria-hidden="true">
            <path :d="glyph(pathRow.types[i],4.5)"
                  :fill="color(pathRow.types[i])"></path></svg>
          <button class="linkish" @click="$emit('focus',{eid:pathRow.eids[i]})">{{ n }}</button>
        </li>
      </ol>

      <label class="seclbl">Each step</label>
      <ul class="hoplist">
        <li v-for="h in hops" :key="h.key" @click="openHop(h)"
            :class="{on: link && link.key === h.key}"
            @mouseenter="hoverOn({key: h.key})" @mouseleave="hoverOff"
            tabindex="0" @keydown.enter="openHop(h)">
          <div class="hoprow">
            <svg width="11" height="11" viewBox="-6 -6 12 12" aria-hidden="true">
              <path :d="glyph(h.ta,4.5)" :fill="color(h.ta)"></path></svg>
            <span class="nm">{{ h.a }}</span>
            <span class="ar">&rarr;</span>
            <svg width="11" height="11" viewBox="-6 -6 12 12" aria-hidden="true">
              <path :d="glyph(h.tb,4.5)" :fill="color(h.tb)"></path></svg>
            <span class="nm">{{ h.b }}</span>
            <span class="n" v-if="h.link.comention_papers != null">{{
              h.link.comention_papers.toLocaleString() }}</span>
          </div>
          <div class="hopmeta">
            <span class="pill rel" v-for="t in relsOf(h)" :key="t">{{ t }}</span>
            <span class="hint" v-if="!relsOf(h).length">mentioned together, no claim</span>
          </div>
        </li>
      </ul>
      <p class="hint">Open a step to read its relations and sentences. The path
        stays, with a link back.</p>
      <button class="ghost wide" @click="$store.commit('clearEndpoints')">
        Clear path and endpoints</button>
    </div>

    <div v-else-if="pathFailed">
      <div class="warnbox">No path within 4 hops{{ avoidHubs
        ? ' that avoids the hub nodes' : '' }}. Widen the year range, or untick
        &ldquo;avoid hub nodes&rdquo; to allow a route through a highly connected
        node.</div>
      <button class="ghost wide" @click="$store.commit('clearEndpoints')">
        Clear endpoints</button>
    </div>

    <div v-else-if="!node && !link" class="insEmpty">
      <p>Select a node or an edge.</p>
      <ul class="keys">
        <li><b>Click</b> a node to inspect it</li>
        <li><b>Double-click</b> to expand its neighbours</li>
        <li><b>Drag</b> to move and pin, or use <b>pin</b> in this panel</li>
        <li><b>Pin two or more</b> nodes to keep only those, with the edges
          between them, from the rail on the left</li>
        <li><b>Click</b> an edge for papers and sentences</li>
      </ul>
    </div>

    <div v-else-if="node">
      <div class="ihead">
        <!-- The same mark the canvas draws, on the same tinted disc, and wearing the
             focus ring when it is the focus - a navy stroke, as on the canvas. The
             header then reads as the node the reader clicked rather than as a
             decoration that happens to share its colour. -->
        <span class="iglyph" :class="{focused: isFocus}"
              :style="{background: 'color-mix(in oklab, ' + color(node.type)
                                   + ' 14%, transparent)'}">
          <svg width="17" height="17" viewBox="-9 -9 18 18" aria-hidden="true">
            <path :d="glyph(node.type,6.6)" :fill="color(node.type)"></path></svg>
        </span>
        <h2>{{ node.name }}</h2>
      </div>
      <div class="imeta">
        <span>{{ node.type }}</span><span>{{ node.id }}</span>
        <!-- States, as states. "Is the focus" used to be a disabled button, which
             reads as a control that has stopped working rather than as a fact. -->
        <span class="pill focus" v-if="isFocus"
              title="the canvas is drawn around this entity">focus</span>
        <button class="pill unpin" v-if="node.pinned"
                @click="$store.commit('unpinNode', node.eid)"
                title="release this node so the layout can move it again">pinned
          &times;</button>
        <button class="pill dopin" v-else
                @click="$store.commit('pinNode', node.eid)"
                title="Hold this node where it is. Pin two or more and the rail can
                       keep just those, with the edges between them.">pin</button>
        <button class="pill deselect" @click="clearSel"
                title="Deselect. The nodes stay on the canvas. Escape does the same."
                >deselect</button>
      </div>
      <div class="links">
        <a v-for="l in links" :key="l[1]" :href="l[1]" target="_blank"
           rel="noopener">{{ l[0] }}</a>
      </div>
      <div class="row iacts">
        <button class="primary" v-if="nextBatch"
                @click="$emit('expand', {eid: node.eid})"
                :title="'add the ' + nextBatch + ' strongest partners that are not '
                      + 'on the canvas yet'">
          {{ lastBatch ? 'Show the last ' + nextBatch + ' partners'
             : 'Show ' + nextBatch + ' more partners' }}
        </button>
        <button class="ghost" v-if="!isFocus" @click="$emit('focus', node)"
                title="redraw the canvas around this entity and add it to the trail">
          Focus here</button>
        <!-- The assistant, reached from the entity rather than from the header,
             with the question already written. -->
        <button class="ghost" @click="$root.$emit('assistant:ask',
                  'What does this graph say about ' + node.name + '?')"
                title="ask the assistant about this entity">Ask</button>
        <!-- The two path ends, carrying the A and B tags the left-hand panel uses,
             so it is visible where they land. They were bare letters with no label,
             no tooltip and no state: a node already set as A looked exactly like one
             that was not. Setting is now a toggle - press it again to clear. -->
        <span class="ends" title="pick two entities, then find the shortest path
between them in the left-hand panel">
          <span class="endslabel">path</span>
          <button class="endbtn" :class="{on: isEnd('A')}"
                  @click="toggleEnd('A')"
                  :title="isEnd('A') ? 'clear end A'
                        : 'make this end A of the path'">A</button>
          <button class="endbtn" :class="{on: isEnd('B')}"
                  @click="toggleEnd('B')"
                  :title="isEnd('B') ? 'clear end B'
                        : 'make this end B of the path'">B</button>
        </span>
      </div>
      <!-- Only once the count has actually arrived. An empty next-batch is also
           true while the request is still in flight, and saying "every partner is
           on the canvas" because the answer has not come back yet is the
           confident wrong statement this project keeps having to remove.
           No backticks in here: this whole template is one backtick string, and
           a quoted identifier ends it - which blanked the panel. -->
      <p class="hint allshown" v-if="rem && !rem.total">
        Every partner this graph has for it is on the canvas.</p>
      <p class="hint gap8" v-if="rem && rem.total">
        {{ rem.total.toLocaleString() }} more partners are not on the canvas.
        <template v-if="remTypes.length > 1">Add one kind at a time:</template>
        <button class="tchip" v-for="t in remTypes" :key="t.type"
                @click="$emit('expand', {eid: node.eid, types: [t.type]})"
                :title="'add up to 20 ' + t.type + ' partners'">
          <svg width="9" height="9" viewBox="-6 -6 12 12" aria-hidden="true">
            <path :d="glyph(t.type,4.5)" :fill="color(t.type)"></path></svg>{{
          t.type }} {{ t.n.toLocaleString() }}</button>
      </p>
      <div class="undobar" v-if="expanded">
        <span>Added {{ expanded.added.length }}
          {{ expanded.added.length === 1 ? 'node' : 'nodes' }}<template
          v-if="expanded.types">, {{ expanded.types.join(', ') }}</template>,
          ringed on the canvas.<template v-if="stack.length > 1">
          {{ stack.length }} batches can be walked back.</template></span>
        <button class="ghost tiny" @click="$store.dispatch('undoExpand')">Undo</button>
      </div>
      <p class="hint" class="hint gap" v-if="nTotal != null">
        {{ connections.length }} of {{ nTotal.toLocaleString() }} graph neighbours are
        on the canvas.<template v-if="hiddenPartners"> A further
        <b>{{ hiddenPartners.toLocaleString() }}</b> more appear alongside this one somewhere in these papers, but never three times in a single year, so no line is drawn for them here.</template></p>
      <div class="warnbox" v-if="crowded">The canvas holds {{ canvasSize }} nodes.
        Layouts above 150 nodes are hard to read. Narrow the years or remove
        nodes before expanding.</div>
      <div class="row gap12">
        <button class="ghost danger" @click="$store.commit('removeNode', node.eid)">
          Remove from canvas</button>
      </div>
      <!-- A hand-curated note, and only that. The comment above says why there is
           no automatic mismatch warning: a dominant-form-unlike-the-name rule
           fires on 40 of the 260 largest entities and about four fifths of those
           are ordinary synonyms, so it would cry wolf four times in five. This
           list is two entries long, each with measured evidence in
           src/artifacts.py, so it never cries wolf - which is the only reason it
           is allowed to look like a warning. -->
      <p class="caveat" v-if="facts && facts.caveat">{{ facts.caveat }}</p>
      <!-- One list with the labels always present, values filled in when they
           arrive. Two lists - a four-row one for loaded facts and a one-row
           fallback - meant switching entity redrew the panel at a different height
           for the length of one request, then again when the neighbour count
           landed: three shapes for one click, which is the flicker. The labels are
           known immediately; only the numbers are pending, so only the numbers
           wait. -->
      <dl class="kv">
        <dt>papers, {{ years }}</dt>
        <dd v-if="facts">{{ facts.n_papers_in_window.toLocaleString() }}</dd>
        <dd v-else class="pend">&ndash;</dd>
        <dt>papers, all years</dt>
        <dd v-if="facts">{{ facts.n_papers_corpus.toLocaleString() }}<span
          class="hint" v-if="facts.last_year > 2025"> (includes {{
          facts.last_year }})</span></dd>
        <dd v-else>{{ (node.total_papers || 0).toLocaleString() }}</dd>
        <dt>active</dt>
        <dd v-if="facts">{{ facts.first_year }}&ndash;{{ facts.last_year }}</dd>
        <dd v-else class="pend">&ndash;</dd>
        <dt>appears with</dt>
        <dd v-if="facts">{{ facts.partners_all.toLocaleString() }} entities</dd>
        <dd v-else class="pend">&ndash;</dd>
        <template v-if="forms.length">
          <dt>written as</dt>
          <dd><span v-for="(f,i) in forms" :key="f.text"><span
            v-if="i">, </span><code>{{ f.text }}</code>
            <span class="n">&times;{{ f.n.toLocaleString() }}</span></span></dd>
        </template>
      </dl>
      <div class="connwrap">
      <label class="seclbl top">
        On the canvas ({{ shownConnections.length.toLocaleString()
        }}<template v-if="shownConnections.length !== connections.length"> of {{
        connections.length.toLocaleString() }}</template>)
        <span class="lblplain">
          papers that mention both</span></label>
      <input class="connfilter" type="search" v-model="connFilter"
             v-if="connections.length > 8"
             placeholder="Filter by name"
             aria-label="Filter these connections by name">
      <ul class="ilist">
        <li class="hint nomatch" v-if="connFilter && !shownConnections.length">
          No connection here carries that name.</li>
        <li v-for="c in shownConnections" :key="c.link.key"
            @click="openConnection(c)"
            :class="{on: hoverKey === c.link.key || hoverEid === c.other.eid}"
            @mouseenter="hoverOn({eid: c.other.eid, key: c.link.key})"
            @mouseleave="hoverOff">
          <svg width="11" height="11" viewBox="-6 -6 12 12" aria-hidden="true">
            <path :d="glyph(c.other.type,4.5)" :fill="color(c.other.type)"></path></svg>
          <span class="cnm">
            <span class="cline">{{ c.other.name }}</span>
            <span class="cmeta">
              <template v-if="dist(c.link).length"><span
                class="pill" :class="polarity(d.type)"
                v-for="d in dist(c.link)" :key="d.type">{{ d.short
                }}<template v-if="dist(c.link).length > 1"> {{ d.pct }}%</template>
              </span><span class="hint"
                v-if="c.link.rel_dist">{{
                  c.link.rel_dist.total.toLocaleString() }} assertions</span></template>
              <span class="hint" v-else :title="noRelWhy(c.link)">{{
                noRelText(c.link) }}</span>
            </span>
          </span>
          <span class="n">{{ (c.link.comention_papers||0).toLocaleString() }}</span>
        </li>
      </ul>
      </div>
    </div>

    <!-- Named, not a bare v-else. This branch was the fallback, so it rendered
         whenever nothing else matched - including with nothing selected, where
         link is null and link.comention_papers throws mid-render and takes the
         whole panel with it. Clicking empty canvas did exactly that. -->
    <div v-else-if="link">
      <button class="ghost back" v-if="returnTo" @click="$store.commit('goBack')">
        &larr; Back to {{ backLabel }}</button>
      <div class="ihead"><h2 class="ih2s">{{ ends[0] && ends[0].name }}
        <span class="dim">&ndash;</span> {{ ends[1] && ends[1].name }}</h2>
      </div>
      <div class="imeta">
        <span v-if="link.comention_papers != null">{{
          link.comention_papers.toLocaleString() }} co-mentioning papers</span>
        <span v-else>counting papers&hellip;</span>
        <span v-if="link.y_first">{{ link.y_first }}&ndash;{{ link.y_last }}</span>
        <button class="pill deselect" @click="clearSel"
                title="Deselect. The nodes stay on the canvas. Escape does the same."
                >deselect</button>
      </div>
      <div class="imeta" v-if="rel.length">
        <span class="pill rel">relation</span><span>{{ rel.join(', ') }}</span>
        <span class="n" v-if="link.n_relations">{{ link.n_relations.toLocaleString()
          }} assertions</span>
        <span class="n" v-if="link.rel_score_max != null"
              title="The extractor's confidence, highest assertion for this pair.
It separates the rarer relation types usefully - Cotreatment 0.62, Drug_Interaction
0.29 - and barely separates the common ones: Association, Positive_Correlation and
Negative_Correlation all sit at a median of 0.99 across the corpus.">
          score {{ Number(link.rel_score_max).toFixed(2) }}</span>
      </div>
      <div class="warnbox" v-else-if="pairTotal === 0">
        No claim was found, and none could be: the text-reading step never produces one for a <b>{{ pairType }}</b> pair. It reads claims only between genes, diseases, chemicals and variants, and species and cell lines appear in none of the 262,510 claims, so this says nothing about the research itself. The sentences below are the evidence.
      </div>
      <div class="warnbox" v-else-if="pairTotal > 0">
        No claim was found for this pair, although <b>{{ pairType }}</b> pairs carry {{ pairTotal.toLocaleString() }} elsewhere in these papers, so it is this pair that has none, not this kind of pair.
      </div>
      <evidence-panel :link="link"></evidence-panel>
    </div>

    <div v-else class="empty">
      <h2 class="ih2s gap6">Nothing selected</h2>
      <p class="hint nogap">Click a node for its papers, its partners and
        the words it is written as. Click an edge for the sentences behind it. Press
        <kbd>/</kbd> to search, or drag the year strip below the graph to narrow the
        window.</p>
    </div>
  </aside>`
});
