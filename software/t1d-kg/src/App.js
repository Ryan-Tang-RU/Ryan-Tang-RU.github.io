/* Root component: layout, breadcrumbs, keyboard shortcuts, and the wiring between
   the rail, the canvas and the inspector.

   The root carries `shell`, which is what makes the app fill the window. It cannot
   be done on #app: Vue 2 REPLACES the mount element with this component's root, so
   #app does not exist once mounted and every rule written against it was dead. The
   grid below it then had no flex parent, its height came from its tallest column -
   the inspector - and the page ended wherever that column ended, leaving a band of
   background that grew and shrank as the inspector's content changed. */
window.App = {
  data: () => ({ showHelp: false, askOpen: false }),
  computed: {
    status() { return this.$store.state.status; },
    focus() { return this.$store.state.focus; },
    history() { return this.$store.state.history; },
    trail() {
      const S = this.$store.state;
      return S.history.slice(-5).concat(S.focus ? [S.focus] : [])
        .map(eid => ({ eid: eid, name: (S.nodes[eid] || {}).name || eid }));
    },
    selNode() { return this.$store.getters.selectedNode; }
  },
  methods: {
    async onChoose(row) {
      this.$store.commit("upsertNode", {
        eid: row.eid, type: row.type, id: row.id, name: row.name,
        total_papers: row.n_papers
      });
      await this.$store.dispatch("focusOn", { eid: row.eid });
      // fit once the simulation settles, not on a timer: fitting a cluster that has
      // not spread yet is what pinned the zoom at its maximum
      this.$root.$emit("graph:fit-soon");
      // and a fit once the first layout pass lands, for the case where the
      // simulation is already cool and "end" will not fire again
      setTimeout(() => this.$root.$emit("graph:fit"), 1200);
    },
    async onSeed(name) {
      const row = await this.$store.dispatch("seedAgain", name);
      if (row) {
        this.$root.$emit("graph:fit-soon");
        setTimeout(() => this.$root.$emit("graph:fit"), 1200);
      }
    },
    pickNode(d) { this.$store.commit("select", { kind: "node", eid: d.eid }); },
    async pickEdge(l) {
      this.$store.commit("select", { kind: "edge", key: l.key });
      await this.$store.dispatch("loadEvidence", l);
    },
    async expand(d) {
      const n = await this.$store.dispatch("expand", d.eid);
      // New nodes land outside the current view often enough that "nothing
      // happened" was a reasonable reading. Refit so the additions are on screen.
      if (n) this.$root.$emit("graph:fit-soon");
    },
    focusOn(d) { this.$store.dispatch("focusOn", { eid: d.eid }); },
    findPath() { this.$store.dispatch("findPath"); },
    goto(eid) {
      this.$store.dispatch("focusOn", { eid: eid, pushHistory: false });
    },
    glyph: (t, r) => T1DGlyphs.path(t, r),
    color: t => T1DGlyphs.color(t),
    keys(e) {
      const tag = (e.target.tagName || "").toLowerCase();
      if (tag === "input" || tag === "textarea") {
        if (e.key === "Escape") e.target.blur();
        return;
      }
      const k = e.key.toLowerCase(), n = this.selNode;
      if (e.key === "/") {
        e.preventDefault();
        const i = this.$el.querySelector(".searchwrap input");
        if (i) i.focus();
      } else if (e.key === "Escape") {
        this.showHelp = false;
        this.$store.commit("select", null);
        this.$store.commit("setPath", []);
      } else if (k === "e" && n) this.expand(n);
      else if (k === "f" && n) this.focusOn(n);
      else if (k === "a" && n) this.$store.commit("setEndpoint", { which: "A", node: n });
      else if (k === "b" && n) this.$store.commit("setEndpoint", { which: "B", node: n });
      else if (e.key === "Backspace" && this.history.length) {
        e.preventDefault();
        const prev = this.history[this.history.length - 1];
        this.$store.commit("popHistory");
        this.goto(prev);
      }
    }
  },
  mounted() {
    T1DApi.onStatus(s => this.$store.commit("setStatus", s));
    this.$root.$on("assistant:open", v => { this.askOpen = v; });
    this.$store.dispatch("loadHubs");
    this.$store.dispatch("loadPairTypes");
    document.addEventListener("keydown", this.keys);
  },
  beforeDestroy() { document.removeEventListener("keydown", this.keys); },
  template: `
  <div class="shell">
    <header class="bar">
      <div class="brand" title="A Multi-Agent Framework for Constructing Temporally Evolving T1D Knowledge Graphs"><span class="dot"></span> A Multi-Agent Framework for Constructing Temporally Evolving T1D Knowledge Graphs</div>
      <div class="bspacer"></div>
      <div class="status">{{ status }}</div>
      <!-- The toggle is here; the window itself is mounted at the bottom of the
           shell. A fixed-position overlay inside the header put its stacking and
           its containing block at the mercy of whatever the header does, which is
           not a thing to leave to chance for the one element that must cover
           everything. -->
      <button class="ghost asktoggle" :class="{on: askOpen}"
              @click="$root.$emit('assistant:toggle')"
              title="Ask about this graph">
        <svg width="13" height="13" viewBox="0 0 16 16" aria-hidden="true">
          <path d="M2 3.2A1.2 1.2 0 013.2 2h9.6A1.2 1.2 0 0114 3.2v6.6a1.2 1.2 0
                   01-1.2 1.2H6.5L3.4 13.6A.5.5 0 012.6 13.2V11H3.2A1.2 1.2 0
                   012 9.8z" fill="currentColor"></path></svg>
        Ask</button>
      <button class="ghost" @click="showHelp=true" title="Shortcuts">?</button>
    </header>

    <div class="app">
      <filter-rail @choose="onChoose" @find-path="findPath"></filter-rail>

      <main class="stage">
        <error-bar></error-bar>
        <div class="crumbs">
          <template v-for="(c,i) in trail">
            <span class="sep" v-if="i" :key="'s'+i">&rsaquo;</span>
            <b v-if="i===trail.length-1" :key="'b'+i">{{ c.name }}</b>
            <button v-else :key="'x'+i" @click="goto(c.eid)">{{ c.name }}</button>
          </template>
        </div>
        <graph-canvas @pick-node="pickNode" @pick-edge="pickEdge"
                      @expand="expand" @seed="onSeed"></graph-canvas>
        <time-strip></time-strip>
        <cypher-drawer></cypher-drawer>
      </main>

      <inspector-panel @expand="expand" @focus="focusOn"
                       @pick-edge="pickEdge"></inspector-panel>
    </div>

    <assistant-panel></assistant-panel>

    <div class="modal" v-if="showHelp" @click.self="showHelp=false">
      <div class="sheet">
        <h3>Shortcuts</h3>
        <table>
          <tr><td><kbd>/</kbd></td><td>focus search</td></tr>
          <tr><td><kbd>Esc</kbd></td><td>clear selection</td></tr>
          <tr><td><kbd>E</kbd></td><td>expand the selected node</td></tr>
          <tr><td><kbd>F</kbd></td><td>make it the focus</td></tr>
          <tr><td><kbd>A</kbd> / <kbd>B</kbd></td><td>set as path endpoint</td></tr>
          <tr><td><kbd>Backspace</kbd></td><td>back</td></tr>
        </table>
        <button class="primary" @click="showHelp=false">Close</button>
      </div>
    </div>
  </div>`
};
