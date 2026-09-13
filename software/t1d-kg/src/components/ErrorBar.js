/* A failure has to appear where the user is looking.

   Every action used to return early on error, which left the canvas untouched and a
   four-letter status in the header as the only sign that the database had stopped
   answering. This says what broke, in the vocabulary of the thing that broke, and
   offers the one action that usually fixes it. */
Vue.component("error-bar", {
  computed: {
    err() { return this.$store.state.lastError; },
    canRetry() { return !!this.$store.state.retry; },
    // What failed, named. Without the operation the reader - and whoever is sent
    // the screenshot - sees a database message with no idea which click produced
    // it, which is how one report cost an afternoon of guessing.
    where() {
      const o = this.err && this.err.op;
      return o ? ({ search: "while searching",
                    neighbours: "while adding neighbours",
                    expand: "while expanding a node",
                    subgraph: "while drawing the connections between nodes",
                    evidence: "while opening the papers behind an edge",
                    relations: "while reading the asserted relations",
                    node: "while loading an entity",
                    hubs: "while loading the starting points",
                    path: "while searching for a path" }[o] || ("during " + o)) : "";
    },
    human() {
      const m = (this.err && this.err.message) || "";
      // This build has no server: the queries run in the browser and the data is
      // fetched from this same site. The local build's advice - restart the bridge,
      // restart Neo4j - was carried over with the file and is not true here.
      if (/Failed to fetch|Load failed|NetworkError|ERR_CONNECTION/i.test(m))
        return { what: "A data file could not be fetched.",
                 how: "The connection dropped or the host did not answer. " +
                      "Press Retry. If it keeps failing, reload the page." };
      if (/out of memory|OOM|allocat/i.test(m))
        return { what: "The browser ran out of memory for that query.",
                 how: "Narrow the year range or remove some nodes, then try again." };
      if (/timed out|timeout/i.test(m))
        return { what: "The query took too long.",
                 how: "Narrow the year range, or expand fewer nodes at once." };
      // Anything the query engine itself refused. Keep the engine's own words -
      // they are the only description of what it objected to - but say plainly
      // that it is a defect here rather than something the reader did wrong.
      return { what: "The query engine refused that request.",
               how: m.slice(0, 240) + "  This is a bug in the page, not " +
                    "something you did - Retry, or reload to start over." };
    }
  },
  methods: {
    retry() {
      const r = this.$store.state.retry;
      this.$store.commit("clearError");
      if (r) this.$store.dispatch(r.action, r.payload);
    },
    dismiss() { this.$store.commit("clearError"); }
  },
  template: `
  <div class="errbar" v-if="err" role="alert">
    <span class="ei">!</span>
    <div class="etext">
      <b>{{ human.what }}<span class="ewhere" v-if="where"> {{ where }}</span></b>
      <span>{{ human.how }}</span>
    </div>
    <button class="ghost tiny" v-if="canRetry" @click="retry">Retry</button>
    <button class="ghost tiny" @click="dismiss">Dismiss</button>
  </div>`
});
