/* Shows the query the current view ran, and accepts a read-only one. Making the
   generated Cypher visible is what turns a point-and-click tool into something a
   user can graduate out of. */
Vue.component("cypher-drawer", {
  data: () => ({ open: false, raw: "", out: null }),
  computed: { cypher() { return this.$store.state.cypher; } },
  methods: {
    async run() {
      this.out = await T1DApi.raw(this.raw);
    },
    cell(v) { return typeof v === "object" ? JSON.stringify(v) : v; }
  },
  template: `
  <div class="cypher">
    <button class="cyphead" :aria-expanded="String(open)" @click="open=!open">
      <span>Cypher behind this view</span><span class="caret">&#9656;</span>
    </button>
    <div class="cyphbody" v-show="open">
      <pre>{{ cypher || '// interact with the graph to see its query' }}</pre>
      <textarea class="rawcypher" v-model="raw" rows="3" spellcheck="false"
        placeholder="Run your own read-only Cypher..."></textarea>
      <div class="row">
        <button class="ghost" @click="run">Run</button>
        <span class="hint">Read-only. A LIMIT is added if you omit one.</span>
      </div>
      <div class="rawout" v-if="out">
        <p class="hint" style="padding:8px" v-if="out.error">{{ out.error }}</p>
        <p class="hint" style="padding:8px" v-else-if="!out.rows || !out.rows.length">
          no rows</p>
        <table class="mini" v-else>
          <thead><tr><th v-for="f in out.fields" :key="f">{{ f }}</th></tr></thead>
          <tbody>
            <tr v-for="(r,i) in out.rows.slice(0,60)" :key="i">
              <td v-for="f in out.fields" :key="f">{{ cell(r[f]) }}</td>
            </tr>
          </tbody>
        </table>
        <p class="hint" style="padding:6px 8px" v-if="out.rows.length > 60">Showing
          the first 60 of {{ out.rows.length }} rows returned. The query itself is
          capped at 200 unless it carries its own LIMIT.</p>
      </div>
    </div>
  </div>`
});
