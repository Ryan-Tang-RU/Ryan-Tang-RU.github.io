/* Left rail: search, years, the ranking, type filters, path endpoints.

   The edge-display and partner-ranking groups and every explanatory line were
   taken out at the owner's request: the rail had grown more sentences than
   controls. Edges now start from the ones a claim was extracted for, which is
   what the removed default chose, and the count that line used to carry sits in
   the canvas status bar where the drawing is. */
// The corpus bounds, in one place. They were written into the two number inputs
// and into the "all" preset separately, and the track would have been a fourth
// copy. The bounds come from the store, which asks the corpus for them at boot:
// retrieval starts at 1960 for every corpus and the papers do not, so a slider
// fixed at 1960 offers a GLP-1 reader eighteen years with nothing in them.

Vue.component("filter-rail", {
  data: () => ({
    grab: null, pending: null,
    topOpen: false, topRows: [], topType: "", topBusy: false, topErr: "",
    types: ["Gene","Disease","Chemical","Species","Variant","CellLine","Chromosome"]
  }),
  computed: {
    Y_MIN() { return this.$store.state.yMin; },
    Y_MAX() { return this.$store.state.yMax; },
    // "all" is the corpus, and a decade button is offered only where the corpus
    // has that decade. A button that selects nothing is not a filter.
    presets() {
      const lo = this.Y_MIN, hi = this.Y_MAX;
      return [["all", lo, hi]].concat(
        [["1990s",1990,1999],["2000s",2000,2009],["2010s",2010,2019],
         ["2020+",2020,2025]].filter(p => p[2] >= lo && p[1] <= hi));
    },
    // Offering to keep only the pinned nodes when every node is pinned is an
    // offer to do nothing, which reads as a control that has stopped working.
    nodeCount() { return Object.keys(this.$store.state.nodes).length; },
    pinnedCount() {
      return Object.values(this.$store.state.nodes).filter(n => n.pinned).length;
    },
    // While a handle is held, the years shown come from `pending` and the store is
    // left alone. Committing on every pixel would re-derive every edge on the
    // canvas for each intermediate year, which is the one expensive thing the year
    // control does. Same model as the strip under the graph.
    selY0() { return this.pending ? this.pending.y0 : this.y0; },
    selY1() { return this.pending ? this.pending.y1 : this.y1; },
    railLeft() { return this.pct(this.selY0); },
    railRight() { return this.pct(this.selY1); },
    // How many nodes each chip actually governs. Without this a chip for a type
    // with nothing on the canvas - Species, CellLine, Chromosome, most of the time
    // - looked identical to one that would hide nineteen nodes, and clicking it
    // changed nothing. The control was working and reading as broken.
    typeCounts() {
      const out = {};
      const ns = this.$store.state.nodes;
      Object.keys(ns).forEach(k => { out[ns[k].type] = (out[ns[k].type] || 0) + 1; });
      return out;
    },
    hiddenCount() {
      return this.hidden.reduce((n, t) => n + (this.typeCounts[t] || 0), 0);
    },
    edgeMode() { return this.$store.state.edgeMode; },
    rankBy() { return this.$store.state.rankBy; },
    y0: { get() { return this.$store.state.y0; },
          set(v) { this.$store.commit("setYears", {y0:+v, y1:this.$store.state.y1}); } },
    y1: { get() { return this.$store.state.y1; },
          set(v) { this.$store.commit("setYears", {y0:this.$store.state.y0, y1:+v}); } },
    avoidHubs: { get() { return this.$store.state.avoidHubs; },
                 set(v) { this.$store.commit("setAvoidHubs", v); } },
    pathA() { return this.$store.state.pathA; },
    pathB() { return this.$store.state.pathB; },
    hubs() { return this.$store.state.hubs; },
    hidden() { return this.$store.state.hiddenTypes; },
  },
  methods: {
    // The pinned set, extracted with the edges between its members.
    keepPinned() {
      this.$store.dispatch("keepOnly", Object.values(this.$store.state.nodes)
        .filter(n => n.pinned).map(n => n.eid));
    },
    pct(y) {
      return (100 * (y - this.Y_MIN) / (this.Y_MAX - this.Y_MIN)) + "%";
    },
    yearAtRail(ev) {
      const b = this.$refs.rtrack.getBoundingClientRect();
      const f = Math.min(1, Math.max(0, (ev.clientX - b.left) / b.width));
      return this.Y_MIN + Math.round(f * (this.Y_MAX - this.Y_MIN));
    },
    // Grab an end to move that end, grab the band to slide the window keeping its
    // width. The handles cannot cross: dragging the left one past the right stops
    // at the right, rather than swapping them under the cursor.
    railDown(ev, part) {
      this.grab = { part: part, y0: this.y0, y1: this.y1,
                    at: this.yearAtRail(ev) };
      window.addEventListener("mousemove", this.railMove);
      window.addEventListener("mouseup", this.railUp);
      ev.preventDefault();
    },
    railMove(ev) {
      const g = this.grab;
      if (!g) return;
      const y = this.yearAtRail(ev);
      if (g.part === "left") this.pending = { y0: Math.min(y, g.y1), y1: g.y1 };
      else if (g.part === "right") this.pending = { y0: g.y0, y1: Math.max(y, g.y0) };
      else {
        const w = g.y1 - g.y0;
        let a = Math.max(this.Y_MIN, Math.min(g.y0 + (y - g.at), this.Y_MAX - w));
        this.pending = { y0: a, y1: a + w };
      }
    },
    railUp() {
      window.removeEventListener("mousemove", this.railMove);
      window.removeEventListener("mouseup", this.railUp);
      const p = this.pending;
      this.grab = null;
      this.pending = null;
      if (!p || (p.y0 === this.y0 && p.y1 === this.y1)) return;
      this.$store.commit("setYears", { y0: p.y0, y1: p.y1 });
      this.apply();
    },
    // A slider that only works with a mouse is not a control for everyone. Arrows
    // move one year, shift-arrows ten, Home and End go to the ends.
    railKey(ev, part) {
      const step = ev.shiftKey ? 10 : 1;
      let y0 = this.y0, y1 = this.y1;
      const k = ev.key;
      let d = 0;
      if (k === "ArrowLeft" || k === "ArrowDown") d = -step;
      else if (k === "ArrowRight" || k === "ArrowUp") d = step;
      else if (k === "Home") d = -(this.Y_MAX - this.Y_MIN);
      else if (k === "End") d = this.Y_MAX - this.Y_MIN;
      else return;
      ev.preventDefault();
      if (part === "left") y0 = Math.max(this.Y_MIN, Math.min(y0 + d, y1));
      else y1 = Math.min(this.Y_MAX, Math.max(y1 + d, y0));
      if (y0 === this.y0 && y1 === this.y1) return;
      this.$store.commit("setYears", { y0: y0, y1: y1 });
      this.apply();
    },
    preset(p) {
      this.$store.commit("setYears", {y0:p[1], y1:p[2]});
      this.$store.dispatch("reloadYears");
      if (this.topOpen) this.loadTop();
    },
    // Spec query 3 - "top entities by co-mention degree in a window" - had a server
    // endpoint and no way to reach it from the interface.
    async loadTop() {
      this.topBusy = true; this.topErr = "";
      const r = await T1DApi.degree(this.y0, this.y1, this.topType || null);
      // `r.rows || []` turned a failed query into an empty ranking, which the panel
      // then presented as "nothing ranks here".
      if (r.error) { this.topErr = r.error; this.topRows = []; }
      else this.topRows = r.rows || [];
      this.topBusy = false;
    },
    toggleTop() {
      this.topOpen = !this.topOpen;
      if (this.topOpen && !this.topRows.length) this.loadTop();
    },
    isPreset(p) { return this.y0===p[1] && this.y1===p[2]; },
    apply() {
      this.$store.dispatch("reloadYears");
      if (this.topOpen) this.loadTop();
    },
    // The search returns the same row shape the canvas stores, so the endpoint
    // carries the name and type without a second lookup. Deliberately does not
    // focus or draw it: choosing an endpoint must not move the view out from
    // under the other one.
    pick(which, row) {
      if (!row || !row.eid) return;
      this.$store.commit("setEndpoint", { which: which,
        node: { eid: row.eid, name: row.name, type: row.type } });
    },
    toggle(t) { this.$store.commit("toggleType", t); },
    showAllTypes() {
      this.hidden.slice().forEach(t => this.$store.commit("toggleType", t));
    },
    color: t => T1DGlyphs.color(t),
    glyph: (t,r) => T1DGlyphs.path(t,r)
  },
  template: `
  <aside class="rail">
    <div class="sec">
      <label>Find an entity <kbd>/</kbd></label>
      <search-box ref="search" @choose="$emit('choose', $event)"></search-box>
    </div>

    <div class="sec">
      <label>Years</label>
      <div class="years">
        <input type="number" :min="Y_MIN" :max="Y_MAX" v-model.number="y0"
               @change="apply" aria-label="from year">
        <span>&ndash;</span>
        <input type="number" :min="Y_MIN" :max="Y_MAX" v-model.number="y1"
               @change="apply" aria-label="to year">
      </div>
      <!-- Two handles, both draggable. The old control here was a single range
           input bound to y1, so the start year could only be typed. -->
      <div class="rtrack" ref="rtrack" @mousedown="railDown($event, 'band')">
        <div class="rfill" :style="{left: railLeft, right: 'calc(100% - ' + railRight + ')'}"></div>
        <button class="rgrip" :class="{held: grab && grab.part === 'left'}"
                :style="{left: railLeft}" role="slider" aria-label="from year"
                :aria-valuemin="Y_MIN" :aria-valuemax="selY1" :aria-valuenow="selY0"
                :aria-valuetext="String(selY0)"
                @mousedown.stop="railDown($event, 'left')"
                @keydown="railKey($event, 'left')"></button>
        <button class="rgrip" :class="{held: grab && grab.part === 'right'}"
                :style="{left: railRight}" role="slider" aria-label="to year"
                :aria-valuemin="selY0" :aria-valuemax="Y_MAX" :aria-valuenow="selY1"
                :aria-valuetext="String(selY1)"
                @mousedown.stop="railDown($event, 'right')"
                @keydown="railKey($event, 'right')"></button>
      </div>
      <p class="rnow" :class="{pend: !!pending}">{{ selY0 }}&ndash;{{ selY1 }}</p>
      <div class="presets">
        <button v-for="p in presets" :key="p[0]" @click="preset(p)"
                :aria-pressed="String(isPreset(p))">{{ p[0] }}</button>
      </div>
    </div>

    <div class="sec">
      <label>Most connected entities</label>
      <button class="ghost wide" v-if="pinnedCount > 1 && pinnedCount < nodeCount"
              @click="keepPinned"
              :title="'Removes every node except the ' + pinnedCount + ' pinned ones, '
                      + 'then draws the edges the data puts between them'">
        Keep only the {{ pinnedCount }} pinned nodes</button>
      <button class="ghost wide" @click="toggleTop">
        {{ topOpen ? 'Hide' : 'Show' }} ranking for {{ y0 }}&ndash;{{ y1 }}</button>
      <div v-if="topOpen" class="cdgap8">
        <select v-model="topType" @change="loadTop" class="tsel"
                aria-label="restrict to an entity type">
          <option value="">all types</option>
          <option v-for="t in types" :key="t" :value="t">{{ t }}</option>
        </select>
        <p class="hint" v-if="topBusy">loading&hellip;</p>
        <p class="hint" v-else-if="topErr">Ranking failed. {{ topErr }}.</p>
        <p class="hint" v-else-if="!topRows.length">No entity of this type has an
          edge in {{ y0 }}&ndash;{{ y1 }}. The graph keeps a year only
          once a pair reaches 3 co-mentions in it, so narrow early windows can be
          empty.</p>
        <p class="hint" v-else-if="topRows.length > 20">Top 20 of
          {{ topRows.length }} fetched.</p>
        <ol class="toplist" v-if="topRows.length && !topBusy && !topErr">
          <li v-for="r in topRows.slice(0,20)" :key="r.eid"
              @click="$emit('choose', {eid:r.eid, type:r.type, name:r.name,
                      id:r.eid.split('|').slice(1).join('|'), n_papers:r.n_papers})">
            <svg width="10" height="10" viewBox="-6 -6 12 12" aria-hidden="true">
              <path :d="glyph(r.type,4.5)" :fill="color(r.type)"></path></svg>
            <span class="nm">{{ r.name }}</span>
            <span class="n" :title="r.partner_years + ' partner-years'">{{
              r.degree.toLocaleString() }}</span>
          </li>
        </ol>
      </div>
    </div>

    <div class="sec">
      <label>Entity types <span class="lbl-note">click to hide</span></label>
      <div class="chips">
        <button v-for="t in types" :key="t" class="chip"
                :class="{off: hidden.indexOf(t)!==-1, none: !typeCounts[t]}"
                @click="toggle(t)"
                :aria-pressed="String(hidden.indexOf(t)===-1)"
                :title="!typeCounts[t] ? 'no ' + t + ' node is on the canvas'
                        : (hidden.indexOf(t)===-1 ? 'hide ' + typeCounts[t] + ' '
                           + t + ' nodes' : 'show ' + typeCounts[t] + ' ' + t
                           + ' nodes')">
          <svg width="13" height="13" viewBox="-7 -7 14 14" aria-hidden="true">
            <path :d="glyph(t,5)" :fill="color(t)"></path></svg><span
            class="chipname">{{ t }}</span><span class="chipn"
            v-if="typeCounts[t]">{{ typeCounts[t] }}</span></button>
      </div>
      <p class="hidenote" v-if="hiddenCount">{{ hiddenCount }} node<span
        v-if="hiddenCount !== 1">s</span> hidden.
        <button class="linky" @click="showAllTypes">Show all</button></p>
    </div>

    <div class="sec">
      <label>Path between two entities</label>
      <!-- Typed, not picked off the canvas. Both endpoints had to be on the canvas
           first, and opening the second one replaces the neighbourhood the first
           was in, so setting A and then B could drop A from the view. Searching
           here touches neither the canvas nor the year window: an endpoint is a
           reference, and the whole point of a path is usually to reach something
           that is not on screen yet. Selecting a node and pressing A or B still
           works and is still the quickest way to use what you are looking at. -->
      <div class="pathpick">
        <!-- The box stays a box after a choice is made, holding the chosen
             name so it can be typed over. It used to be replaced by static text
             and a small clear button, which meant changing an endpoint was two
             actions and neither of them was the obvious one: typing. -->
        <div class="endpoint" :class="{set: !!pathA}">
          <span class="tag">A</span>
          <search-box list-id="hitsA" placeholder="search, or press A"
                      :initial="pathA ? pathA.name : ''"
                      @choose="pick('A', $event)"
                      @cleared="$store.commit('setEndpoint',{which:'A',node:null})"></search-box>
        </div>
        <div class="endpoint" :class="{set: !!pathB}">
          <span class="tag">B</span>
          <search-box list-id="hitsB" placeholder="search, or press B"
                      :initial="pathB ? pathB.name : ''"
                      @choose="pick('B', $event)"
                      @cleared="$store.commit('setEndpoint',{which:'B',node:null})"></search-box>
        </div>
      </div>
      <label class="chk"><input type="checkbox" v-model="avoidHubs"> avoid the most connected nodes</label>
      <button class="primary wide" :disabled="!pathA || !pathB"
              @click="$emit('find-path')">Find shortest path</button>
    </div>

</aside>`
});
