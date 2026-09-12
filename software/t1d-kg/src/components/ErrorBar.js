/* A failure has to appear where the user is looking.

   Every action used to return early on error, which left the canvas untouched and a
   four-letter status in the header as the only sign that the database had stopped
   answering. This says what broke, in the vocabulary of the thing that broke, and
   offers the one action that usually fixes it. */
Vue.component("error-bar", {
  computed: {
    err() { return this.$store.state.lastError; },
    canRetry() { return !!this.$store.state.retry; },
    human() {
      const m = (this.err && this.err.message) || "";
      // Each browser words a dead connection differently - Chrome "Failed to
      // fetch", Safari "Load failed", Firefox "NetworkError" - and none of them
      // mention the bridge, so all three fell through to "The request failed".
      if (/Failed to fetch|Load failed|NetworkError|ERR_CONNECTION/i.test(m))
        return { what: "The local bridge is not running.",
                 how: "Start it with ./run_explorer.sh from the project directory, " +
                      "then press Retry." };
      if (/Connection refused|URLError|offline/i.test(m))
        return { what: "The graph database is not answering.",
                 how: "Neo4j may have stopped. Restart it with " +
                      "./run_explorer.sh, or ./.tools/neo4j/bin/neo4j start." };
      if (/SyntaxError/i.test(m))
        return { what: "That query did not compile.", how: m.slice(0, 200) };
      if (/timed out|timeout/i.test(m))
        return { what: "The query took too long.",
                 how: "Narrow the year range, or expand fewer nodes at once." };
      return { what: "The request failed.", how: m.slice(0, 240) };
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
      <b>{{ human.what }}</b>
      <span>{{ human.how }}</span>
    </div>
    <button class="ghost tiny" v-if="canRetry" @click="retry">Retry</button>
    <button class="ghost tiny" @click="dismiss">Dismiss</button>
  </div>`
});
