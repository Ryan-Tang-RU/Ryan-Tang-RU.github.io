/* The way in. Typeahead over names and over the words people actually write.

   Standard combobox behaviour - debounce, arrow keys, Enter, Escape, click-away,
   aria-expanded - with three departures, each forced by something that went wrong:

   1. Four states, never a silent one. Closing the dropdown on zero rows made a
      failed request, a query in flight and a name that is genuinely absent all look
      identical: nothing happens, and the reader retypes.
   2. The list is positioned against the viewport, not the input. It sits inside the
      rail, the rail scrolls, and a scroll container clips anything absolutely
      positioned that reaches past it - so the list could be cut off or invisible
      while the search itself worked perfectly.
   3. A hit found through a surface form says so. 81% of the HLA-C node's mentions
      are the string "MHC" and 96% of CD79A's are "IgA"; "IgA -> CD79A" is
      information the reader needs, not noise to hide. */
Vue.component("search-box", {
  data: () => ({ q: "", rows: [], ix: -1, open: false, timer: null,
                 state: "idle", error: "", box: null }),
  computed: {
    hasRows() { return this.state === "hits" && this.rows.length > 0; }
  },
  methods: {
    onInput() {
      clearTimeout(this.timer);
      const q = this.q.trim();
      if (q.length < 2) { this.open = false; this.state = "idle"; return; }
      this.state = "loading"; this.show();
      this.timer = setTimeout(async () => {
        const res = await T1DApi.search(q, 25);
        if (q !== this.q.trim()) return;     // a later keystroke owns the dropdown
        this.ix = -1;
        if (res.error) {
          this.state = "error"; this.error = res.error; this.rows = [];
        } else {
          this.rows = res.rows || [];
          this.state = this.rows.length ? "hits" : "empty";
        }
        this.place();
      }, 180);
    },
    show() { this.open = true; this.$nextTick(this.place); },
    // Anchored to the input's position on screen, recomputed whenever anything
    // moves, because a fixed element does not follow its parent.
    place() {
      const el = this.$refs.input;
      if (!el || !this.open) return;
      const r = el.getBoundingClientRect();
      const room = window.innerHeight - r.bottom - 12;
      // Wider than the field. The list is a floating overlay, so tying its width to
      // a 260px rail truncated every name to "Diabete..." - four rows that read
      // identically, which is worse than no result at all. It grows to what the
      // window allows and shifts left rather than running off the edge.
      const want = Math.max(r.width, 420);
      const w = Math.min(want, window.innerWidth - 24);
      const left = Math.min(r.left, window.innerWidth - w - 12);
      this.box = { left: Math.max(12, left) + "px", top: (r.bottom + 4) + "px",
                   width: w + "px",
                   maxHeight: Math.max(160, Math.min(460, room)) + "px" };
    },
    key(e) {
      if (!this.hasRows) {
        if (e.key === "Escape") { this.open = false; e.target.blur(); }
        return;
      }
      if (e.key === "ArrowDown") {
        this.ix = Math.min(this.ix + 1, this.rows.length - 1); e.preventDefault();
      } else if (e.key === "ArrowUp") {
        this.ix = Math.max(this.ix - 1, 0); e.preventDefault();
      } else if (e.key === "Enter") {
        this.choose(this.rows[Math.max(this.ix, 0)]); e.preventDefault();
      } else if (e.key === "Escape") { this.open = false; }
    },
    choose(row) {
      if (!row) return;
      this.open = false; this.state = "idle"; this.q = row.name;
      this.$emit("choose", row);
    },
    clear() {
      this.q = ""; this.rows = []; this.state = "idle"; this.open = false;
      this.$refs.input.focus();
    },
    onCanvas(eid) { return this.$store.getters.onCanvas(eid); },
    glyph: (t, r) => T1DGlyphs.path(t, r),
    color: t => T1DGlyphs.color(t),
    away(e) { if (!this.$el.contains(e.target)) this.open = false; }
  },
  mounted() {
    document.addEventListener("click", this.away);
    // capture, so a scroll inside the rail counts too
    window.addEventListener("scroll", this.place, true);
    window.addEventListener("resize", this.place);
  },
  beforeDestroy() {
    document.removeEventListener("click", this.away);
    window.removeEventListener("scroll", this.place, true);
    window.removeEventListener("resize", this.place);
  },
  template: `
  <div class="searchwrap">
    <div class="sfield" :class="{focused: open}">
      <svg class="sicon" width="15" height="15" viewBox="0 0 16 16" aria-hidden="true">
        <circle cx="7" cy="7" r="4.6" fill="none" stroke="currentColor"
                stroke-width="1.7"></circle>
        <path d="M10.4 10.4 L14 14" stroke="currentColor" stroke-width="1.7"
              stroke-linecap="round"></path>
      </svg>
      <input ref="input" type="text" v-model="q" @input="onInput" @keydown="key"
             @focus="q.trim().length > 1 && show()"
             role="combobox" :aria-expanded="String(open)" aria-controls="hits"
             autocomplete="off" placeholder="INS, DKA, HLA-DQB1, teplizumab...">
      <button class="sclear" v-if="q" @click="clear" title="clear">&times;</button>
      <kbd class="skey" v-else>/</kbd>
    </div>

    <div class="hits" id="hits" role="listbox" v-show="open" :style="box">
      <p class="hint pad" v-if="state==='loading'">searching&hellip;</p>
      <p class="hint pad" v-else-if="state==='error'">Search failed &mdash;
        {{ error }}. The local bridge may have stopped; restart it and try again.</p>
      <p class="hint pad" v-else-if="state==='empty'">Nothing matches
        &ldquo;{{ q.trim() }}&rdquo;. The graph keeps entities above the export
        thresholds, so a real but rarely studied one can be missing here while still
        present in the corpus. Names, abbreviations and misspellings all work.</p>
      <template v-else>
        <button v-for="(r,i) in rows" :key="r.eid" role="option"
                :class="{on: i===ix}" @click="choose(r)"
                @mouseenter="ix = i">
          <svg width="12" height="12" viewBox="-6 -6 12 12" aria-hidden="true">
            <path :d="glyph(r.type,4.5)" :fill="color(r.type)"></path></svg>
          <span class="snm">
            <span class="sline"><b>{{ r.name }}</b></span>
            <span class="smeta">{{ r.type }} {{ r.id }}<template
              v-if="r.species"> &middot; {{ r.species }}</template> &middot;
              {{ (r.n_papers||0).toLocaleString() }} papers<template
              v-if="r.via"> &middot; matched &ldquo;{{ r.via }}&rdquo;</template><template
              v-if="r.others"> &middot; {{ r.others }} more of this name in other
              species</template><span
              class="pill" v-if="onCanvas(r.eid)">on canvas</span></span>
          </span>
        </button>
      </template>
    </div>
  </div>`
});
