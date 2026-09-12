/* Left rail: years, type filters, path endpoints, legend. */
Vue.component("filter-rail", {
  data: () => ({
    topOpen: false, topRows: [], topType: "", topBusy: false, topErr: "",
    edgeModes: [["all", "all", "every link"],
                ["emphasise", "emphasise", "links with a claim solid, the rest faint"],
                ["only", "relations only", "hide links with no claim behind them"]],
    ranks: [["papers", "co-mentions", "how many papers mention both"],
            ["relations", "relations", "how many claims were found in the text"]],
    presets: [["all",1960,2025],["1990s",1990,1999],["2000s",2000,2009],
              ["2010s",2010,2019],["2020+",2020,2025]],
    types: ["Gene","Disease","Chemical","Species","Variant","CellLine","Chromosome"]
  }),
  computed: {
    edgeMode() { return this.$store.state.edgeMode; },
    rankBy() { return this.$store.state.rankBy; },
    stats() { return this.$store.getters.edgeStats; },
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
    canvasSize() { return Object.keys(this.$store.state.nodes).length; }
  },
  methods: {
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
    setMode(m) { this.$store.commit("setEdgeMode", m); },
    setRank(r) {
      if (r === this.rankBy) return;
      this.$store.commit("setRankBy", r);
      this.$store.dispatch("reloadYears");   // re-ask in the new order
    },
    isPreset(p) { return this.y0===p[1] && this.y1===p[2]; },
    apply() {
      this.$store.dispatch("reloadYears");
      if (this.topOpen) this.loadTop();
    },
    toggle(t) { this.$store.commit("toggleType", t); },
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
        <input type="number" min="1960" max="2025" v-model.number="y0"
               @change="apply" aria-label="from year">
        <span>&ndash;</span>
        <input type="number" min="1960" max="2025" v-model.number="y1"
               @change="apply" aria-label="to year">
      </div>
      <input class="yslider" type="range" min="1960" max="2025" v-model.number="y1"
             @change="apply" aria-label="end year">
      <p class="hint" v-if="canvasSize > 1">Changing the years re-derives the edges
        and keeps the {{ canvasSize }} nodes you have opened.</p>
      <div class="presets">
        <button v-for="p in presets" :key="p[0]" @click="preset(p)"
                :aria-pressed="String(isPreset(p))">{{ p[0] }}</button>
      </div>
    </div>

    <div class="sec">
      <label>Most connected entities</label>
      <button class="ghost wide" @click="toggleTop">
        {{ topOpen ? 'Hide' : 'Show' }} ranking for {{ y0 }}&ndash;{{ y1 }}</button>
      <div v-if="topOpen" style="margin-top:8px">
        <select v-model="topType" @change="loadTop" class="tsel"
                aria-label="restrict to an entity type">
          <option value="">all types</option>
          <option v-for="t in types" :key="t" :value="t">{{ t }}</option>
        </select>
        <p class="hint" v-if="topBusy">loading&hellip;</p>
        <p class="hint" v-else-if="topErr">Ranking failed &mdash; {{ topErr }}.</p>
        <p class="hint" v-else-if="!topRows.length">No entity of this type has a
          co-mention edge inside {{ y0 }}&ndash;{{ y1 }}. The graph keeps a year only
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
        <button v-for="t in types" :key="t" class="chip" @click="toggle(t)"
                :aria-pressed="String(hidden.indexOf(t)===-1)"
                :title="hidden.indexOf(t)===-1 ? 'hide ' + t : 'show ' + t">
          <svg width="13" height="13" viewBox="-7 -7 14 14" aria-hidden="true">
            <path :d="glyph(t,5)" :fill="color(t)"></path></svg>{{ t }}</button>
      </div>
      <p class="hint">Circle size = papers that mention it &middot; line thickness = papers that mention both &middot; <span class="pinhint">pinned</span> nodes stay where you drop
        them.</p>
    </div>

    <div class="sec">
      <label>Edges</label>
      <div class="seg" role="group" aria-label="edge display">
        <button v-for="m in edgeModes" :key="m[0]" @click="setMode(m[0])"
                :aria-pressed="String(edgeMode === m[0])" :title="m[2]">{{ m[1] }}</button>
      </div>
      <p class="hint" v-if="edgeMode === 'only' && stats">Showing
        {{ stats.withRel }} of {{ stats.total }} edges.
        <template v-if="stats.impossible">{{ stats.impossible }} of the
          {{ stats.hidden }} hidden ones are pair types that can never carry a
          relation &mdash; disease&ndash;disease, or anything with a species &mdash;
          so hiding them filters the extractor's vocabulary, not the
          literature.</template></p>
      <p class="hint" v-else-if="edgeMode === 'emphasise'">Links with a claim behind them are solid; links where the two are only mentioned together stay faint. Nothing is hidden.</p>

      <label style="margin-top:12px">Rank partners by</label>
      <div class="seg" role="group" aria-label="partner ranking">
        <button v-for="r in ranks" :key="r[0]" @click="setRank(r[0])"
                :aria-pressed="String(rankBy === r[0])" :title="r[2]">{{ r[1] }}</button>
      </div>
      <p class="hint">Claims first by default. Ordered by papers, the biggest neighbours are the kinds of pair that never carry a claim, so most links open onto nothing. Line thickness still means papers either way.</p>
    </div>

    <div class="sec">
      <label>Path between two entities</label>
      <div class="pathpick">
        <div class="endpoint" :class="{set: !!pathA}">
          <span class="tag">A</span>
          <span class="nm">{{ pathA ? pathA.name : 'select a node, then press A' }}</span>
          <button v-if="pathA" class="x" title="clear A"
                  @click="$store.commit('setEndpoint',{which:'A',node:null})">&times;</button>
        </div>
        <div class="endpoint" :class="{set: !!pathB}">
          <span class="tag">B</span>
          <span class="nm">{{ pathB ? pathB.name : 'select a node, then press B' }}</span>
          <button v-if="pathB" class="x" title="clear B"
                  @click="$store.commit('setEndpoint',{which:'B',node:null})">&times;</button>
        </div>
      </div>
      <label class="chk"><input type="checkbox" v-model="avoidHubs"> avoid the most connected nodes</label>
      <p class="hint" v-if="hubs.length">Without this, paths route through
        <em v-for="(h,i) in hubs.slice(0,3)" :key="h.eid">{{ h.name }}<span
          v-if="i<2">, </span></em> &mdash; true and useless.</p>
      <button class="primary wide" :disabled="!pathA || !pathB"
              @click="$emit('find-path')">Find shortest path</button>
    </div>

</aside>`
});
